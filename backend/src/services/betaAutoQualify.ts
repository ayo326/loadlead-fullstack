/**
 * betaAutoQualify — encodes the HARD GATES from docs/beta/Recruitment_Kit.md.
 *
 * Runs the moment a BetaApplication is ingested from Tally. Returns the
 * resulting status + the autoFlags that explain WHY. The dashboard shows
 * these flags so staff can override a WAITLISTED row if they choose.
 *
 * The rules (verbatim from the kit):
 *   carrier_no_mc_dot       carrier side ∧ mcOrDot missing/invalid → DISQUALIFIED
 *   shipper_low_volume      shipper side ∧ loadsPerWeek < 5         → WAITLISTED
 *   not_running_freight     commitment.realFreight === false        → WAITLISTED
 *   wont_commit_to_feedback commitment.feedbackCall === false       → WAITLISTED
 *   outside_texas_strict    texasFocus === OUTSIDE ∧ Wave 1         → WAITLISTED
 *   (no flags)              passes everything                       → QUALIFIED
 *
 * Precedence: DISQUALIFIED beats WAITLISTED beats QUALIFIED. A carrier
 * with no MC/DOT that ALSO won't commit to feedback is DISQUALIFIED
 * (the harder verdict wins) but BOTH flags are recorded.
 */

import { BetaApplication } from '../types';

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
  opts: { currentWave?: string } = {},
): AutoQualifyResult {
  const flags: string[] = [];
  let disqualified = false;
  let waitlisted = false;

  const isCarrier = app.side === 'CARRIER' || app.side === 'BOTH';
  const isShipper = app.side === 'SHIPPER' || app.side === 'BOTH';

  // ── carrier: must have a valid MC/DOT ──
  if (isCarrier) {
    const mcOrDot = app.sideSpecificData?.carrier?.mcOrDot?.trim();
    if (!mcOrDot || !MC_DOT_RE.test(mcOrDot)) {
      flags.push('carrier_no_mc_dot');
      disqualified = true;
    }
  }

  // ── shipper: must move ≥ 5 shipments/week ──
  if (isShipper) {
    const lpw = app.sideSpecificData?.shipper?.loadsPerWeek;
    if (typeof lpw === 'number' && lpw < 5) {
      flags.push('shipper_low_volume');
      waitlisted = true;
    }
  }

  // ── commitment gates (both sides) ──
  if (app.commitment?.realFreight === false) {
    flags.push('not_running_freight');
    waitlisted = true;
  }
  if (app.commitment?.feedbackCall === false) {
    flags.push('wont_commit_to_feedback');
    waitlisted = true;
  }

  // ── Texas-strict for Wave 1 ──
  // Wave 1 is ≥80% Texas-MOSTLY; an OUTSIDE-Texas applicant is waitlisted
  // (not disqualified — they may come in Wave 2 which loosens the rule).
  const wave = (opts.currentWave || 'wave-1').toLowerCase();
  if (app.texasFocus === 'OUTSIDE' && wave === 'wave-1') {
    flags.push('outside_texas_strict_wave');
    waitlisted = true;
  }

  const status = disqualified ? 'DISQUALIFIED' : waitlisted ? 'WAITLISTED' : 'QUALIFIED';
  return { status, autoFlags: flags };
}
