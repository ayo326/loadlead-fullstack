/**
 * betaAutoQualify — encodes the HARD GATES from the beta kit + the Tally
 * webhook spec (LoadLead_Beta_Form_Tally_Guide.md §13 / Recruitment_Kit.md).
 *
 * Runs the moment a BetaApplication is ingested from Tally. Returns the
 * resulting status + the autoFlags that explain WHY. The dashboard shows
 * these flags so staff can override a WAITLISTED row if they choose.
 *
 * The three auto-gates (authoritative per the webhook spec):
 *   NO_AUTHORITY    carrier side ∧ mcOrDot missing/blank/invalid → WAITLISTED
 *   LOW_VOLUME      shipper side ∧ loadsPerWeek "Under 5" (< 5)   → WAITLISTED
 *   NO_COMMITMENT   realFreight === No OR feedbackCall === No     → WAITLISTED
 *   (no flags)      passes all three                              → QUALIFIED
 *
 * Auto-qualify NEVER assigns DISQUALIFIED — that verdict is staff-only
 * (e.g. fake credentials caught on review). All auto-fails land WAITLISTED
 * so the applicant stays in the pipeline for a possible later wave.
 *
 * Geography/Texas is a SCORING dimension (betaScoring.geographyScore), not
 * an auto-gate — an OUTSIDE-Texas applicant is QUALIFIED with Geography=0,
 * scored down rather than gated out.
 */

import { BetaApplication } from '../types';
import { normalizeLoadsPerWeek } from './betaScoring';

/** Tally-form MC/DOT validity. Accepts an optional "MC"/"DOT" prefix and
 *  4–8 digits. Real FMCSA numbers are 5–7 digits for MC, up to 8 for DOT;
 *  we keep the range loose and let staff verify the live FMCSA lookup. */
const MC_DOT_RE = /^(MC|DOT)?[\s-]?\d{4,8}$/i;

export interface AutoQualifyResult {
  status: 'QUALIFIED' | 'WAITLISTED' | 'DISQUALIFIED';
  autoFlags: string[];
}

export function autoQualify(
  app: Pick<BetaApplication, 'side' | 'texasFocus' | 'sideSpecificData' | 'commitment'>,
  _opts: { currentWave?: string } = {},
): AutoQualifyResult {
  const flags: string[] = [];
  let waitlisted = false;

  const isCarrier = app.side === 'CARRIER' || app.side === 'BOTH';
  const isShipper = app.side === 'SHIPPER' || app.side === 'BOTH';

  // ── NO_AUTHORITY: carrier must have a valid MC/DOT ──
  if (isCarrier) {
    const mcOrDot = app.sideSpecificData?.carrier?.mcOrDot?.trim();
    if (!mcOrDot || !MC_DOT_RE.test(mcOrDot)) {
      flags.push('NO_AUTHORITY');
      waitlisted = true;
    }
  }

  // ── LOW_VOLUME: shipper must move ≥ 5 shipments/week ──
  // loadsPerWeek arrives as a band string ("Under 5", "5-20", …) or a
  // number; normalizeLoadsPerWeek maps "Under 5" → 0.
  if (isShipper) {
    const lpw = normalizeLoadsPerWeek(app.sideSpecificData?.shipper?.loadsPerWeek);
    if (typeof lpw === 'number' && lpw < 5) {
      flags.push('LOW_VOLUME');
      waitlisted = true;
    }
  }

  // ── NO_COMMITMENT: must be running real freight AND commit to feedback ──
  if (app.commitment?.realFreight === false || app.commitment?.feedbackCall === false) {
    flags.push('NO_COMMITMENT');
    waitlisted = true;
  }

  const status = waitlisted ? 'WAITLISTED' : 'QUALIFIED';
  return { status, autoFlags: flags };
}
