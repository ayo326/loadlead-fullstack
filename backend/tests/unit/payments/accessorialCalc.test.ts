/**
 * Pure accessorial calc tests — the Audit v8 F1 regression guard.
 *
 * F1: the detention -> layover transition used to DISCARD detention and bill a
 * flat layover instead, so the total charge could DROP as dwell increased past
 * the threshold (e.g. 24h STANDARD = $1,100 detention, 24h01m = $300 layover).
 * The fixed model keeps the first-window detention and ADDS a layover surcharge
 * beyond the threshold, so the charge is monotonic non-decreasing in dwell.
 */
import { describe, it, expect } from 'vitest';
import { computeAccessorialFromDwell } from '../../../src/services/accessorialCalc';
import { DEFAULT_ACCESSORIAL_POLICY } from '../../../src/config/accessorialPolicy';
import type { AccessorialRateClass } from '../../../src/config/accessorialPolicy';

const P = DEFAULT_ACCESSORIAL_POLICY; // freeTime 120, threshold 1440, incr 15,
                                      // detention $50/$150/$175 per hr, layover $150/day
const CLASSES: AccessorialRateClass[] = ['STANDARD', 'SPECIALIZED', 'HAZMAT'];
const amt = (dwell: number, cls: AccessorialRateClass) =>
  computeAccessorialFromDwell(dwell, cls, P).amountCents;

describe('accessorialCalc — detention is a penalty, layover is additive (F1)', () => {
  it('crossing the 24h threshold NEVER decreases the charge (the F1 defect)', () => {
    for (const cls of CLASSES) {
      const atThreshold = amt(1440, cls);   // last detention minute
      const justOver = amt(1441, cls);       // first layover minute
      expect(justOver).toBeGreaterThan(atThreshold); // was: justOver < atThreshold ($300 < $1,100)
      // the jump is exactly one layover day on top of the frozen detention
      expect(justOver).toBe(atThreshold + P.layoverDailyRateCents);
    }
  });

  it('reports detention + layover components that sum to the total', () => {
    const c = computeAccessorialFromDwell(1441, 'STANDARD', P);
    expect(c.type).toBe('LAYOVER');
    expect(c.detainedMinutes).toBe(1320);      // 22h detention frozen at the threshold
    expect(c.layoverDays).toBe(1);             // 1 started 24h period beyond the threshold
    expect(c.detentionCents).toBe(165000);     // 22h * $75
    expect(c.layoverCents).toBe(15000);        // 1 * $150
    expect(c.amountCents).toBe(180000);        // sum
    expect(c.detentionCents + c.layoverCents).toBe(c.amountCents);
  });

  it('exact boundary amounts per rate class', () => {
    // detention at the threshold (22h billable) + 1 layover day at 24h01m
    expect(amt(1440, 'STANDARD')).toBe(165000);
    expect(amt(1441, 'STANDARD')).toBe(180000);
    expect(amt(1440, 'SPECIALIZED')).toBe(198000);
    expect(amt(1441, 'SPECIALIZED')).toBe(213000);
    expect(amt(1440, 'HAZMAT')).toBe(275000);
    expect(amt(1441, 'HAZMAT')).toBe(290000);
  });

  it('layover surcharge escalates one started day at a time', () => {
    expect(amt(2880, 'STANDARD')).toBe(180000); // 48h00m: still 1 day beyond threshold
    expect(amt(2881, 'STANDARD')).toBe(195000); // 48h01m: 2 days beyond -> +$150
  });

  it('total charge is monotonic non-decreasing in dwell (property)', () => {
    for (const cls of CLASSES) {
      let prev = -1;
      for (let dwell = 0; dwell <= 4320; dwell++) { // 0 to 72h, minute by minute
        const a = amt(dwell, cls);
        expect(a).toBeGreaterThanOrEqual(prev);
        prev = a;
      }
    }
  });

  it('per-component caps clamp each part and keep the charge monotonic', () => {
    const caps = { detentionMaxCents: 50000, layoverMaxCents: 10000 };
    const c = computeAccessorialFromDwell(2881, 'HAZMAT', P, caps);
    expect(c.detentionCents).toBe(50000); // clamped from 385000
    expect(c.layoverCents).toBe(10000);   // clamped from 30000
    expect(c.amountCents).toBe(60000);
    expect(c.capped).toBe(true);
    // still non-decreasing under caps
    let prev = -1;
    for (let dwell = 0; dwell <= 4320; dwell += 5) {
      const a = computeAccessorialFromDwell(dwell, 'HAZMAT', P, caps).amountCents;
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});
