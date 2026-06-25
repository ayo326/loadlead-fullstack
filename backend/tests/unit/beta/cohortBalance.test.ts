/**
 * Cohort-balance verdict — the bug fix proofs. Every TASK acceptance case
 * maps to a test here. balanceVerdict is a pure function over the counts;
 * we hand it CohortBalanceData directly (no DB).
 *
 * THE BUG: 3 shippers / 0 carriers, 0 admitted used to read "Balanced"
 * (0:0 admitted → trivially balanced). It must read "Need carriers".
 */

import { describe, it, expect } from 'vitest';
import { balanceVerdict, type CohortBalanceData } from '../../../src/services/betaApplicationService';

function data(
  admitted: [number, number, number],   // [shippers, carriers, both]
  pipeline: [number, number, number],
  seatsFilled: number,
): CohortBalanceData {
  return {
    admitted: { shippers: admitted[0], carriers: admitted[1], both: admitted[2] },
    pipeline: { shippers: pipeline[0], carriers: pipeline[1], both: pipeline[2] },
    seatsFilled,
  };
}

describe('balanceVerdict — measures admitted if seats filled, else pipeline', () => {
  it('THE BUG: 3 shippers / 0 carriers in pipeline, 0 admitted → NEED_CARRIERS (not BALANCED)', () => {
    const v = balanceVerdict(data([0, 0, 0], [3, 0, 0], 0));
    expect(v.measuring).toBe('pipeline');
    expect(v.state).toBe('NEED_CARRIERS');
  });

  it('1 shipper / 1 carrier admitted → BALANCED', () => {
    const v = balanceVerdict(data([1, 1, 0], [0, 0, 0], 2));
    expect(v.measuring).toBe('admitted');
    expect(v.state).toBe('BALANCED');
  });

  it('2 shippers / 0 carriers admitted → NEED_CARRIERS', () => {
    expect(balanceVerdict(data([2, 0, 0], [0, 0, 0], 2)).state).toBe('NEED_CARRIERS');
  });

  it('0 shippers / 2 carriers admitted → NEED_SHIPPERS', () => {
    expect(balanceVerdict(data([0, 2, 0], [0, 0, 0], 2)).state).toBe('NEED_SHIPPERS');
  });

  it('5 shippers / 1 carrier → SKEWED to shippers', () => {
    const v = balanceVerdict(data([0, 0, 0], [5, 1, 0], 0));
    expect(v.state).toBe('SKEWED');
    expect(v.skewedTo).toBe('shippers');
  });

  it('1 shipper / 5 carriers → SKEWED to carriers', () => {
    const v = balanceVerdict(data([0, 0, 0], [1, 5, 0], 0));
    expect(v.state).toBe('SKEWED');
    expect(v.skewedTo).toBe('carriers');
  });

  it('0 / 0 (nothing anywhere) → EMPTY', () => {
    expect(balanceVerdict(data([0, 0, 0], [0, 0, 0], 0)).state).toBe('EMPTY');
  });

  it('admitted population wins over pipeline once any seat is filled', () => {
    // 1:1 admitted (BALANCED) even though the pipeline is all-shipper.
    const v = balanceVerdict(data([1, 1, 0], [9, 0, 0], 2));
    expect(v.measuring).toBe('admitted');
    expect(v.state).toBe('BALANCED');
  });

  it('40% boundary: 2 carriers of 5 total = 40% → BALANCED (not skewed)', () => {
    // shippers 3, carriers 2, total 5, minority 2/5 = 0.4 → balanced
    expect(balanceVerdict(data([0, 0, 0], [3, 2, 0], 0)).state).toBe('BALANCED');
  });

  it('just under 40%: 2 carriers of 6 total = 33% → SKEWED', () => {
    expect(balanceVerdict(data([0, 0, 0], [4, 2, 0], 0)).state).toBe('SKEWED');
  });
});

describe('BOTH applicants count toward both side tallies', () => {
  it('a single BOTH applicant makes the pipeline 1:1 → BALANCED', () => {
    // one BOTH app → shippers 1, carriers 1 (same person supplies + demands)
    const v = balanceVerdict(data([0, 0, 0], [1, 1, 1], 0));
    expect(v.state).toBe('BALANCED');
  });

  it('2 shippers + 1 BOTH → shippers 3, carriers 1 → SKEWED to shippers', () => {
    // pipeline counts: shippers = 2 SHIPPER + 1 BOTH = 3; carriers = 1 BOTH = 1
    const v = balanceVerdict(data([0, 0, 0], [3, 1, 1], 0));
    expect(v.state).toBe('SKEWED');
    expect(v.skewedTo).toBe('shippers');
  });
});
