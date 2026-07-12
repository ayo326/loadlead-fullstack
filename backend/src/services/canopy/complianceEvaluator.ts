/**
 * Compliance evaluator seam (SCRUM-60, Phase 8).
 *
 * Extracts the minimums decision behind an interface so the platform can decide
 * with its own local table (unchanged behavior, the default) or with Canopy's
 * Policy Check product, or run BOTH and log where they diverge before ever
 * trusting Policy Check to decide.
 *
 *   - local        (default): the existing local minimums table. Behavior is
 *                  identical to before this seam existed.
 *   - policy_check: read Policy Check rule outcomes off the Pull.
 *   - shadow:       run both, DECIDE on the local table, and log every divergence
 *                   append-only on the INSURER_POLICY document. The switch to
 *                   policy_check as the decider is a later config change made only
 *                   after a clean shadow period.
 *
 * Selected by COMPLIANCE_EVALUATOR (see canopyConfig).
 */

import canopyConfig, { ComplianceEvaluatorMode } from '../../config/canopyConfig';
import { Logger } from '../../utils/logger';
import { ComplianceDocumentService } from '../complianceDocumentService';
import { CanopyInsuranceData } from './canopyMapper';
import { CanopyPull } from './canopyTypes';

/**
 * Platform minimum commercial-auto liability, integer cents. Mirrors coiService
 * MIN_LIABILITY_DOLLARS (750000) x100. Kept here as the local minimums table.
 */
export const MIN_AUTO_LIABILITY_CENTS = 75_000_000;

export interface EvaluatorCoverageResult {
  pass: boolean;
  reason?: string;
}

export interface EvaluatorResult {
  evaluator: 'local' | 'policy_check';
  pass: boolean;
  autoLiability: EvaluatorCoverageResult;
  cargo: EvaluatorCoverageResult;
  reasons: string[];
}

export interface ComplianceEvaluator {
  readonly name: 'local' | 'policy_check';
  evaluate(data: CanopyInsuranceData, pull?: CanopyPull): EvaluatorResult;
}

function combine(name: 'local' | 'policy_check', auto: EvaluatorCoverageResult, cargo: EvaluatorCoverageResult): EvaluatorResult {
  const reasons: string[] = [];
  if (!auto.pass && auto.reason) reasons.push(auto.reason);
  if (!cargo.pass && cargo.reason) reasons.push(cargo.reason);
  // Cargo is required for the cargo badge but does not by itself block liability
  // verification; the deciding pipeline (Phase 7) treats auto liability as the
  // gating coverage. Here `pass` means "auto liability meets the minimum".
  return { evaluator: name, pass: auto.pass, autoLiability: auto, cargo, reasons };
}

/** The existing local minimums table. Unchanged decision behavior. */
export class LocalMinimumsEvaluator implements ComplianceEvaluator {
  readonly name = 'local' as const;

  // pull is accepted (interface parity) but unused: the local table decides
  // purely from the mapped structured fields.
  evaluate(data: CanopyInsuranceData, _pull?: CanopyPull): EvaluatorResult {
    const autoActive = data.autoStatus === 'ACTIVE';
    const autoMeets = (data.autoLiabilityCents ?? 0) >= MIN_AUTO_LIABILITY_CENTS;
    const auto: EvaluatorCoverageResult = {
      pass: data.hasCommercialAuto && autoActive && autoMeets,
      reason: !data.hasCommercialAuto
        ? 'no commercial auto policy'
        : !autoActive
          ? `commercial auto policy is ${data.autoStatus ?? 'not active'}`
          : !autoMeets
            ? `commercial auto liability ${data.autoLiabilityCents ?? 0} cents is below the ${MIN_AUTO_LIABILITY_CENTS} cents minimum`
            : undefined,
    };
    const cargoActive = data.cargoStatus === 'ACTIVE';
    const cargo: EvaluatorCoverageResult = {
      pass: data.hasCargo && cargoActive && (data.cargoCents ?? 0) > 0,
      reason: !data.hasCargo
        ? 'no cargo policy'
        : !cargoActive
          ? `cargo policy is ${data.cargoStatus ?? 'not active'}`
          : undefined,
    };
    return combine('local', auto, cargo);
  }
}

/**
 * Read Policy Check rule outcomes off the Pull. Canopy surfaces the overall
 * result as pull.policy_check_status and per-policy as policy.policy_check.
 * COMPLIANT -> pass; NOT_COMPLIANT / REVIEW_REQUIRED -> fail (with the reason).
 */
export class PolicyCheckEvaluator implements ComplianceEvaluator {
  readonly name = 'policy_check' as const;

