/**
 * Canopy sandbox fixtures (SCRUM-60).
 *
 * Deterministic CanopyPull objects for the documented sandbox usernames, so the
 * ingestion, mapping, cross-reference, decision, and monitoring logic can be
 * exercised end to end offline (CI has no Canopy credentials). These contain
 * ONLY synthetic policy data: no secrets, no live calls. The canopyClient reads
 * these in fixture mode (when no client credentials are configured); tests build
 * a pull for a username and drive ingestion with it.
 *
 * All money is integer cents. Dates are built relative to a caller-supplied
 * base epoch so tests are fully deterministic. The platform minimum auto
 * liability is 750000 dollars = 75000000 cents (see coiService MIN_LIABILITY).
 */

import { CanopyPull, CanopyPolicy, CanopyPullMetadata } from './canopyTypes';

const DAY = 24 * 60 * 60 * 1000;
const MIN_AUTO_LIABILITY_CENTS = 75_000_000; // $750,000

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface SandboxPullOptions {
  pullId: string;
  /** JSON metadata string echoed back on the pull (carrierId + nonce + source). */
  metaData?: string;
  /** Base epoch ms for deterministic effective/expiry dates. */
  nowMs: number;
  /** For user_good_diffs: 'initial' (aligned) or 'monitored' (changed). */
  variant?: 'initial' | 'monitored';
  parentPullId?: string;
}

function commercialAuto(
  nowMs: number,
  opts: { carrierName: string; policyNumber: string; limitCents: number; status?: CanopyPolicy['status']; expiryMs?: number },
): CanopyPolicy {
  return {
    policy_id: `pol_ca_${opts.policyNumber}`,
    policy_type: 'COMMERCIAL_AUTO',
    carrier_policy_number: opts.policyNumber,
    carrier_name: opts.carrierName,
    carrier_friendly_name: opts.carrierName,
    status: opts.status ?? 'ACTIVE',
    effective_date: iso(nowMs - 30 * DAY),
    expiry_date: iso(opts.expiryMs ?? nowMs + 335 * DAY),
    coverages: [
      { code: 'COMBINED_SINGLE_LIMIT', type: 'BIPD', combined_single_limit_cents: opts.limitCents },
    ],
    named_insureds: [{ name: 'LoadLead Sandbox Carrier LLC' }],
    vehicles: [{ vin: '1FUJGLDR0CLBP1234', year: 2019, make: 'Freightliner', model: 'Cascadia' }],
  };
}

function inlandMarineCargo(
  nowMs: number,
  opts: { carrierName: string; policyNumber: string; limitCents: number; status?: CanopyPolicy['status']; expiryMs?: number },
): CanopyPolicy {
  return {
    policy_id: `pol_im_${opts.policyNumber}`,
    policy_type: 'INLAND_MARINE',
    carrier_policy_number: opts.policyNumber,
    carrier_name: opts.carrierName,
    carrier_friendly_name: opts.carrierName,
    status: opts.status ?? 'ACTIVE',
    effective_date: iso(nowMs - 30 * DAY),
    expiry_date: iso(opts.expiryMs ?? nowMs + 335 * DAY),
    coverages: [{ code: 'CARGO', type: 'MOTOR_TRUCK_CARGO', limit_cents: opts.limitCents }],
    named_insureds: [{ name: 'LoadLead Sandbox Carrier LLC' }],
  };
}

function base(opts: SandboxPullOptions): CanopyPull {
  return {
    pull_id: opts.pullId,
    status: 'SUCCESS',
    type: 'PULLING_DATA',
    meta_data: opts.metaData ?? null,
    insurance_provider_name: 'PROGRESSIVE',
    insurance_provider_friendly_name: 'Progressive Commercial',
    policy_check_status: null,
    policies: [],
    no_policies: false,
    encountered_mfa: false,
    login_error_message: null,
    parent_pull_id: opts.parentPullId ?? null,
    created_at: iso(opts.nowMs),
  };
}

function errorPull(opts: SandboxPullOptions, status: CanopyPull['status'], loginError?: string): CanopyPull {
  return {
    ...base(opts),
    status,
    policies: [],
    no_policies: true,
    login_error_message: loginError ?? null,
  };
}

