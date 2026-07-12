/**
 * Canopy Connect API types (SCRUM-60).
 *
 * A pragmatic TypeScript view of the Pull object and its Policy/Coverage
 * children, from the recon of docs.usecanopy.com (llms.txt + OpenAPI). Field
 * names mirror Canopy's snake_case wire format exactly so the raw response maps
 * with no renaming. All monetary amounts are integer cents on the wire, matching
 * LoadLead's internal convention.
 *
 * Where the OpenAPI excerpt was truncated (the exact commercial-auto / cargo
 * coverage container), we model coverages defensively: a coverage may carry any
 * of several *_cents limit fields, and the mapper reads all plausible ones and
 * takes the governing value. This is question A1 for the Canopy contact; the
 * shape here tightens (it does not break) when A1 is answered.
 */

/** Pull.status. NOT_AUTHENTICATED / PROVIDER_ERROR / INTERNAL_ERROR are the failure paths. */
export type CanopyPullStatus =
  | 'SUCCESS'
  | 'NOT_AUTHENTICATED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR'
  | 'PULLING'
  | 'PENDING';

/** Pull.type. */
export type CanopyPullType =
  | 'PULLING_DATA'
  | 'SERVICING'
  | 'DOCUMENT_UPLOAD'
  | 'DOCUMENT_PARSING'
  | 'AGENT'
  | 'MANUAL_ENTRY'
  | 'POLICY_LOOKUP'
  | 'CONTACT_ME';

/** Pull.policy_check_status (Policy Check product). */
export type CanopyPolicyCheckStatus = 'COMPLIANT' | 'NOT_COMPLIANT' | 'REVIEW_REQUIRED';

/** Policy.status. */
export type CanopyPolicyStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNVERIFIED'
  | 'PENDING_ACTIVATION'
  | 'PENDING_CANCELLATION'
  | 'RESCINDED'
  | 'QUOTE';

/**
 * Policy.policy_type. Commercial values relevant to trucking are
 * COMMERCIAL_AUTO (auto liability) and INLAND_MARINE (motor truck cargo).
 */
export type CanopyPolicyType =
  | 'AUTO'
  | 'COMMERCIAL_AUTO'
  | 'COMMERCIAL_UMBRELLA'
  | 'COMMERCIAL_PACKAGE'
  | 'COMMERCIAL_PROPERTY'
  | 'COMMERCIAL_FIRE'
  | 'BUSINESS_OWNERS'
  | 'WORKERS_COMPENSATION'
  | 'GENERAL_LIABILITY'
  | 'ERRORS_AND_OMISSIONS'
  | 'INLAND_MARINE'
  | 'MANAGEMENT_LIABILITY'
  | 'CYBER'
  | 'UMBRELLA'
  | 'HOMEOWNERS'
  | 'RENTERS'
  | 'CONDO'
  | 'MOTORCYCLE'
  | 'BOAT'
  | 'RECREATIONAL_VEHICLE'
  | 'CLASSIC_CAR'
  | 'NAMED_NON_OWNER'
  | 'LIFE'
  | (string & {}); // tolerate unknown future policy types without a hard failure

export interface CanopyCoverage {
  /** Canopy coverage code/name, e.g. "BIPD", "CARGO", "COMBINED_SINGLE_LIMIT". */
  code?: string;
  type?: string;
  /** Any of these may carry the governing limit; the mapper reads all present. */
  combined_single_limit_cents?: number;
  per_occurrence_limit_cents?: number;
  per_incident_limit_cents?: number;
  per_person_limit_cents?: number;
  aggregate_limit_cents?: number;
  limit_cents?: number;
  deductible_cents?: number;
  premium_cents?: number;
  per_occurrence_unlimited?: boolean;
}

export interface CanopyVehicle {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
}

export interface CanopyNamedInsured {
  name?: string;
  first_name?: string;
  last_name?: string;
}

export interface CanopyPolicy {
  policy_id: string;
  policy_type: CanopyPolicyType;
  carrier_policy_number?: string;
  carrier_name?: string;
  carrier_friendly_name?: string;
  status: CanopyPolicyStatus;
  effective_date?: string; // ISO date-time
  expiry_date?: string; // ISO date-time
  renewal_date?: string;
  canceled_date?: string;
  coverages?: CanopyCoverage[];
  vehicles?: CanopyVehicle[];
  named_insureds?: CanopyNamedInsured[];
  commercial_named_insureds?: CanopyNamedInsured[];
  /** Per-policy Policy Check result, present when Policy Check ran. */
  policy_check?: {
    status?: CanopyPolicyCheckStatus;
    detail?: string;
  };
}

export interface CanopyPull {
  pull_id: string;
  status: CanopyPullStatus;
  type?: CanopyPullType;
  /** Developer-supplied metadata, echoed back verbatim as a JSON string. */
  meta_data?: string | null;
  insurance_provider_name?: string | null;
  insurance_provider_friendly_name?: string | null;
  policy_check_status?: CanopyPolicyCheckStatus | null;
  policies?: CanopyPolicy[];
  no_policies?: boolean;
  encountered_mfa?: boolean;
  /** Present on NOT_AUTHENTICATED: the insurer login error to surface to the hauler. */
  login_error_message?: string | null;
  /** Links a monitoring re-pull to the original pull. */
  parent_pull_id?: string | null;
  created_at?: string;
}

/** The metadata we attach to every pull and read back to resolve the carrier. */
export interface CanopyPullMetadata {
  carrierId: string;
  /** Idempotency nonce; validated on ingestion so a replayed pull cannot re-key. */
  nonce: string;
  /** Which experience initiated the connect: widget | components | agent. */
  source: 'widget' | 'components' | 'agent';
}

/** Parse Pull.meta_data (a JSON string) into our metadata, tolerating junk. */
export function parsePullMetadata(raw: string | null | undefined): Partial<CanopyPullMetadata> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as Partial<CanopyPullMetadata>;
    return {};
  } catch {
    return {};
  }
}
