/**
 * Per-load accessorial policy and its acceptance trail.
 *
 * Two dedicated stores, both referencing the load by id only; the Load model is
 * never touched (the global constraint), mirroring the trust-events pattern.
 *
 *  - LoadLead_AccessorialPolicies (PK loadId): the current per-load policy. It is
 *    pre-filled from DEFAULT_ACCESSORIAL_POLICY and the load's rate class, and may
 *    be tuned per load before charges accrue. A change bumps `version`. Charges
 *    freeze a snapshot of this policy at compute time (Phase 5), so later edits
 *    never alter an already-computed charge.
 *
 *  - LoadLead_AccessorialPolicyAcceptances (PK acceptanceId): append-only ESIGN/
 *    UETA consent records. At claim the carrier or owner-operator accepts the
 *    policy; the accepted version and a hash of the exact policy snapshot are
 *    recorded immutably. A correction is a new row; rows are never updated or
 *    deleted.
 */

import { createHash } from 'node:crypto';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { assertIntegerCents } from '../utils/money';
import {
  AccessorialPolicy,
  AccessorialCaps,
  AccessorialRateClass,
  DEFAULT_ACCESSORIAL_POLICY,
  ACCESSORIAL_POLICY_ATTESTATION,
  AccessorialSignatureType,
  resolveRateClass,
} from '../config/accessorialPolicy';

/** The current per-load policy row (keyed by loadId). Editable until a charge freezes it. */
export interface LoadAccessorialPolicy {
  loadId: string;
  version: number;
  rateClass: AccessorialRateClass;
  policy: AccessorialPolicy;
  caps?: AccessorialCaps;
  /** true while still the untouched pre-fill; false once tuned for this load. */
  prefilled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Immutable, hashable view of a policy frozen onto a charge or attested to. */
export interface PolicySnapshot {
  version: number;
  rateClass: AccessorialRateClass;
  policy: AccessorialPolicy;
  caps?: AccessorialCaps;
  /** sha256 of the canonical snapshot, so an acceptance pins the exact terms. */
  policyHash: string;
}

/** One append-only acceptance (ESIGN/UETA consent) of a load's accessorial policy. */
export interface AccessorialPolicyAcceptance {
  acceptanceId: string; // 'apaccept_...'
  loadId: string;
  acceptedVersion: number;
  policyHash: string;
  acceptedByUserId: string;
  signerRole: string;
  signatureType: AccessorialSignatureType;
  signatureData: string;
  consentGiven: boolean; // always true on a stored row
  attestationVersion: string;
  attestationText: string;
  ipAddress?: string;
  userAgent?: string;
  signedAt: number;
}

export interface UpdatePolicyPatch {
  freeTimeMinutes?: number;
  billingIncrementMinutes?: number;
  detentionHourlyRateCents?: Partial<Record<AccessorialRateClass, number>>;
  layoverThresholdMinutes?: number;
  layoverDailyRateCents?: number;
  detentionAutoApproveMaxHours?: number;
  applyTakeRateToAccessorials?: boolean;
  rateClass?: AccessorialRateClass;
  caps?: AccessorialCaps;
}

export interface AcceptPolicyInput {
  load: { loadId: string; hazmat?: boolean; equipmentType: any };
  acceptedByUserId: string;
  signerRole: string;
  signatureType: AccessorialSignatureType;
  signatureData: string;
  consentGiven: boolean;
  ipAddress?: string;
  userAgent?: string;
}

/** Stable key-sorted JSON so the same policy always hashes the same. */
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
}

function assertPolicyMoneyIsCents(policy: AccessorialPolicy, caps?: AccessorialCaps): void {
  assertIntegerCents(policy.detentionHourlyRateCents.STANDARD, 'detention STANDARD');
  assertIntegerCents(policy.detentionHourlyRateCents.SPECIALIZED, 'detention SPECIALIZED');
  assertIntegerCents(policy.detentionHourlyRateCents.HAZMAT, 'detention HAZMAT');
  assertIntegerCents(policy.layoverDailyRateCents, 'layoverDailyRateCents');
  if (caps?.detentionMaxCents != null) assertIntegerCents(caps.detentionMaxCents, 'detentionMaxCents');
  if (caps?.layoverMaxCents != null) assertIntegerCents(caps.layoverMaxCents, 'layoverMaxCents');
}

