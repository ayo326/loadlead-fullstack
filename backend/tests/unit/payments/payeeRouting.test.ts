/**
 * Phase 6: payee routing primitive + the append-only factoring assignment log.
 *
 * Proves: mover by default, factor when an active assignment exists, partner when
 * one funded the invoice; invoice-level precedence over account-level; release as
 * a new append-only row; and that no mutable payee flag is stored.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      (tables[table] ??= []).push(item);
    }),
    getItem: vi.fn(async () => null),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => ({})),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem, deleteItem },
  default: { putItem, getItem, scan, updateItem, deleteItem },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { FactoringAssignmentService } from '../../../src/services/factoringAssignmentService';
import { PayeeRoutingService } from '../../../src/services/payeeRoutingService';

const ASSIGN = config.dynamodb.factoringAssignmentsTable;

const baseAssign = {
  carrierId: 'carrier-1',
  factorName: 'Acme Factoring',
  recourseType: 'RECOURSE' as const,
  payoutDestination: 'acct://acme',
  actorId: 'mover-1',
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  scan.mockClear();
  updateItem.mockClear();
  deleteItem.mockClear();
});

async function resolve(invoiceId?: string, partnerFunding?: any) {
  return PayeeRoutingService.resolvePayee({
    carrierId: 'carrier-1',
    invoiceId,
    carrierPayoutDestination: 'acct://mover',
    partnerFunding,
  });
}

describe('default + factor routing', () => {
  it('routes to the mover when there is no assignment', async () => {
    const r = await resolve('inv-1');
    expect(r.type).toBe('CARRIER');
    expect(r.destination).toBe('acct://mover');
  });

  it('routes to the factor when an active invoice-level assignment exists', async () => {
    await FactoringAssignmentService.create({ ...baseAssign, invoiceId: 'inv-1' });
    const r = await resolve('inv-1');
    expect(r.type).toBe('FACTOR');
    expect(r.destination).toBe('acct://acme');
    expect(r.scope).toBe('FULL_INVOICE');
  });

  it('routes to a partner when one funded the invoice (partner precedence)', async () => {
    await FactoringAssignmentService.create({ ...baseAssign, invoiceId: 'inv-1' });
    const r = await resolve('inv-1', { partnerId: 'OTR', destination: 'acct://otr', assignmentId: 'a1' });
    expect(r.type).toBe('PARTNER');
    expect(r.destination).toBe('acct://otr');
  });
});

describe('release (append-only)', () => {
  it('a released invoice assignment routes back to the mover, keeping both rows', async () => {
    const a = await FactoringAssignmentService.create({ ...baseAssign, invoiceId: 'inv-1' });
    await FactoringAssignmentService.release(a.assignmentId, 'mover-1');
    const r = await resolve('inv-1');
    expect(r.type).toBe('CARRIER');
    expect(tables[ASSIGN].length).toBe(2); // active + released, nothing updated/deleted
    expect(updateItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });
});

describe('invoice-level precedence over account-level', () => {
  it('account-level active applies when there is no invoice-level row', async () => {
    await FactoringAssignmentService.create({ ...baseAssign }); // account-level
    const r = await resolve('inv-1');
    expect(r.type).toBe('FACTOR');
    expect(r.reason).toMatch(/account-level/);
  });

  it('an invoice-level RELEASED overrides an account-level ACTIVE', async () => {
    await FactoringAssignmentService.create({ ...baseAssign }); // account-level ACTIVE
    const inv = await FactoringAssignmentService.create({ ...baseAssign, invoiceId: 'inv-1' });
    await FactoringAssignmentService.release(inv.assignmentId, 'mover-1');
    const r = await resolve('inv-1');
    expect(r.type).toBe('CARRIER'); // invoice-level decision (released) wins
  });

  it('an invoice-level ACTIVE applies even with an account-level RELEASED', async () => {
    const acct = await FactoringAssignmentService.create({ ...baseAssign });
    await FactoringAssignmentService.release(acct.assignmentId, 'mover-1');
    await FactoringAssignmentService.create({ ...baseAssign, invoiceId: 'inv-1', factorName: 'Beta Factor', payoutDestination: 'acct://beta' });
    const r = await resolve('inv-1');
    expect(r.type).toBe('FACTOR');
    expect(r.destination).toBe('acct://beta');
  });
});

describe('validation', () => {
  it('requires carrier, factor, payout destination, and a valid recourse type', async () => {
    await expect(FactoringAssignmentService.create({ ...baseAssign, carrierId: '' })).rejects.toThrow();
    await expect(FactoringAssignmentService.create({ ...baseAssign, factorName: '' })).rejects.toThrow();
    await expect(FactoringAssignmentService.create({ ...baseAssign, payoutDestination: '' })).rejects.toThrow();
    await expect(FactoringAssignmentService.create({ ...baseAssign, recourseType: 'X' as any })).rejects.toThrow();
  });
});
