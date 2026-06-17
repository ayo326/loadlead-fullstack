import { describe, it, expect } from 'vitest';
import * as Calc from '../../../src/services/dashboardCalc';
import { LoadStatus, OfferStatus, Load, Offer } from '../../../src/types';

// Minimal load/offer factories — only the fields the calculator reads.
function ld(overrides: Partial<Load> = {}): Load {
  return {
    loadId: `L-${Math.random().toString(36).slice(2, 8)}`,
    shipperId: 'S1',
    status: LoadStatus.OPEN,
    rateAmount: 1000,
    rateType: 'FLAT_RATE',
    totalMiles: 500,
    deliveryDate: Date.now() + 86_400_000,
    ...overrides,
  } as Load;
}
function of(overrides: Partial<Offer> = {}): Offer {
  return {
    offerId: `O-${Math.random().toString(36).slice(2, 8)}`,
    loadId: 'L1',
    driverId: 'D1',
    status: OfferStatus.OFFERED,
    createdAt: Date.now(),
    expiresAt: Date.now() + 900_000,
    driverDistanceMiles: 10,
    ...overrides,
  } as Offer;
}

describe('dashboardCalc — activeLoadCounts', () => {
  it('counts each known status; unrecognised statuses stay at 0 (no fabrication)', () => {
    const loads = [
      ld({ status: LoadStatus.BOOKED }),
      ld({ status: LoadStatus.BOOKED }),
      ld({ status: LoadStatus.IN_TRANSIT }),
      ld({ status: LoadStatus.DELIVERED }),
      ld({ status: LoadStatus.OPEN }),       // not counted
    ];
    const c = Calc.activeLoadCounts(loads);
    expect(c).toEqual({ booked: 2, dispatched: 0, inTransit: 1, atPickup: 0, delivered: 1 });
  });
});

describe('dashboardCalc — unassignedLoads', () => {
  it('returns BOOKED/OFFERED/OPEN loads with no driver assigned', () => {
    const loads = [
      ld({ status: LoadStatus.BOOKED, assignedDriverId: undefined }),
      ld({ status: LoadStatus.BOOKED, assignedDriverId: 'D1' }),
      ld({ status: LoadStatus.IN_TRANSIT, assignedDriverId: undefined }),  // wrong status
      ld({ status: LoadStatus.OPEN, assignedDriverId: undefined }),
    ];
    const result = Calc.unassignedLoads(loads);
    expect(result.length).toBe(2);
  });
});

describe('dashboardCalc — etaAtRisk', () => {
  it('flags BOOKED/IN_TRANSIT loads whose ETA is past delivery date', () => {
    const past = Date.now() - 3_600_000;
    const future = Date.now() + 3_600_000;
    const loads = [
      ld({ loadId: 'late', status: LoadStatus.IN_TRANSIT, deliveryDate: past }),
      ld({ loadId: 'onTime', status: LoadStatus.IN_TRANSIT, deliveryDate: future }),
      ld({ loadId: 'wrongStatus', status: LoadStatus.DELIVERED, deliveryDate: past }),
    ];
    const result = Calc.etaAtRisk(loads);
    expect(result.length).toBe(1);
    expect(result[0].loadId).toBe('late');
    expect(result[0].minutesLate).toBeGreaterThan(0);
  });
});

describe('dashboardCalc — grossRevenue', () => {
  it('sums delivered + in-flight loads; excludes cancelled/expired/draft', () => {
    const now = Date.now();
    const loads = [
      ld({ status: LoadStatus.DELIVERED, rateAmount: 1000, rateType: 'FLAT_RATE', deliveryDate: now }),
      ld({ status: LoadStatus.IN_TRANSIT, rateAmount: 2000, rateType: 'FLAT_RATE', deliveryDate: now - 10 * 86_400_000 }),
      ld({ status: LoadStatus.CANCELLED, rateAmount: 999, rateType: 'FLAT_RATE' }),
      ld({ status: LoadStatus.DRAFT, rateAmount: 999, rateType: 'FLAT_RATE' }),
    ];
    const g = Calc.grossRevenue(loads, now);
    expect(g.total).toBe(3000);
    expect(g.week).toBe(1000);
    expect(g.month).toBe(3000);
  });
});

