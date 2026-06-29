/**
 * Tests for liquidityMetrics. Run with either:
 *   npx tsx --test liquidityMetrics.test.ts
 *   or vitest
 *
 * Reproduces the seeded demo loads and asserts the same numbers the spreadsheet shows.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { computeLiquidity, type LoadRecord } from "../../../src/services/liquidity/liquidityMetrics";

const DAY = 86_400_000;
const base = new Date(Date.UTC(2026, 5, 15)); // Monday 2026-06-15

function addWeek(out: LoadRecord[], lane: string, wk: number, total: number, covered: number) {
  const d0 = new Date(base.getTime() + wk * 7 * DAY);
  for (let k = 0; k < total; k++) {
    const day = new Date(d0.getTime() + (k % 5) * DAY);
    const isCov = k < covered;
    out.push({
      loadId: `${lane}-${wk}-${k}`,
      lane,
      postedAt: day.toISOString(),
      coveredAt: isCov ? new Date(day.getTime() + 3 * 3600_000).toISOString() : null,
      covered: isCov,
      broadcastCount: 12,
    });
  }
}

function demoLoads(): LoadRecord[] {
  const out: LoadRecord[] = [];
  addWeek(out, "Austin to Houston", 0, 4, 2);
  addWeek(out, "Austin to Houston", 1, 3, 2);
  addWeek(out, "Austin to Houston", 2, 5, 4);
  addWeek(out, "Austin to Houston", 3, 4, 4);
  addWeek(out, "Austin to Dallas-Fort Worth", 0, 3, 2);
  addWeek(out, "Austin to Dallas-Fort Worth", 1, 3, 3);
  return out;
}

const NOW = new Date(Date.UTC(2026, 6, 9)); // within the 4 active weeks horizon

test("dials aggregate correctly", () => {
  const r = computeLiquidity(demoLoads(), { now: NOW, weeks: 8 });
  assert.equal(r.dials.loadsPosted, 22);
  assert.equal(r.dials.loadsCovered, 17); // 12 AH + 5 AD
  assert.ok(Math.abs(r.dials.fillRate - 17 / 22) < 1e-9);
  assert.equal(r.dials.trustIncidents, 0);
});

test("cumulative fill rate matches the spreadsheet trend", () => {
  const r = computeLiquidity(demoLoads(), { now: NOW, weeks: 8 });
  const byWeek: Record<string, any> = Object.fromEntries(
    r.cumulativeByLaneOverTime.map((p) => [p.weekStart, p])
  );
  const round2 = (x: any) => Math.round(Number(x) * 100);

  // Austin to Houston: 50, 57, 67, 75 then flat
  assert.equal(round2(byWeek["2026-06-15"]["Austin to Houston"]), 50);
  assert.equal(round2(byWeek["2026-06-22"]["Austin to Houston"]), 57);
  assert.equal(round2(byWeek["2026-06-29"]["Austin to Houston"]), 67);
  assert.equal(round2(byWeek["2026-07-06"]["Austin to Houston"]), 75);

  // Austin to Dallas-Fort Worth: 67 then 83
  assert.equal(round2(byWeek["2026-06-15"]["Austin to Dallas-Fort Worth"]), 67);
  assert.equal(round2(byWeek["2026-06-22"]["Austin to Dallas-Fort Worth"]), 83);

  // weeks before the first load are null, not a false zero
  assert.equal(byWeek["2026-05-18"]["Austin to Houston"], null);
});

test("per lane fill rate is correct", () => {
  const r = computeLiquidity(demoLoads(), { now: NOW, weeks: 8 });
  const ah = r.byLane.find((l) => l.lane === "Austin to Houston");
  assert.equal(ah?.posted, 16);
  assert.equal(ah?.covered, 12);
  assert.ok(Math.abs((ah?.fillRate ?? 0) - 12 / 16) < 1e-9);
});

test("avg time to cover by lane is computed and gaps before data", () => {
  const r = computeLiquidity(demoLoads(), { now: NOW, weeks: 8 });
  const byWeek: Record<string, any> = Object.fromEntries(
    r.avgTimeToCoverByLaneOverTime.map((p) => [p.weekStart, p])
  );
  // every covered demo load is covered 3 hours after posting
  assert.equal(byWeek["2026-06-15"]["Austin to Houston"], 3);
  assert.equal(byWeek["2026-07-06"]["Austin to Houston"], 3);
  // a week before the first load is a gap, not a zero
  assert.equal(byWeek["2026-05-18"]["Austin to Houston"], null);
});