/**
 * Build the sandbox pull for a documented username. Unknown usernames fail as
 * bad credentials (NOT_AUTHENTICATED), matching the sandbox's documented
 * "all other usernames fail" behavior.
 */
export function buildSandboxPull(username: string, opts: SandboxPullOptions): CanopyPull {
  const carrierName = 'Progressive County Mutual Ins Co';
  switch (username) {
    case 'user_good_transportation': {
      // Commercial auto (liability) + commercial inland marine (cargo): the
      // liability-plus-cargo pair for trucking.
      const p = base(opts);
      p.policies = [
        commercialAuto(opts.nowMs, { carrierName, policyNumber: 'CA-88213', limitCents: 100_000_000 }),
        inlandMarineCargo(opts.nowMs, { carrierName, policyNumber: 'IM-4471', limitCents: 10_000_000 }),
      ];
      return p;
    }
    case 'user_good_commercial':
    case 'user_good_tx':
    case 'user_mfa':
    case 'user_optionless_mfa': {
      // Good commercial auto at $1M; MFA usernames complete to a good pull (the
      // MFA challenge itself is handled inside the widget/Components flow).
      const p = base(opts);
      p.encountered_mfa = username.includes('mfa');
      p.policies = [
        commercialAuto(opts.nowMs, { carrierName, policyNumber: 'CA-90001', limitCents: 100_000_000 }),
      ];
      return p;
    }
    case 'user_good_auto_compliant': {
      const p = base(opts);
      p.policies = [
        commercialAuto(opts.nowMs, { carrierName, policyNumber: 'CA-COMP-1', limitCents: 100_000_000 }),
      ];
      return p;
    }
    case 'user_good_auto_noncompliant': {
      // Active commercial auto but BELOW the platform minimum ($500k < $750k).
      const p = base(opts);
      p.policies = [
        commercialAuto(opts.nowMs, { carrierName, policyNumber: 'CA-NONCOMP-1', limitCents: 50_000_000 }),
      ];
      return p;
    }
    case 'user_good_diffs': {
      // Monitoring test. 'initial' is a clean $1M active auto + cargo; 'monitored'
      // is the deterministic change: the auto policy is CANCELLED (fatal flip).
      const p = base(opts);
      if (opts.variant === 'monitored') {
        p.policies = [
          commercialAuto(opts.nowMs, {
            carrierName,
            policyNumber: 'CA-DIFFS-1',
            limitCents: 100_000_000,
            status: 'CANCELLED',
            expiryMs: opts.nowMs - DAY,
          }),
          inlandMarineCargo(opts.nowMs, { carrierName, policyNumber: 'IM-DIFFS-1', limitCents: 10_000_000 }),
        ];
      } else {
        p.policies = [
          commercialAuto(opts.nowMs, { carrierName, policyNumber: 'CA-DIFFS-1', limitCents: 100_000_000 }),
          inlandMarineCargo(opts.nowMs, { carrierName, policyNumber: 'IM-DIFFS-1', limitCents: 10_000_000 }),
        ];
      }
      return p;
    }
    case 'user_consumer_only': {
      // Manual-entry / consumer profile: no policies.
      const p = base(opts);
      p.type = 'MANUAL_ENTRY';
      p.no_policies = true;
      p.policies = [];
      return p;
    }
    case 'user_locked':
      return errorPull(opts, 'NOT_AUTHENTICATED', 'This account is locked. Please contact your insurer to unlock it.');
    case 'user_unactivated':
      return errorPull(opts, 'NOT_AUTHENTICATED', 'This account has not been activated yet. Please activate it with your insurer.');
    case 'user_provider_error':
      return errorPull(opts, 'PROVIDER_ERROR');
    case 'user_internal_error':
      return errorPull(opts, 'INTERNAL_ERROR');
    default:
      // All other usernames fail as bad credentials.
      return errorPull(opts, 'NOT_AUTHENTICATED', 'The username or password was not recognized by your insurer.');
  }
}

export const SANDBOX_MIN_AUTO_LIABILITY_CENTS = MIN_AUTO_LIABILITY_CENTS;

/** Convenience: build metadata JSON string for a sandbox pull. */
export function sandboxMetadata(meta: CanopyPullMetadata): string {
  return JSON.stringify(meta);
}
