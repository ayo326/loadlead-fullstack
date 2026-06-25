/**
 * betaScoring — the AUTHORITATIVE scorer. Encodes the 7-dimension rubric
 * from docs/beta/Recruitment_Kit.md (max 15 points).
 *
 *   Volume         0-3   AUTO   loadsPerWeek band
 *   Segment fit    0-3   STAFF
 *   Geography      0-3   AUTO   texasFocus (MOSTLY=3, PARTLY=2, OUTSIDE=0)
 *   Lane overlap   0-2   STAFF  (helper surfaces other-side applicants)
 *   Pain           0-2   STAFF
 *   Tools          0-1   AUTO   bookingMethod/findMethod non-empty → 1
 *   Responsiveness 0-1   STAFF
 *
 * preComputeObjective() fills the AUTO dimensions on ingest. The STAFF
 * dimensions default to 0 and are filled by the dashboard's score editor
 * via applyStaffScores(). recomputeTotal() always re-derives the AUTO
 * dimensions from the application data so a staff edit can never corrupt
 * the objective half.
 */

import { BetaApplication } from '../types';

export type ScoreBreakdown = NonNullable<BetaApplication['scoreBreakdown']>;

/**
 * Normalize a Tally loadsPerWeek answer to a representative number.
 * Tally sends this as a band STRING ("Under 5", "5-20", "20-50", "50+")
 * or occasionally a number. We map to the band's lower bound so both the
 * LOW_VOLUME gate (< 5) and the Volume score can work on a number.
 *   "Under 5" / "<5" / "less than 5"  → 0
 *   "5-20" / "5–20" / "5 to 20"       → 5
 *   "20-50"                           → 20
 *   "50+" / "over 50"                 → 50
 *   42 (number)                       → 42
 */
export function normalizeLoadsPerWeek(raw: any): number | undefined {
  if (typeof raw === 'number') return Math.trunc(raw);
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (/under\s*5|less\s*than\s*5|<\s*5|fewer\s*than\s*5/.test(s)) return 0;
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

/** loadsPerWeek → Volume band (0-3). Accepts a number or a Tally band
 *  string. 0:<5, 1:5-9, 2:10-24, 3:25+. */
export function volumeBand(loadsPerWeek: number | string | undefined): number {
  const n = normalizeLoadsPerWeek(loadsPerWeek);
  if (typeof n !== 'number' || n < 5) return 0;
  if (n < 10) return 1;
  if (n < 25) return 2;
  return 3;
}

/** texasFocus → Geography (0-3). */
export function geographyScore(texasFocus: BetaApplication['texasFocus']): number {
  switch (texasFocus) {
    case 'MOSTLY': return 3;
    case 'PARTLY': return 2;
    case 'OUTSIDE': return 0;
    default: return 0;
  }
}

/**
 * Coerce a Tally field value to plain text. Tally sends multi-select
 * answers as ARRAYS (e.g. a "How do you book?" checkbox question), so any
 * field we treat as a string must pass through here first — otherwise a
 * `.trim()` on an array throws. Single values pass through; arrays join;
 * null/undefined → "".
 */
export function coerceText(v: any): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter(x => x != null).map(String).join(', ');
  if (v == null) return '';
  return String(v);
}

/**
 * Tool sophistication (0-1). Per the guide §13 this is specifically
 * "already uses a load board or TMS, so they can compare" — NOT merely
 * having any booking/finding method. So "Load board" (a shipper booking
 * option and a carrier finding option) or a free-text "TMS" mention scores
 * 1; "In-house team" / "Brokers" / "3PL" / "Dispatcher" score 0.
 */
const TOOL_RE = /load\s*board|\btms\b|transportation management/i;
export function toolsScore(
  side: BetaApplication['side'],
  data: BetaApplication['sideSpecificData'],
): number {
  const sophisticated = (v: any) => TOOL_RE.test(coerceText(v));
  const shipperHas = sophisticated(data?.shipper?.bookingMethod);
  const carrierHas = sophisticated(data?.carrier?.findMethod);
  if (side === 'SHIPPER') return shipperHas ? 1 : 0;
  if (side === 'CARRIER') return carrierHas ? 1 : 0;
  // BOTH: either side counts.
  return shipperHas || carrierHas ? 1 : 0;
}

/**
 * The volume dimension for a BOTH applicant uses the max of the two sides'
 * bands (they bring whichever volume is larger to the cohort).
 */
function volumeFor(app: Pick<BetaApplication, 'side' | 'sideSpecificData'>): number {
  const s = volumeBand(app.sideSpecificData?.shipper?.loadsPerWeek);
  const c = volumeBand(app.sideSpecificData?.carrier?.loadsPerWeek);
  if (app.side === 'SHIPPER') return s;
  if (app.side === 'CARRIER') return c;
  return Math.max(s, c);
}

