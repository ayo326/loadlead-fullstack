/**
 * Canopy pull -> LoadLead structured insurance fields (SCRUM-60).
 *
 * Maps a commercial Pull onto the same structured fields the manual COI form
 * produces (integer cents, epoch-ms dates), so the verification pipeline cannot
 * tell insurer-sourced data from a manually-entered COI apart from its source
 * marker. Commercial auto liability comes from a COMMERCIAL_AUTO policy; motor
 * truck cargo from an INLAND_MARINE policy (recon: the trucking liability +
 * cargo pair). Defensive by design: a coverage may carry the governing limit in
 * any of several *_cents fields, so we read all present and take the max.
 */

import { CanopyPull, CanopyPolicy, CanopyCoverage, CanopyPolicyStatus } from './canopyTypes';

/** The insurer-sourced structured data, in LoadLead's internal units. */
export interface CanopyInsuranceData {
  insurerName?: string;
  autoPolicyNumber?: string;
  cargoPolicyNumber?: string;
  /** Governing commercial-auto combined single limit, integer cents. */
  autoLiabilityCents?: number;
  /** Governing motor-truck-cargo limit, integer cents. */
  cargoCents?: number;
  generalLiabilityCents?: number;
  /** Effective/expiry of the governing commercial-auto policy, epoch ms. */
  effectiveDate?: number;
  expiryDate?: number;
  autoStatus?: CanopyPolicyStatus;
  cargoStatus?: CanopyPolicyStatus;
  hasCommercialAuto: boolean;
  hasCargo: boolean;
  /** Compact snapshot of the mapped policies, for the document meta + cross-ref. */
  policies: MappedPolicySummary[];
}

export interface MappedPolicySummary {
  policyId: string;
  policyType: string;
  policyNumber?: string;
  insurerName?: string;
  status: CanopyPolicyStatus;
  limitCents?: number;
  effectiveDate?: number;
  expiryDate?: number;
}

const AUTO_TYPES = new Set(['COMMERCIAL_AUTO']);
const CARGO_TYPES = new Set(['INLAND_MARINE']);
const GL_TYPES = new Set(['GENERAL_LIABILITY']);

function isoToMs(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The governing (largest) integer-cents limit across a coverage's limit fields. */
export function coverageLimitCents(cov: CanopyCoverage): number | undefined {
  const candidates = [
    cov.combined_single_limit_cents,
    cov.per_occurrence_limit_cents,
    cov.per_incident_limit_cents,
    cov.aggregate_limit_cents,
    cov.limit_cents,
    cov.per_person_limit_cents,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
}

/** The governing limit of a whole policy: the max across its coverages. */
export function policyLimitCents(policy: CanopyPolicy): number | undefined {
  const perCoverage = (policy.coverages ?? [])
    .map(coverageLimitCents)
    .filter((v): v is number => typeof v === 'number');
  if (perCoverage.length === 0) return undefined;
  return Math.max(...perCoverage);
}

/**
 * Pick the governing policy of a set: prefer ACTIVE, then the highest limit.
 * Returns undefined when none of the given policies exist.
 */
function pickGoverning(policies: CanopyPolicy[]): CanopyPolicy | undefined {
  if (policies.length === 0) return undefined;
  const rank = (p: CanopyPolicy): number => (p.status === 'ACTIVE' ? 1 : 0);
  return [...policies].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    return (policyLimitCents(b) ?? 0) - (policyLimitCents(a) ?? 0);
  })[0];
}

function summarize(policy: CanopyPolicy): MappedPolicySummary {
  return {
    policyId: policy.policy_id,
    policyType: policy.policy_type,
    policyNumber: policy.carrier_policy_number,
    insurerName: policy.carrier_friendly_name || policy.carrier_name,
    status: policy.status,
    limitCents: policyLimitCents(policy),
    effectiveDate: isoToMs(policy.effective_date),
    expiryDate: isoToMs(policy.expiry_date),
  };
}

/** Map a pull's commercial policies onto LoadLead structured insurance fields. */
export function mapPullToInsuranceData(pull: CanopyPull): CanopyInsuranceData {
  const policies = pull.policies ?? [];
  const autoPolicies = policies.filter((p) => AUTO_TYPES.has(p.policy_type));
  const cargoPolicies = policies.filter((p) => CARGO_TYPES.has(p.policy_type));
  const glPolicies = policies.filter((p) => GL_TYPES.has(p.policy_type));

  const auto = pickGoverning(autoPolicies);
  const cargo = pickGoverning(cargoPolicies);
  const gl = pickGoverning(glPolicies);

  const insurerName =
    auto?.carrier_friendly_name ||
    auto?.carrier_name ||
    pull.insurance_provider_friendly_name ||
    pull.insurance_provider_name ||
    undefined;

  return {
    insurerName: insurerName ?? undefined,
    autoPolicyNumber: auto?.carrier_policy_number,
    cargoPolicyNumber: cargo?.carrier_policy_number,
    autoLiabilityCents: auto ? policyLimitCents(auto) : undefined,
    cargoCents: cargo ? policyLimitCents(cargo) : undefined,
    generalLiabilityCents: gl ? policyLimitCents(gl) : undefined,
    effectiveDate: isoToMs(auto?.effective_date),
    expiryDate: isoToMs(auto?.expiry_date),
    autoStatus: auto?.status,
    cargoStatus: cargo?.status,
    hasCommercialAuto: Boolean(auto),
    hasCargo: Boolean(cargo),
    policies: policies.map(summarize),
  };
}
