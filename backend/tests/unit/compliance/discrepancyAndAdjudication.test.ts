/**
 * Phase 3: discrepancy detector + adjudication.
 *
 * The detector (pure) catches the defined anomalies including the core
 * no-advance-against-unapproved invariant. Adjudication writes a compensating
 * entry and an append-only adjudication, is audited first, and never mutates
 * originals.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── detector: pure, no mocks ────────────────────────────────────────────────
import { detectDiscrepancies, DiscrepancyRecords } from '../../../src/services/discrepancyDetector';
import type { AccessorialCharge } from '../../../src/services/accessorialChargeService';
import type { FundingAdvance } from '../../../src/services/fundingAdvanceService';
import type { FactoringAssignment } from '../../../src/services/factoringAssignmentService';
import type { ReconciliationOutcome } from '../../../src/services/reconciliationService';

function charge(over: Partial<AccessorialCharge> = {}): AccessorialCharge {
  return {
    chargeId: 'charge-1', loadId: 'load-1', stopId: 'PICKUP', type: 'DETENTION', status: 'APPROVED',
    dwellMinutes: 300, billableMinutes: 180, layoverDays: 0, rateClass: 'STANDARD', rateCents: 5000,
    amountCents: 5000, policyVersion: 1, policyHash: 'h', policySnapshot: {} as any,
    arrivalEventId: 'a1', departureEventId: 'd1', provisional: false, createdAt: 1, updatedAt: 1, ...over,
  };
}
function advance(over: Partial<FundingAdvance> = {}): FundingAdvance {
  return {
    advanceId: 'adv-1', invoiceId: 'load-1', carrierId: 'carrier-1', lineKind: 'ACCESSORIAL', chargeId: 'charge-1',
    amountCents: 5000, payeeType: 'FACTOR', destination: 'acct://x', providerName: 'manual',
    recourseType: 'RECOURSE', scope: 'FULL_INVOICE', idempotencyKey: 'k1', issuedAt: 1, ...over,
  };
}
function assignment(over: Partial<FactoringAssignment> = {}): FactoringAssignment {
  return {
    assignmentId: 'assign-1', carrierId: 'carrier-1', invoiceId: 'load-1', accountLevel: false, factorName: 'F',
    recourseType: 'RECOURSE', scope: 'FULL_INVOICE', payoutDestination: 'acct://x', effectiveAt: 1,
    status: 'ACTIVE', actorId: 'm', createdAt: 1, ...over,
  };
}
function outcome(over: Partial<ReconciliationOutcome> = {}): ReconciliationOutcome {
  return { outcomeId: 'out-1', invoiceId: 'load-1', carrierId: 'carrier-1', type: 'PAYMENT_ROUTED', amountCents: 5000, recordedAt: 1, ...over };
}
function base(over: Partial<DiscrepancyRecords> = {}): DiscrepancyRecords {
  return { invoiceId: 'load-1', carrierId: 'carrier-1', charges: [], chargeHistory: [], advances: [], outcomes: [], assignments: [], ...over };
}
const codes = (r: DiscrepancyRecords) => detectDiscrepancies(r).map((f) => f.code);

describe('discrepancy detector', () => {
  it('flags an advance against an unapproved accessorial (CRITICAL invariant)', () => {
    const findings = detectDiscrepancies(base({
      charges: [charge({ status: 'PENDING_REVIEW' })],
      advances: [advance()],
    }));
    const inv = findings.find((f) => f.code === 'ADVANCE_AGAINST_UNAPPROVED');
    expect(inv?.severity).toBe('CRITICAL');
  });

  it('flags a settled invoice whose reserve was never released', () => {
    expect(codes(base({
      charges: [charge({ status: 'SETTLED' })],
      advances: [advance()],
      outcomes: [outcome({ type: 'PAYMENT_ROUTED' })],
    }))).toContain('RESERVE_NEVER_RELEASED');
  });

  it('flags more than one active assignment for the same invoice scope', () => {
    expect(codes(base({
      assignments: [assignment({ assignmentId: 'a1' }), assignment({ assignmentId: 'a2' })],
    }))).toContain('MULTIPLE_ACTIVE_ASSIGNMENTS');
  });

  it('flags detention and layover overlapping the same stop', () => {
    expect(codes(base({
      charges: [charge({ chargeId: 'c1', type: 'DETENTION', policyHash: 'h1' }), charge({ chargeId: 'c2', type: 'LAYOVER', policyHash: 'h2' })],
    }))).toContain('DETENTION_LAYOVER_OVERLAP');
  });

  it('flags a payout routed to the carrier despite an active assignment', () => {
    expect(codes(base({
      assignments: [assignment()],
      outcomes: [outcome({ payeeType: 'CARRIER' })],
    }))).toContain('PAYEE_MISMATCH');
  });

  it('returns no critical findings for a clean, reconciled invoice', () => {
    const findings = detectDiscrepancies(base({
      charges: [charge({ status: 'SETTLED' })],
      chargeHistory: [{ historyId: 'h1', chargeId: 'charge-1', loadId: 'load-1', fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', actorId: 's', recordedAt: 1 }],
      advances: [advance()],
      assignments: [assignment()],
      outcomes: [outcome({ type: 'PAYMENT_ROUTED', payeeType: 'FACTOR', amountCents: 5000 }), outcome({ outcomeId: 'out-2', type: 'RESERVE_RELEASED', amountCents: 1000 })],
      collectedCents: 6000, acceptedPolicyHash: 'h',
    }));
    expect(findings.filter((f) => f.severity === 'CRITICAL')).toHaveLength(0);
  });
});

// ── adjudication: mocked DB ─────────────────────────────────────────────────
const { tables, putItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => { (tables[table] ??= []).push(item); }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, scan, getItem: vi.fn(async () => null), updateItem: vi.fn(), deleteItem: vi.fn() },
  default: { putItem, scan, getItem: vi.fn(async () => null), updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { AdjudicationService } from '../../../src/services/adjudicationService';

const ADJ = config.dynamodb.adjudicationsTable;
const RECON = config.dynamodb.reconciliationOutcomesTable;
const AUDIT = config.dynamodb.adminAuditLogTable;

describe('adjudication', () => {
  beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; putItem.mockClear(); });

  it('a reversal writes a compensating entry and an adjudication, audited, without touching originals', async () => {
    const adj = await AdjudicationService.adjudicate({
      actorId: 'dispute-1', targetType: 'RECOURSE_BUYBACK', targetId: 'out-original',
      action: 'REVERSE', reason: 'buyback contested, upheld in carrier favor',
      invoiceId: 'load-1', carrierId: 'carrier-1', compensation: { amountCents: 5000, note: 'reverse the buyback' },
    });
    expect(adj.action).toBe('REVERSE');
    expect(adj.compensatingOutcomeId).toBeTruthy();
    expect(tables[ADJ]).toHaveLength(1);
    const comp = (tables[RECON] ?? []).find((o) => o.type === 'ADJUDICATION_COMPENSATION');
    expect(comp?.amountCents).toBe(5000);
    expect(tables[AUDIT]).toHaveLength(1); // audited first
    // No original was overwritten: every write was an append to adj/recon/audit.
    for (const call of putItem.mock.calls) expect([ADJ, RECON, AUDIT]).toContain(call[0]);
  });

  it('fails closed: if the audit cannot be written, no adjudication is recorded', async () => {
    putItem.mockImplementationOnce(async () => { throw new Error('audit down'); });
    await expect(AdjudicationService.adjudicate({
      actorId: 'd', targetType: 'DISCREPANCY', targetId: 'x', action: 'UPHOLD', reason: 'r',
    })).rejects.toThrow(/audit down/);
    expect(tables[ADJ] ?? []).toHaveLength(0);
  });
});