export class AccessorialPolicyService {
  /** The current policy for a load, or null if none has been created yet. */
  static async getForLoad(loadId: string): Promise<LoadAccessorialPolicy | null> {
    try {
      return await Database.getItem<LoadAccessorialPolicy>(config.dynamodb.accessorialPoliciesTable, { loadId });
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`AccessorialPolicies table missing; treating load ${loadId} as having no policy yet.`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Return the load's policy, creating the pre-filled v1 from DEFAULT_ACCESSORIAL_POLICY
   * and the load's rate class on first call. Idempotent: a second call returns the
   * existing row unchanged.
   */
  static async getOrCreateForLoad(load: {
    loadId: string;
    hazmat?: boolean;
    equipmentType: any;
  }): Promise<LoadAccessorialPolicy> {
    const existing = await this.getForLoad(load.loadId);
    if (existing) return existing;

    const now = Helpers.getCurrentTimestamp();
    const record: LoadAccessorialPolicy = {
      loadId: load.loadId,
      version: 1,
      rateClass: resolveRateClass(load),
      policy: { ...DEFAULT_ACCESSORIAL_POLICY, detentionHourlyRateCents: { ...DEFAULT_ACCESSORIAL_POLICY.detentionHourlyRateCents } },
      prefilled: true,
      createdAt: now,
      updatedAt: now,
    };
    await Database.putItem(config.dynamodb.accessorialPoliciesTable, record);
    return record;
  }

  /**
   * Apply a per-load override and bump the version. Only the listed fields can be
   * tuned; rates and caps must stay integer cents. The new row replaces the
   * current policy (charges already computed kept their frozen snapshot).
   */
  static async updatePolicy(
    load: { loadId: string; hazmat?: boolean; equipmentType: any },
    patch: UpdatePolicyPatch
  ): Promise<LoadAccessorialPolicy> {
    const current = await this.getOrCreateForLoad(load);
    const next: AccessorialPolicy = {
      ...current.policy,
      detentionHourlyRateCents: { ...current.policy.detentionHourlyRateCents },
    };

    if (patch.freeTimeMinutes != null) next.freeTimeMinutes = patch.freeTimeMinutes;
    if (patch.billingIncrementMinutes != null) next.billingIncrementMinutes = patch.billingIncrementMinutes;
    if (patch.layoverThresholdMinutes != null) next.layoverThresholdMinutes = patch.layoverThresholdMinutes;
    if (patch.layoverDailyRateCents != null) next.layoverDailyRateCents = patch.layoverDailyRateCents;
    if (patch.detentionAutoApproveMaxHours != null) next.detentionAutoApproveMaxHours = patch.detentionAutoApproveMaxHours;
    if (patch.applyTakeRateToAccessorials != null) next.applyTakeRateToAccessorials = patch.applyTakeRateToAccessorials;
    if (patch.detentionHourlyRateCents) {
      for (const k of Object.keys(patch.detentionHourlyRateCents) as AccessorialRateClass[]) {
        const v = patch.detentionHourlyRateCents[k];
        if (v != null) next.detentionHourlyRateCents[k] = v;
      }
    }

    const caps = patch.caps ?? current.caps;
    assertPolicyMoneyIsCents(next, caps);

    const updated: LoadAccessorialPolicy = {
      ...current,
      rateClass: patch.rateClass ?? current.rateClass,
      policy: next,
      ...(caps ? { caps } : {}),
      prefilled: false,
      version: current.version + 1,
      updatedAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.accessorialPoliciesTable, updated);
    return updated;
  }

  /** Freeze the load's current policy into a hashable snapshot for a charge or acceptance. */
  static snapshotOf(p: LoadAccessorialPolicy): PolicySnapshot {
    const base = {
      version: p.version,
      rateClass: p.rateClass,
      policy: p.policy,
      ...(p.caps ? { caps: p.caps } : {}),
    };
    const policyHash = createHash('sha256').update(canonicalJSON(base), 'utf8').digest('hex');
    return { ...base, policyHash };
  }

  /** Convenience: get-or-create the load's policy and return its frozen snapshot. */
  static async snapshotForLoad(load: { loadId: string; hazmat?: boolean; equipmentType: any }): Promise<PolicySnapshot> {
    const p = await this.getOrCreateForLoad(load);
    return this.snapshotOf(p);
  }

  /**
   * Record an append-only acceptance of the load's current policy. Consent must be
   * explicit. The accepted version and a hash of the exact terms are pinned so the
   * acceptance is reproducible even after the policy is later edited.
   */
  static async acceptPolicy(input: AcceptPolicyInput): Promise<AccessorialPolicyAcceptance> {
    if (input.consentGiven !== true) {
      throw new Error('CONSENT_REQUIRED: accessorial policy acceptance requires explicit consent');
    }
    if (!input.acceptedByUserId) {
      throw new Error('acceptedByUserId is required');
    }
    const policy = await this.getOrCreateForLoad(input.load);
    const snap = this.snapshotOf(policy);

    const acceptance: AccessorialPolicyAcceptance = {
      acceptanceId: Helpers.generateId('apaccept'),
      loadId: input.load.loadId,
      acceptedVersion: snap.version,
      policyHash: snap.policyHash,
      acceptedByUserId: input.acceptedByUserId,
      signerRole: input.signerRole,
      signatureType: input.signatureType,
      signatureData: input.signatureData,
      consentGiven: true,
      attestationVersion: ACCESSORIAL_POLICY_ATTESTATION.version,
      attestationText: ACCESSORIAL_POLICY_ATTESTATION.text,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      signedAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.accessorialPolicyAcceptancesTable, acceptance);
    return acceptance;
  }

  /** All acceptances for a load, newest first. Append-only history. */
  static async listAcceptances(loadId: string): Promise<AccessorialPolicyAcceptance[]> {
    let rows: AccessorialPolicyAcceptance[];
    try {
      rows = await Database.scan<AccessorialPolicyAcceptance>(config.dynamodb.accessorialPolicyAcceptancesTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
    return rows.filter((r) => r.loadId === loadId).sort((a, b) => b.signedAt - a.signedAt);
  }
}