/**
 * Compute the objective (AUTO) dimensions from the application. Staff
 * dimensions are left at their existing values (or 0 on first compute).
 */
export function preComputeObjective(
  app: Pick<BetaApplication, 'side' | 'texasFocus' | 'sideSpecificData'>,
  existing?: Partial<ScoreBreakdown>,
): ScoreBreakdown {
  return {
    volume: volumeFor(app),
    geography: geographyScore(app.texasFocus),
    tools: toolsScore(app.side, app.sideSpecificData),
    // staff dimensions — preserved if already set, else 0
    segmentFit: clamp(existing?.segmentFit ?? 0, 0, 3),
    laneOverlap: clamp(existing?.laneOverlap ?? 0, 0, 2),
    pain: clamp(existing?.pain ?? 0, 0, 2),
    responsiveness: clamp(existing?.responsiveness ?? 0, 0, 1),
  };
}

/**
 * Apply staff-edited subjective scores on top of the existing breakdown,
 * then re-derive the AUTO dimensions so they can't be tampered with via
 * the staff editor. Returns the full breakdown + total.
 */
export function applyStaffScores(
  app: Pick<BetaApplication, 'side' | 'texasFocus' | 'sideSpecificData'>,
  current: Partial<ScoreBreakdown> | undefined,
  staff: Partial<Pick<ScoreBreakdown, 'segmentFit' | 'laneOverlap' | 'pain' | 'responsiveness'>>,
): { breakdown: ScoreBreakdown; total: number } {
  const merged: ScoreBreakdown = {
    // AUTO — always recomputed from source data
    volume: volumeFor(app),
    geography: geographyScore(app.texasFocus),
    tools: toolsScore(app.side, app.sideSpecificData),
    // STAFF — take the incoming edit, else keep current, else 0
    segmentFit: clamp(staff.segmentFit ?? current?.segmentFit ?? 0, 0, 3),
    laneOverlap: clamp(staff.laneOverlap ?? current?.laneOverlap ?? 0, 0, 2),
    pain: clamp(staff.pain ?? current?.pain ?? 0, 0, 2),
    responsiveness: clamp(staff.responsiveness ?? current?.responsiveness ?? 0, 0, 1),
  };
  return { breakdown: merged, total: totalOf(merged) };
}

export function totalOf(b: ScoreBreakdown): number {
  return (
    b.volume + b.segmentFit + b.geography +
    b.laneOverlap + b.pain + b.tools + b.responsiveness
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Lane-overlap helper. Given an applicant and a set of candidate other-side
 * applicants, returns the candidates that share at least one lane region,
 * sorted so Texas-MOSTLY pairs surface first (the cohort thesis).
 *
 * Lanes are free-text (e.g. "Dallas → Houston"); we compare on normalized
 * tokens. A shared origin OR destination region counts as overlap.
 */
export function findLaneOverlaps(
  applicant: Pick<BetaApplication, 'applicationId' | 'side' | 'texasFocus' | 'sideSpecificData'>,
  candidates: Pick<BetaApplication, 'applicationId' | 'side' | 'texasFocus' | 'sideSpecificData' | 'fullName' | 'company' | 'workEmail'>[],
): { applicationId: string; sharedTokens: string[]; bothTexas: boolean }[] {
  const myLanes = lanesOf(applicant);
  const myTokens = new Set(myLanes.flatMap(tokenizeLane));
  const myTexas = applicant.texasFocus === 'MOSTLY';

  const results = candidates
    .filter(c => c.applicationId !== applicant.applicationId)
    .map(c => {
      const cTokens = new Set(lanesOf(c).flatMap(tokenizeLane));
      const shared = [...myTokens].filter(t => cTokens.has(t));
      const bothTexas = myTexas && c.texasFocus === 'MOSTLY';
      return { applicationId: c.applicationId, sharedTokens: shared, bothTexas };
    })
    // surface a candidate if it shares a lane token OR both are Texas-MOSTLY
    .filter(r => r.sharedTokens.length > 0 || r.bothTexas)
    // Texas pairs first, then by number of shared tokens desc
    .sort((a, b) => {
      if (a.bothTexas !== b.bothTexas) return a.bothTexas ? -1 : 1;
      return b.sharedTokens.length - a.sharedTokens.length;
    });

  return results;
}

function lanesOf(app: Pick<BetaApplication, 'side' | 'sideSpecificData'>): string[] {
  const s = app.sideSpecificData?.shipper?.lanes ?? [];
  const c = app.sideSpecificData?.carrier?.lanes ?? [];
  return [...s, ...c];
}

/** Break "Dallas → Houston" into normalized region tokens. */
function tokenizeLane(lane: string): string[] {
  return lane
    .toLowerCase()
    .split(/[->–—,/|]+|\bto\b/)
    .map(s => s.trim())
    .filter(Boolean);
}
