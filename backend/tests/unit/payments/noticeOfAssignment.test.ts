/**
 * Phase 7: Notice of Assignment (append-only).
 *
 * Proves the notice text snapshot names the factor, debtor, and redirection;
 * that it references the assignment by id; that re-issue is a new row (newest
 * wins, old kept); and account-level vs invoice-level phrasing.
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
import { NoticeOfAssignmentService, buildNoticeText } from '../../../src/services/noticeOfAssignmentService';
import type { FactoringAssignment } from '../../../src/services/factoringAssignmentService';

const NOA = config.dynamodb.noticesOfAssignmentTable;

function assignment(over: Partial<FactoringAssignment> = {}): FactoringAssignment {
  return {
    assignmentId: 'assign-1',
    carrierId: 'carrier-1',
    invoiceId: 'inv-1',
    accountLevel: false,
    factorName: 'Acme Factoring',
    recourseType: 'RECOURSE',
    scope: 'FULL_INVOICE',
    payoutDestination: 'acct://acme',
    effectiveAt: Date.parse('2026-06-01T00:00:00Z'),
    status: 'ACTIVE',
    actorId: 'mover-1',
    createdAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  scan.mockClear();
});

describe('notice text', () => {
  it('names the factor, debtor, invoice, amount, and the redirection', () => {
    const text = buildNoticeText({
      assignment: assignment(),
      debtor: { debtorId: 'shipper-9', debtorName: 'Globex' },
      actorId: 'mover-1',
      invoiceAmountCents: 150000,
    });
    expect(text).toMatch(/NOTICE OF ASSIGNMENT/);
    expect(text).toMatch(/Acme Factoring/);
    expect(text).toMatch(/Globex/);
    expect(text).toMatch(/invoice inv-1/);
    expect(text).toMatch(/\$1,500\.00/);
    expect(text).toMatch(/Effective 2026-06-01/);
  });

  it('uses account-level phrasing when there is no invoice id', () => {
    const text = buildNoticeText({
      assignment: assignment({ invoiceId: undefined, accountLevel: true }),
      debtor: { debtorId: 'shipper-9' },
      actorId: 'mover-1',
    });
    expect(text).toMatch(/account-level assignment/);
  });
});

describe('append-only NoA records', () => {
  it('records a NoA referencing the assignment, debtor, and factor', async () => {
    const noa = await NoticeOfAssignmentService.generate({
      assignment: assignment(),
      debtor: { debtorId: 'shipper-9', debtorName: 'Globex' },
      actorId: 'mover-1',
      invoiceAmountCents: 150000,
    });
    expect(noa.noaId.startsWith('noa_')).toBe(true);
    expect(noa.assignmentId).toBe('assign-1');
    expect(noa.debtorId).toBe('shipper-9');
    expect(noa.factorName).toBe('Acme Factoring');
    expect(noa.templateVersion).toBe('1.0.0');
    expect(putItem).toHaveBeenCalledWith(NOA, expect.objectContaining({ noaId: noa.noaId }));
  });

  it('a re-issue is a new row; getForAssignment returns the newest, old kept', async () => {
    await NoticeOfAssignmentService.generate({ assignment: assignment(), debtor: { debtorId: 's' }, actorId: 'm' });
    await new Promise((r) => setTimeout(r, 2));
    const second = await NoticeOfAssignmentService.generate({ assignment: assignment(), debtor: { debtorId: 's' }, actorId: 'm' });
    const latest = await NoticeOfAssignmentService.getForAssignment('assign-1');
    expect(latest?.noaId).toBe(second.noaId);
    expect(tables[NOA].length).toBe(2);
    expect(updateItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it('requires a debtor and an actor', async () => {
    await expect(
      NoticeOfAssignmentService.generate({ assignment: assignment(), debtor: { debtorId: '' }, actorId: 'm' })
    ).rejects.toThrow();
    await expect(
      NoticeOfAssignmentService.generate({ assignment: assignment(), debtor: { debtorId: 's' }, actorId: '' })
    ).rejects.toThrow();
  });
});
