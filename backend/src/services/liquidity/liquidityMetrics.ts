/**
 * LoadLead liquidity metrics (pure, framework agnostic, unit testable).
 *
 * Turns a list of beta loads into the same numbers as the Lane Liquidity Tracker
 * spreadsheet: the gate dials, per lane fill, and cumulative fill rate by lane over time.
 *
 * No DynamoDB, Express, or React in here on purpose, so it is easy to test and reuse.
 */

export interface LoadRecord {
  loadId: string;
  lane: string; // normalized label, for example "Austin to Houston"
  equipment?: string;
  postedAt: string; // ISO 8601, when the load was posted to the pool
  coveredAt?: string | null; // ISO 8601, when a verified carrier took it
  covered: boolean; // whether the load was covered at all
  carrierId?: string | null;
  broadcastCount?: number; // how many pool carriers the load was broadcast to
  noShow?: boolean; // carrier accepted then failed to show
  trustIncident?: boolean; // fraud, double brokering, or broken attestation chain
}

export interface Dials {
  loadsPosted: number;
  loadsCovered: number;
  fillRate: number; // 0 to 1
  avgTimeToCoverHours: number | null;
  noShows: number;
  trustIncidents: number;
  avgBroadcastSize: number | null;
}

export interface LaneFill {
  lane: string;
  posted: number;
  covered: number;
  fillRate: number; // 0 to 1
}

/** One row per week. Lane keys map to a cumulative fill rate (0 to 1) or null for no data yet. */
export type CumulativePoint = { weekStart: string } & Record<string, number | string | null>;

export interface LiquidityResult {
  range: { from: string; to: string; weeks: number };
  lanes: string[];
  dials: Dials;
  byLane: LaneFill[];
  cumulativeByLaneOverTime: CumulativePoint[];
  avgTimeToCoverByLaneOverTime: CumulativePoint[];
  gateTargets: { fillRate: number; maxTimeToCoverHours: number; trustIncidents: number };
  generatedAt: string;
}