describe('dashboardCalc — rpmBreakdown', () => {
  it('averages PER_MILE loads; FLAT_RATE divided by miles; null when no usable loads', () => {
    const loads = [
      ld({ loadId: 'p1', rateAmount: 2.5, rateType: 'PER_MILE', totalMiles: 500 }),
      ld({ loadId: 'p2', rateAmount: 3.0, rateType: 'PER_MILE', totalMiles: 600 }),
      ld({ loadId: 'f1', rateAmount: 1000, rateType: 'FLAT_RATE', totalMiles: 500 }),  // → 2.0
    ];
    const r = Calc.rpmBreakdown(loads);
    expect(r.byLoad).toHaveLength(3);
    expect(r.avg).toBeCloseTo((2.5 + 3.0 + 2.0) / 3, 2);
  });

  it('returns avg=null (NOT 0) when no load has both rate + miles — no fabrication', () => {
    const loads = [
      ld({ rateAmount: 0, rateType: 'PER_MILE', totalMiles: 0 }),
      ld({ rateAmount: 1000, rateType: 'PER_MILE' }) as any,
    ];
    delete (loads[1] as any).totalMiles;
    const r = Calc.rpmBreakdown(loads);
    expect(r.avg).toBeNull();
  });
});

describe('dashboardCalc — payeeBreakdown', () => {
  it('sums by FACTOR vs CARRIER', () => {
    const payees = [
      { payee: 'CARRIER' as const, amount: 1500 },
      { payee: 'FACTOR'  as const, amount: 800 },
      { payee: 'CARRIER' as const, amount: 500 },
    ];
    expect(Calc.payeeBreakdown(payees)).toEqual({ carrier: 2000, factor: 800 });
  });
});

describe('dashboardCalc — acceptanceMetrics', () => {
  it('reports counts + rates; nulls (NOT 0) when no offers in period', () => {
    expect(Calc.acceptanceMetrics([])).toMatchObject({
      offered: 0, accepted: 0, declined: 0, expired: 0,
      acceptanceRate: null, rejectionRate: null,
    });
    const m = Calc.acceptanceMetrics([
      of({ status: OfferStatus.ACCEPTED }),
      of({ status: OfferStatus.ACCEPTED }),
      of({ status: OfferStatus.DECLINED }),
      of({ status: OfferStatus.EXPIRED }),
    ]);
    expect(m.offered).toBe(4);
    expect(m.acceptanceRate).toBe(0.5);
    expect(m.rejectionRate).toBe(0.25);
  });
});

describe('dashboardCalc — onboardingRollup', () => {
  it('buckets users by idvStatus', () => {
    const users = [
      { idvStatus: 'VERIFIED' },
      { idvStatus: 'VERIFIED' },
      { idvStatus: 'PENDING' },
      { idvStatus: 'UNVERIFIED' },
      { idvStatus: 'REJECTED' },
      { idvStatus: 'EXPIRED' },
      {},  // missing idvStatus → pending
    ];
    expect(Calc.onboardingRollup(users)).toEqual({ verified: 2, pending: 3, blocked: 2 });
  });
});

describe('dashboardCalc — driverAvailability', () => {
  it('reports on-load when driver has accepted offer or in-flight load', () => {
    const offers = [of({ driverId: 'D1', status: OfferStatus.ACCEPTED })];
    const loads = [ld({ status: LoadStatus.IN_TRANSIT, assignedDriverId: 'D2' })];
    expect(Calc.driverAvailability('D1', offers, loads)).toBe('on-load');
    expect(Calc.driverAvailability('D2', offers, loads)).toBe('on-load');
    expect(Calc.driverAvailability('D3', offers, loads)).toBe('free');
  });
});

describe('dashboardCalc — Unavailable shapes (no fabrication)', () => {
  it('🔴 integrations return integration_not_connected', () => {
    expect(Calc.NOT_CONNECTED).toEqual({ available: false, reason: 'integration_not_connected' });
  });

  it('🟡 pending capture returns pending_capture', () => {
    expect(Calc.PENDING_CAPTURE).toEqual({ available: false, reason: 'pending_capture' });
    expect(Calc.otpMetrics([]).pickupPct).toEqual(Calc.PENDING_CAPTURE);
    expect(Calc.dwell([])).toEqual(Calc.PENDING_CAPTURE);
  });

  it('factoring approved/funded surface pending_capture (no integrated callbacks yet)', () => {
    const f = Calc.factoringPipeline([{ status: 'SUBMITTED' }, { status: 'SUBMITTED' }]);
    expect(f.submitted).toBe(2);
    expect(f.approved).toEqual(Calc.PENDING_CAPTURE);
    expect(f.funded).toEqual(Calc.PENDING_CAPTURE);
  });
});
