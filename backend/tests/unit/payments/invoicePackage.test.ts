/**
 * Phase 8: factoring-ready invoice package (per line item).
 *
 * Proves the factorability rules per line (linehaul needs POD + both verified +
 * terms; an accessorial needs APPROVED + evidence + terms) and that
 * advanceableTotalCents equals the sum of factorable lines only.
 */
import { describe, it, expect } from 'vitest';
import { InvoicePackageService, InvoicePackageContext } from '../../../src/services/invoicePackageService';
import type { AccessorialCharge, ChargeStatus } from '../../../src/services/accessorialChargeService';

function charge(status: ChargeStatus, amountCents: number, withEvidence = true): AccessorialCharge {
  return {
    chargeId: `charge_${status}_${amountCents}`,
    loadId: 'load-1',
    stopId: 'PICKUP',
    type: 'DETENTION',
    status,
    dwellMinutes: 300,
    billableMinutes: 180,
    layoverDays: 0,
    rateClass: 'STANDARD',
    rateCents: 5000,
    amountCents,
    policyVersion: 1,
    policyHash: 'h',
    policySnapshot: {} as any,
    ...(withEvidence ? { arrivalEventId: 'a1', departureEventId: 'd1' } : {}),
    provisional: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function ctx(over: Partial<InvoicePackageContext> = {}): InvoicePackageContext {
  return {
    invoiceId: 'inv-1',
    loadId: 'load-1',
    carrierId: 'carrier-1',
    debtor: { id: 'shipper-1', verified: true },
    mover: { id: 'carrier-1', verified: true },
    linehaulAmountCents: 150000,
    podAttested: true,
    withinTerms: true,
    charges: [],
    ...over,
  };
}

describe('linehaul factorability', () => {
  it('is factorable with POD, both verified, and within terms', () => {
    const pkg = InvoicePackageService.build(ctx());
    const lh = pkg.lines.find((l) => l.kind === 'LINEHAUL')!;
    expect(lh.factorable).toBe(true);
    expect(lh.amountCents).toBe(150000);
    expect(pkg.advanceableTotalCents).toBe(150000);
  });

  it('is not factorable without POD, and the reason explains it', () => {
    const pkg = InvoicePackageService.build(ctx({ podAttested: false }));
    const lh = pkg.lines.find((l) => l.kind === 'LINEHAUL')!;
    expect(lh.factorable).toBe(false);
    expect(lh.reason).toMatch(/POD not attested/);
    expect(pkg.advanceableTotalCents).toBe(0);
  });

  it('is not factorable when the debtor is unverified', () => {
    const pkg = InvoicePackageService.build(ctx({ debtor: { id: 's', verified: false } }));
    expect(pkg.lines[0].factorable).toBe(false);
    expect(pkg.lines[0].reason).toMatch(/debtor not verified/);
  });
});

describe('accessorial factorability', () => {
  it('an APPROVED accessorial with evidence and terms is factorable', () => {
    const pkg = InvoicePackageService.build(ctx({ charges: [charge('APPROVED', 7500)] }));
    const line = pkg.lines.find((l) => l.kind === 'ACCESSORIAL')!;
    expect(line.factorable).toBe(true);
    expect(pkg.advanceableTotalCents).toBe(150000 + 7500);
  });

  it.each<[ChargeStatus]>([['ACCRUING'], ['PENDING_REVIEW'], ['DISPUTED'], ['ADJUSTED']])(
    'a %s accessorial is not factorable',
    (status) => {
      const pkg = InvoicePackageService.build(ctx({ charges: [charge(status, 7500)] }));
      const line = pkg.lines.find((l) => l.kind === 'ACCESSORIAL')!;
      expect(line.factorable).toBe(false);
      expect(line.reason).toMatch(new RegExp(status));
      expect(pkg.advanceableTotalCents).toBe(150000); // accessorial excluded
    }
  );

  it('an APPROVED accessorial without evidence is not factorable', () => {
    const pkg = InvoicePackageService.build(ctx({ charges: [charge('APPROVED', 7500, false)] }));
    const line = pkg.lines.find((l) => l.kind === 'ACCESSORIAL')!;
    expect(line.factorable).toBe(false);
    expect(line.reason).toMatch(/no stop-event evidence/);
  });

  it('a SETTLED accessorial is not advanceable (already paid)', () => {
    const pkg = InvoicePackageService.build(ctx({ charges: [charge('SETTLED', 7500)] }));
    const line = pkg.lines.find((l) => l.kind === 'ACCESSORIAL')!;
    expect(line.factorable).toBe(false);
    expect(line.reason).toMatch(/already settled/);
  });
});

describe('advanceableTotalCents and assignment', () => {
  it('sums only factorable lines and carries the active assignment', () => {
    const pkg = InvoicePackageService.build(
      ctx({
        charges: [charge('APPROVED', 7500), charge('PENDING_REVIEW', 30000), charge('APPROVED', 5000)],
        activeAssignment: { assignmentId: 'a1' } as any,
      })
    );
    // linehaul 150000 + two approved (7500 + 5000), pending 30000 excluded
    expect(pkg.advanceableTotalCents).toBe(162500);
    expect(pkg.activeAssignment).toEqual({ assignmentId: 'a1' });
  });
});
