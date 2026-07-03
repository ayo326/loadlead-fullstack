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
  AccessorialDisclosure,
  DEFAULT_ACCESSORIAL_POLICY,
  ACCESSORIAL_POLICY_ATTESTATION,
  ACCESSORIAL_BOUNDS,
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
  /**
   * The detention/layover disclosure the carrier acknowledged, captured on the
   * same append-only acceptance row so there is a single provable acceptance
   * carrying both the e-sign and the acknowledgment. The disclosure is derived
   * server-side from the frozen policy, so it always matches what was shown.
   */
  acknowledgment?: {
    acknowledged: true;
    acknowledgedAt: number;
    disclosure: AccessorialDisclosure;
  };
}

/** One append-only shipper agreement to a load's accessorial terms at posting. */
export interface ShipperPolicyAgreement {
  agreementId: string; // 'shipagree_...'
  loadId: string;
  shipperId: string;
  agreedVersion: number;
  policyHash: string;
  disclosure: AccessorialDisclosure; // the exact values agreed
  actorId: string;
  agreedAt: number;
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
  /**
   * When true, the carrier acknowledged the detention/layover disclosure. The
   * disclosed values are derived server-side from the frozen policy and recorded
   * on the acceptance, so the record always matches what the modal displayed.
   */
  acknowledged?: boolean;
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
   * The disclosure view of a policy: the single detention rate for this load's
   * freight class, plus free time, billing increment, and layover terms. This is
   * what the offer summary and acknowledgment modal display, and what the
   * acknowledgment records, so the shown and recorded numbers always agree.
   */
  static disclosureOf(p: LoadAccessorialPolicy): AccessorialDisclosure {
    return {
      version: p.version,
      rateClass: p.rateClass,
      freeTimeMinutes: p.policy.freeTimeMinutes,
      billingIncrementMinutes: p.policy.billingIncrementMinutes,
      detentionHourlyRateCents: p.policy.detentionHourlyRateCents[p.rateClass],
      layoverThresholdMinutes: p.policy.layoverThresholdMinutes,
      layoverDailyRateCents: p.policy.layoverDailyRateCents,
    };
  }

  /** Convenience: get-or-create the load's policy and return its disclosure view. */
  static async disclosureForLoad(load: { loadId: string; hazmat?: boolean; equipmentType: any }): Promise<AccessorialDisclosure> {
    return this.disclosureOf(await this.getOrCreateForLoad(load));
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
    const now = Helpers.getCurrentTimestamp();

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
      signedAt: now,
      // The acknowledgment travels on the same append-only row. The disclosed
      // values are derived from the frozen policy (not trusted from the client),
      // so what is recorded is exactly what the modal read from the snapshot.
      ...(input.acknowledged === true
        ? { acknowledgment: { acknowledged: true as const, acknowledgedAt: now, disclosure: this.disclosureOf(policy) } }
        : {}),
    };
    await Database.putItem(config.dynamodb.accessorialPolicyAcceptancesTable, acceptance);
    return acceptance;
  }

  // ── Shipper side: rate-card preview, bounds, freeze-and-agree at posting ────

  /**
   * The disclosure prefilled from the default rate card for a load's freight
   * class, WITHOUT needing the load to exist yet. Used by the posting preview so
   * the shipper sees the terms before submitting. Version 1 = the prefill.
   */
  static rateCardDisclosure(load: { hazmat?: boolean; equipmentType: any }): AccessorialDisclosure {
    const rateClass = resolveRateClass(load);
    const p = DEFAULT_ACCESSORIAL_POLICY;
    return {
      version: 1,
      rateClass,
      freeTimeMinutes: p.freeTimeMinutes,
      billingIncrementMinutes: p.billingIncrementMinutes,
      detentionHourlyRateCents: p.detentionHourlyRateCents[rateClass],
      layoverThresholdMinutes: p.layoverThresholdMinutes,
      layoverDailyRateCents: p.layoverDailyRateCents,
    };
  }

  /**
   * Validate a shipper override against the rate-card bounds for the load's
   * freight class. Throws with a clear message when any value is out of band.
   */
  static assertOverrideWithinBounds(patch: UpdatePolicyPatch, rateClass: AccessorialRateClass): void {
    const b = ACCESSORIAL_BOUNDS;
    const chk = (label: string, v: number | undefined, bound: { min: number; max: number }) => {
      if (v == null) return;
      if (v < bound.min || v > bound.max) {
        throw new Error(`OVERRIDE_OUT_OF_BOUNDS: ${label} ${v} is outside [${bound.min}, ${bound.max}]`);
      }
    };
    chk('freeTimeMinutes', patch.freeTimeMinutes, b.freeTimeMinutes);
    chk('billingIncrementMinutes', patch.billingIncrementMinutes, b.billingIncrementMinutes);
    chk('layoverThresholdMinutes', patch.layoverThresholdMinutes, b.layoverThresholdMinutes);
    chk('layoverDailyRateCents', patch.layoverDailyRateCents, b.layoverDailyRateCents);
    if (patch.detentionHourlyRateCents) {
      for (const k of Object.keys(patch.detentionHourlyRateCents) as AccessorialRateClass[]) {
        chk(`detentionHourlyRateCents.${k}`, patch.detentionHourlyRateCents[k], b.detentionHourlyRateCents[k]);
      }
    }
    // The class the shipper is setting must itself be within its band.
    const forClass = patch.detentionHourlyRateCents?.[rateClass];
    if (forClass != null) chk(`detentionHourlyRateCents.${rateClass}`, forClass, b.detentionHourlyRateCents[rateClass]);
  }

  /**
   * Freeze the load's accessorial policy at posting and record the shipper's
   * append-only agreement. Applies a bounds-checked override if given (a new
   * version), then pins the agreed version + exact disclosed values. The frozen
   * policy is the same row the carrier's offer view and acknowledgment later read,
   * so both sides agree to one snapshot at one version.
   */
  static async freezeAndAgreeAtPosting(input: {
    load: { loadId: string; hazmat?: boolean; equipmentType: any };
    shipperId: string;
    actorId: string;
    override?: UpdatePolicyPatch;
  }): Promise<{ policy: LoadAccessorialPolicy; disclosure: AccessorialDisclosure; agreement: ShipperPolicyAgreement }> {
    let policy = await this.getOrCreateForLoad(input.load);
    if (input.override && Object.keys(input.override).length > 0) {
      this.assertOverrideWithinBounds(input.override, policy.rateClass);
      policy = await this.updatePolicy(input.load, input.override);
    }
    const disclosure = this.disclosureOf(policy);
    const snap = this.snapshotOf(policy);
    const agreement: ShipperPolicyAgreement = {
      agreementId: Helpers.generateId('shipagree'),
      loadId: input.load.loadId,
      shipperId: input.shipperId,
      agreedVersion: policy.version,
      policyHash: snap.policyHash,
      disclosure,
      actorId: input.actorId,
      agreedAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.shipperAgreementsTable, agreement);
    return { policy, disclosure, agreement };
  }

  /** All shipper agreements for a load, newest first. Append-only history. */
  static async listShipperAgreements(loadId: string): Promise<ShipperPolicyAgreement[]> {
    let rows: ShipperPolicyAgreement[];
    try {
      rows = await Database.scan<ShipperPolicyAgreement>(config.dynamodb.shipperAgreementsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
    return rows.filter((r) => r.loadId === loadId).sort((a, b) => b.agreedAt - a.agreedAt);
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