export interface LiquidityOptions {
  /** Reference "now". Defaults to current time. */
  now?: Date;
  /** Number of trailing weeks to chart. Defaults to 8. */
  weeks?: number;
  /** Wave 1 gate targets surfaced alongside the data. */
  gateTargets?: { fillRate: number; maxTimeToCoverHours: number; trustIncidents: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GATE = { fillRate: 0.65, maxTimeToCoverHours: 4, trustIncidents: 0 };

/** Monday 00:00 UTC of the week containing d. */
export function mondayUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0 Sun to 6 Sat
  const back = (dow + 6) % 7; // days since Monday
  return new Date(x.getTime() - back * DAY_MS);
}

/** YYYY-MM-DD in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / (60 * 60 * 1000);
}

function round(n: number, dp = 1): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export function computeDials(loads: LoadRecord[]): Dials {
  const posted = loads.length;
  const coveredLoads = loads.filter((l) => l.covered);
  const covered = coveredLoads.length;

  const ttc = coveredLoads
    .filter((l) => l.postedAt && l.coveredAt)
    .map((l) => hoursBetween(l.postedAt, l.coveredAt as string))
    .filter((h) => Number.isFinite(h) && h >= 0);

  const broadcasts = loads
    .map((l) => l.broadcastCount)
    .filter((b): b is number => typeof b === "number" && b >= 0);

  return {
    loadsPosted: posted,
    loadsCovered: covered,
    fillRate: posted ? covered / posted : 0,
    avgTimeToCoverHours: ttc.length ? round(ttc.reduce((a, b) => a + b, 0) / ttc.length, 1) : null,
    noShows: loads.filter((l) => l.noShow).length,
    trustIncidents: loads.filter((l) => l.trustIncident).length,
    avgBroadcastSize: broadcasts.length
      ? round(broadcasts.reduce((a, b) => a + b, 0) / broadcasts.length, 0)
      : null,
  };
}

export function computeByLane(loads: LoadRecord[]): LaneFill[] {
  const map = new Map<string, { posted: number; covered: number }>();
  for (const l of loads) {
    const cur = map.get(l.lane) ?? { posted: 0, covered: 0 };
    cur.posted += 1;
    if (l.covered) cur.covered += 1;
    map.set(l.lane, cur);
  }
  return [...map.entries()]
    .map(([lane, v]) => ({ lane, posted: v.posted, covered: v.covered, fillRate: v.posted ? v.covered / v.posted : 0 }))
    .sort((a, b) => a.lane.localeCompare(b.lane));
}

/**
 * Cumulative fill rate to date per lane, bucketed by week.
 * Cumulative (not weekly) on purpose: it never dips to zero on a quiet week, it goes flat,
 * which matches the spreadsheet and is the number you track against the gate.
 */
export function computeCumulativeByLaneOverTime(
  loads: LoadRecord[],
  fromMonday: Date,
  toMonday: Date,
  lanes: string[]
): CumulativePoint[] {
  const weekStarts: Date[] = [];
  for (let t = fromMonday.getTime(); t <= toMonday.getTime(); t += 7 * DAY_MS) {
    weekStarts.push(new Date(t));
  }

  const points: CumulativePoint[] = [];
  for (const ws of weekStarts) {
    const weekEnd = new Date(ws.getTime() + 7 * DAY_MS - 1); // inclusive end of week
    const point: CumulativePoint = { weekStart: isoDate(ws) };
    for (const lane of lanes) {
      let posted = 0;
      let covered = 0;
      for (const l of loads) {
        if (l.lane !== lane) continue;
        if (new Date(l.postedAt).getTime() <= weekEnd.getTime()) {
          posted += 1;
          if (l.covered) covered += 1;
        }
      }
      point[lane] = posted ? covered / posted : null; // null renders as a gap, not a false zero
    }
    points.push(point);
  }
  return points;
}

/**
 * Cumulative average time to cover (hours) to date per lane, bucketed by week.
 * Parallels the fill rate chart so both gate dials trend together. Null where a lane
 * has no covered loads yet, which the chart draws as a gap.
 */
export function computeAvgTtcByLaneOverTime(
  loads: LoadRecord[],
  fromMonday: Date,
  toMonday: Date,
  lanes: string[]
): CumulativePoint[] {
  const weekStarts: Date[] = [];
  for (let t = fromMonday.getTime(); t <= toMonday.getTime(); t += 7 * DAY_MS) {
    weekStarts.push(new Date(t));
  }

  const points: CumulativePoint[] = [];
  for (const ws of weekStarts) {
    const weekEnd = new Date(ws.getTime() + 7 * DAY_MS - 1);
    const point: CumulativePoint = { weekStart: isoDate(ws) };
    for (const lane of lanes) {
      let sum = 0;
      let n = 0;
      for (const l of loads) {
        if (l.lane !== lane) continue;
        if (!l.covered || !l.coveredAt) continue;
        if (new Date(l.postedAt).getTime() <= weekEnd.getTime()) {
          const h = hoursBetween(l.postedAt, l.coveredAt);
          if (Number.isFinite(h) && h >= 0) {
            sum += h;
            n += 1;
          }
        }
      }
      point[lane] = n ? round(sum / n, 1) : null;
    }
    points.push(point);
  }
  return points;
}

export function computeLiquidity(loads: LoadRecord[], options: LiquidityOptions = {}): LiquidityResult {
  const now = options.now ?? new Date();
  const weeks = options.weeks ?? 8;
  const gateTargets = options.gateTargets ?? DEFAULT_GATE;

  const toMonday = mondayUTC(now);
  const fromMonday = new Date(toMonday.getTime() - (weeks - 1) * 7 * DAY_MS);

  const lanes = [...new Set(loads.map((l) => l.lane))].sort((a, b) => a.localeCompare(b));

  return {
    range: { from: isoDate(fromMonday), to: isoDate(now), weeks },
    lanes,
    dials: computeDials(loads),
    byLane: computeByLane(loads),
    cumulativeByLaneOverTime: computeCumulativeByLaneOverTime(loads, fromMonday, toMonday, lanes),
    avgTimeToCoverByLaneOverTime: computeAvgTtcByLaneOverTime(loads, fromMonday, toMonday, lanes),
    gateTargets,
    generatedAt: now.toISOString(),
  };
}
