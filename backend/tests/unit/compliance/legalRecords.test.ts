/**
 * Phase 4: legal hold registry, purge guard, and case-file integrity.
 *
 * Proves a hold blocks deletion for everyone, a purge job skips held entities,
 * hold actions are audited and fail closed, and the case-file assembler produces
 * a hash-manifested export that passes integrity verification and fails it when a
 * record is altered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { LegalHoldService, RetentionService, LegalHoldError } from '../../../src/services/legalHoldService';
import { CaseFileService } from '../../../src/services/caseFileService';

const HOLDS = config.dynamodb.legalHoldsTable;
const AUDIT = config.dynamodb.adminAuditLogTable;

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; putItem.mockClear(); });

describe('legal hold registry', () => {
  const hold = { entityType: 'LOAD', entityId: 'load-1', reason: 'subpoena', authorityRef: 'req-1', actorId: 'legal-1' };

  it('places a hold that blocks deletion for everyone, then releases it', async () => {
    await LegalHoldService.placeHold(hold);
    expect(await LegalHoldService.isOnHold('LOAD', 'load-1')).toBe(true);
    await expect(LegalHoldService.assertDeletable('LOAD', 'load-1')).rejects.toBeInstanceOf(LegalHoldError);

    await LegalHoldService.releaseHold({ ...hold, reason: 'matter closed' });
    expect(await LegalHoldService.isOnHold('LOAD', 'load-1')).toBe(false);
    await expect(LegalHoldService.assertDeletable('LOAD', 'load-1')).resolves.toBeUndefined();
  });

  it('a purge job skips held entities and purges the rest', async () => {
    await LegalHoldService.placeHold(hold);
    const deleted: string[] = [];
    const res = await RetentionService.purge(
      [{ entityType: 'LOAD', entityId: 'load-1' }, { entityType: 'LOAD', entityId: 'load-2' }],
      async (c) => { deleted.push(c.entityId); }
    );
    expect(res.skipped.map((s) => s.entityId)).toEqual(['load-1']);
    expect(res.purged.map((s) => s.entityId)).toEqual(['load-2']);
    expect(deleted).toEqual(['load-2']); // the held one was never deleted
  });

  it('place is audited, and fails closed when the audit cannot be written', async () => {
    await LegalHoldService.placeHold(hold);
    expect(tables[AUDIT]).toHaveLength(1);

    putItem.mockImplementationOnce(async () => { throw new Error('audit down'); });
    await expect(LegalHoldService.placeHold({ ...hold, entityId: 'load-9' })).rejects.toThrow(/audit down/);
    expect(tables[HOLDS]).toHaveLength(1); // no new hold event written
  });
});

describe('case-file integrity', () => {
  const records = [
    { kind: 'ESIGN_ACCEPTANCE', id: 'acc-1', content: { acceptedVersion: 1, policyHash: 'h' } },
    { kind: 'CHARGE', id: 'charge-1', content: { amountCents: 5000, status: 'APPROVED' } },
    { kind: 'ADVANCE', id: 'adv-1', content: { amountCents: 5000 } },
  ];

  it('assembles a hash-manifested case file that passes verification', () => {
    const cf = CaseFileService.assemble('LOAD', 'load-1', records);
    expect(cf.manifest).toHaveLength(3);
    expect(cf.items.every((i) => /^[0-9a-f]{64}$/.test(i.contentHash))).toBe(true);
    expect(CaseFileService.verifyIntegrity(cf).ok).toBe(true);
  });

  it('fails verification when a record is altered', () => {
    const cf = CaseFileService.assemble('LOAD', 'load-1', records);
    (cf.items[1].content as any).amountCents = 9999; // tamper, hash not updated
    const res = CaseFileService.verifyIntegrity(cf);
    expect(res.ok).toBe(false);
    expect(res.gaps.some((g) => g.includes('CHARGE:charge-1'))).toBe(true);
  });

  it('fails verification when the manifest and items diverge', () => {
    const cf = CaseFileService.assemble('LOAD', 'load-1', records);
    cf.manifest.pop(); // drop a manifest entry
    expect(CaseFileService.verifyIntegrity(cf).ok).toBe(false);
  });
});
