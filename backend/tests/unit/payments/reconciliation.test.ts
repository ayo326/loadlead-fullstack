/**
 * Phase 10: integration, reconciliation, and recourse.
 *
 * Proves the hard invariants: no advance against a non-APPROVED accessorial;
 * idempotent advances; a late-approved accessorial supplements under FULL_INVOICE
 * and routes to the mover under LINEHAUL_ONLY; payment routes to the payee and
 * releases reserve minus fee; recourse non-payment flags a scoped buyback + trust
 * event while non-recourse does not; and no clawback when nothing was advanced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, query, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const pk = (it: any) => it?.outcomeId ?? it?.advanceId; // the money tables' partition keys
  return {
    tables,
    // Honour the conditional idempotent put: a duplicate attribute_not_exists
    // insert throws (as DynamoDB would), so the service reads back the winner.
    putItem: vi.fn(async (table: string, item: any, opts?: any) => {
      const arr = (tables[table] ??= []);
      if (/attribute_not_exists/.test(opts?.conditionExpression ?? '') && arr.some((x) => pk(x) === pk(item))) {
        const e: any = new Error('conditional check failed');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      arr.push(item);
    }),
    getItem: vi.fn(async (table: string, keyObj: any) => {
      const [kf, kv] = Object.entries(keyObj)[0] as [string, any];
      return (tables[table] ?? []).find((x) => x[kf] === kv) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    // V2-M1 GSI query: single-attribute equality (invoiceId-index) over the store.
    query: vi.fn(async (table: string, _index: any, _cond: any, names: Record<string, string>, values: Record<string, any>) => {
      const attr = Object.values(names)[0]; const val = Object.values(values)[0];
      return (tables[table] ?? []).filter((x: any) => x[attr] === val);
    }),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => ({})),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, query, updateItem, deleteItem },
  default: { putItem, getItem, scan, query, updateItem, deleteItem },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { FundingAdvanceService } from '../../../src/services/fundingAdvanceService';
import { ReconciliationService } from '../../../src/services/reconciliationService';
import type { AccessorialCharge, ChargeStatus } from '../../../src/services/accessorialChargeService';
import type { FactoringAssignment } from '../../../src/services/factoringAssignmentService';
import type { PayeeResolution } from '../../../src/services/payeeRoutingService';

const ADV = config.dynamodb.fundingAdvancesTable;
const RECON = config.dynamodb.reconciliationOutcomesTable;
const TRUST = config.dynamodb.betaTrustEventsTable;

function charge(status: ChargeStatus, amountCents = 7500): AccessorialCharge {
  return {
    chargeId: 'charge-1', loadId: 'load-1', stopId: 'PICKUP', type: 'DETENTION', status,
    dwellMinutes: 300, billableMinutes: 180, layoverDays: 0, rateClass: 'STANDARD', rateCents: 5000,
    amountCents, policyVersion: 1, policyHash: 'h', policySnapshot: {} as any,
    arrivalEventId: 'a1', departureEventId: 'd1', provisional: false, createdAt: 1, updatedAt: 1,
  };
}

function assignment(scope: 'FULL_INVOICE' | 'LINEHAUL_ONLY', recourse: 'RECOURSE' | 'NON_RECOURSE' = 'RECOURSE'): FactoringAssignment {
  return {
    assignmentId: 'assign-1', carrierId: 'carrier-1', invoiceId: 'inv-1', accountLevel: false,
    factorName: 'Acme', recourseType: recourse, scope, payoutDestination: 'acct://acme',
    effectiveAt: 1, status: 'ACTIVE', actorId: 'mover-1', createdAt: 1,
  };
}

const factorPayee: PayeeResolution = { type: 'FACTOR', carrierId: 'carrier-1', destination: 'acct://acme', assignmentId: 'assign-1', scope: 'FULL_INVOICE', reason: 'x' };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  scan.mockClear();
});

describe('no advance unless APPROVED', () => {
  it('rejects advancing a non-APPROVED accessorial', async () => {
    await expect(
      FundingAdvanceService.issueAdvance({
        invoiceId: 'inv-1', carrierId: 'carrier-1', lineKind: 'ACCESSORIAL', chargeId: 'charge-1',
        chargeStatus: 'PENDING_REVIEW', amountCents: 7500, payeeType: 'FACTOR', destination: 'acct://acme',
        providerName: 'manual', recourseType: 'RECOURSE', scope: 'FULL_INVOICE',
      })
    ).rejects.toThrow(/ADVANCE_REQUIRES_APPROVED/);
  });

  it('allows advancing an APPROVED line and is idempotent', async () => {
    const input = {
      invoiceId: 'inv-1', carrierId: 'carrier-1', lineKind: 'ACCESSORIAL' as const, chargeId: 'charge-1',
      chargeStatus: 'APPROVED' as const, amountCents: 7500, payeeType: 'FACTOR' as const, destination: 'acct://acme',
      providerName: 'manual', recourseType: 'RECOURSE' as const, scope: 'FULL_INVOICE' as const,
    };
    const a = await FundingAdvanceService.issueAdvance(input);
    const b = await FundingAdvanceService.issueAdvance(input);
    expect(b.advanceId).toBe(a.advanceId);
    expect(tables[ADV].length).toBe(1);
  });
});

describe('supplemental advance on late approval', () => {
  it('supplements under FULL_INVOICE to the factor', async () => {
    const out = await ReconciliationService.supplementalAdvanceOnApproval({
      invoiceId: 'inv-1', carrierId: 'carrier-1', charge: charge('APPROVED'), payee: factorPayee,
      activeAssignment: assignment('FULL_INVOICE'),
    });
    expect(out.type).toBe('SUPPLEMENTAL_ADVANCE');
    expect(out.payeeType).toBe('FACTOR');
    expect(tables[ADV].length).toBe(1); // an advance was issued to the factor
  });

  it('routes the accessorial to the mover under LINEHAUL_ONLY (assignment does not cover it)', async () => {
    const out = await ReconciliationService.supplementalAdvanceOnApproval({
      invoiceId: 'inv-1', carrierId: 'carrier-1', charge: charge('APPROVED'), payee: factorPayee,
      activeAssignment: assignment('LINEHAUL_ONLY'),
    });
    expect(out.type).toBe('ACCESSORIAL_TO_MOVER');
    expect(out.payeeType).toBe('CARRIER');
    expect(tables[ADV] ?? []).toHaveLength(0); // no advance to the factor
  });

  it('refuses to supplement a non-APPROVED charge', async () => {
    await expect(
      ReconciliationService.supplementalAdvanceOnApproval({
        invoiceId: 'inv-1', carrierId: 'carrier-1', charge: charge('PENDING_REVIEW'), payee: factorPayee,
        activeAssignment: assignment('FULL_INVOICE'),
      })
    ).rejects.toThrow(/requires an APPROVED charge/);
  });
});

describe('debtor payment reconciliation', () => {
  it('routes to the payee and releases reserve minus fee', async () => {
    const outs = await ReconciliationService.reconcileDebtorPayment({
      invoiceId: 'inv-1', carrierId: 'carrier-1', payee: factorPayee,
      collectedCents: 150000, feeCents: 3000, reserveCents: 20000,
    });
    const payment = outs.find((o) => o.type === 'PAYMENT_ROUTED')!;
    const reserve = outs.find((o) => o.type === 'RESERVE_RELEASED')!;
    expect(payment.amountCents).toBe(147000); // 150000 - 3000 fee
    expect(payment.payeeType).toBe('FACTOR');
    expect(reserve.amountCents).toBe(17000); // 20000 - 3000 fee
  });

  it('is idempotent per invoice payment', async () => {
    const args = { invoiceId: 'inv-1', carrierId: 'carrier-1', payee: factorPayee, collectedCents: 150000 };
    await ReconciliationService.reconcileDebtorPayment(args);
    await ReconciliationService.reconcileDebtorPayment(args);
    expect(tables[RECON].filter((o) => o.type === 'PAYMENT_ROUTED').length).toBe(1);
  });
});

describe('recourse and no-clawback', () => {
  it('recourse non-payment flags a scoped buyback and raises a trust event', async () => {
    const advance = await FundingAdvanceService.issueAdvance({
      invoiceId: 'inv-1', carrierId: 'carrier-1', lineKind: 'LINEHAUL', amountCents: 150000,
      payeeType: 'FACTOR', destination: 'acct://acme', providerName: 'manual', recourseType: 'RECOURSE', scope: 'FULL_INVOICE',
    });
    const out = await ReconciliationService.handleNonPayment({ advance, actorId: 'admin-1' });
    expect(out.type).toBe('RECOURSE_BUYBACK');
    expect(out.amountCents).toBe(150000); // scoped to the advanced amount
    expect((tables[TRUST] ?? []).length).toBe(1);
  });

  it('non-recourse non-payment records a loss with no buyback and no trust event', async () => {
    const advance = await FundingAdvanceService.issueAdvance({
      invoiceId: 'inv-2', carrierId: 'carrier-1', lineKind: 'LINEHAUL', amountCents: 100000,
      payeeType: 'FACTOR', destination: 'acct://acme', providerName: 'manual', recourseType: 'NON_RECOURSE', scope: 'FULL_INVOICE',
    });
    const out = await ReconciliationService.handleNonPayment({ advance, actorId: 'admin-1' });
    expect(out.type).toBe('NON_RECOURSE_LOSS');
    expect((tables[TRUST] ?? []).length).toBe(0);
  });

  it('a charge never advanced (disputed while pending) has no advance and no clawback', async () => {
    // The accessorial was PENDING_REVIEW at funding, so no advance exists for it.
    const adv = await FundingAdvanceService.getForLine('inv-1', 'ACCESSORIAL', 'charge-1');
    expect(adv).toBeNull();
    // With no advance, there is nothing to claw back; the dispute (Phase 5) is the
    // only recorded effect.
    const outs = await ReconciliationService.outcomesForInvoice('inv-1');
    expect(outs.filter((o) => o.type === 'RECOURSE_BUYBACK')).toHaveLength(0);
  });
});

describe('V2-H1: idempotent money writes are concurrency-safe (conditional put)', () => {
  it('two concurrent recordOutcome calls with the same idempotencyKey write exactly ONE ledger row', async () => {
    const args = {
      invoiceId: 'inv-dup', carrierId: 'carrier-1',
      type: 'PAYMENT_ROUTED' as const, amountCents: 1000, idempotencyKey: 'dupkey-1',
    };
    const [a, b] = await Promise.all([
      ReconciliationService.recordOutcome(args),
      ReconciliationService.recordOutcome(args),
    ]);
    expect(a.outcomeId).toBe(b.outcomeId);        // both return the single winning row
    expect(tables[RECON] ?? []).toHaveLength(1);   // scan-then-put would have written 2
  });

  it('two concurrent issueAdvance calls for the same line write exactly ONE advance (never double-fund)', async () => {
    const input = {
      invoiceId: 'inv-dup2', carrierId: 'carrier-1', lineKind: 'LINEHAUL' as const,
      amountCents: 50000, payeeType: 'CARRIER' as const, destination: 'acct://x',
      providerName: 'manual', recourseType: 'RECOURSE' as const, scope: 'FULL_INVOICE' as const,
    };
    const [a, b] = await Promise.all([
      FundingAdvanceService.issueAdvance(input),
      FundingAdvanceService.issueAdvance(input),
    ]);
    expect(a.advanceId).toBe(b.advanceId);
    expect(tables[ADV] ?? []).toHaveLength(1);
  });
});

describe('V2-M1: money reads query the invoiceId GSI, fall back to a scan', () => {
  it('outcomesForInvoice / listForInvoice fall back to a filtered scan when the GSI is missing', async () => {
    await FundingAdvanceService.issueAdvance({
      invoiceId: 'inv-m1', carrierId: 'carrier-1', lineKind: 'LINEHAUL',
      amountCents: 1000, payeeType: 'CARRIER', destination: 'acct://x',
      providerName: 'manual', recourseType: 'RECOURSE', scope: 'FULL_INVOICE',
    });
    await ReconciliationService.recordOutcome({
      invoiceId: 'inv-m1', carrierId: 'carrier-1', type: 'PAYMENT_ROUTED',
      amountCents: 1000, idempotencyKey: 'm1-key',
    });
    // Force the GSI to look absent for both reads — they must fall back to a scan.
    const missingIndex = async () => { const e: any = new Error('does not have the specified index'); e.name = 'ValidationException'; throw e; };
    query.mockImplementationOnce(missingIndex).mockImplementationOnce(missingIndex);
    expect(await FundingAdvanceService.listForInvoice('inv-m1')).toHaveLength(1);
    expect(await ReconciliationService.outcomesForInvoice('inv-m1')).toHaveLength(1);
  });
});