  evaluate(data: CanopyInsuranceData, pull?: CanopyPull): EvaluatorResult {
    const status = pull?.policy_check_status ?? null;
    if (!status) {
      // Policy Check was not run on this pull; fall back to a not-evaluated fail
      // so the deciding pipeline holds PENDING rather than silently passing.
      const notRun: EvaluatorCoverageResult = { pass: false, reason: 'policy check not evaluated on this pull' };
      return combine('policy_check', notRun, notRun);
    }
    const pass = status === 'COMPLIANT';
    const reason = pass ? undefined : `policy check status ${status}`;
    // Attribute the auto policy's per-policy check when present.
    const autoPolicy = (pull?.policies ?? []).find((p) => p.policy_type === 'COMMERCIAL_AUTO');
    const cargoPolicy = (pull?.policies ?? []).find((p) => p.policy_type === 'INLAND_MARINE');
    const auto: EvaluatorCoverageResult = {
      pass: pass && (autoPolicy?.policy_check?.status ?? 'COMPLIANT') === 'COMPLIANT',
      reason,
    };
    const cargo: EvaluatorCoverageResult = {
      pass: (cargoPolicy?.policy_check?.status ?? (data.hasCargo ? 'COMPLIANT' : 'NOT_COMPLIANT')) === 'COMPLIANT',
      reason: data.hasCargo ? undefined : 'no cargo policy',
    };
    return combine('policy_check', auto, cargo);
  }
}

export function resolveEvaluator(name: 'local' | 'policy_check'): ComplianceEvaluator {
  return name === 'policy_check' ? new PolicyCheckEvaluator() : new LocalMinimumsEvaluator();
}

export interface DecidingEvaluation {
  mode: ComplianceEvaluatorMode;
  /** The result the pipeline decides on (always the local table in shadow mode). */
  deciding: EvaluatorResult;
  /** The Policy Check result, present in policy_check and shadow modes. */
  policyCheck?: EvaluatorResult;
  diverged: boolean;
}

/**
 * Run the configured evaluator(s) and return the deciding result. In shadow mode
 * both run, local decides, and any divergence is logged append-only on the
 * document. Never throws on the Policy Check leg; a Policy Check failure degrades
 * to the local decision (fail-safe), logged.
 */
export async function evaluateForDecision(
  data: CanopyInsuranceData,
  pull: CanopyPull | undefined,
  documentId: string | undefined,
): Promise<DecidingEvaluation> {
  const mode = canopyConfig.evaluator;
  const local = new LocalMinimumsEvaluator().evaluate(data, pull);

  if (mode === 'local') {
    return { mode, deciding: local, diverged: false };
  }

  let policyCheck: EvaluatorResult | undefined;
  try {
    policyCheck = new PolicyCheckEvaluator().evaluate(data, pull);
  } catch (e: any) {
    Logger.warn(`[canopy] policy check evaluation failed, using local: ${e?.message ?? e}`);
    policyCheck = undefined;
  }

  if (mode === 'policy_check') {
    // Policy Check decides; if it could not run, fall back to local (fail-safe).
    return { mode, deciding: policyCheck ?? local, policyCheck, diverged: false };
  }

  // shadow: local decides, log divergence.
  const diverged = policyCheck ? policyCheck.pass !== local.pass : false;
  if (diverged && documentId) {
    const detail = JSON.stringify({
      local: { pass: local.pass, reasons: local.reasons },
      policy_check: { pass: policyCheck!.pass, reasons: policyCheck!.reasons },
    });
    await ComplianceDocumentService.recordVerificationEvent(
      documentId,
      'EVALUATOR_DIVERGENCE',
      'shadow',
      detail,
    ).catch(() => undefined);
    Logger.warn(`[canopy] evaluator divergence on ${documentId}: local=${local.pass} policy_check=${policyCheck!.pass}`);
  }
  return { mode, deciding: local, policyCheck, diverged };
}

/**
 * A divergence report across INSURER_POLICY documents: every EVALUATOR_DIVERGENCE
 * event. Read from the append-only event log (scan at beta volume).
 */
export async function divergenceReport(): Promise<
  { documentId: string; detail?: string; createdAt: number }[]
> {
  const all = await ComplianceDocumentService.listAllCurrentOfType('INSURER_POLICY');
  const out: { documentId: string; detail?: string; createdAt: number }[] = [];
  for (const doc of all) {
    const events = await ComplianceDocumentService.listEvents(doc.documentId);
    for (const e of events) {
      if (e.event === 'EVALUATOR_DIVERGENCE') {
        out.push({ documentId: doc.documentId, detail: e.detail, createdAt: e.createdAt });
      }
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
