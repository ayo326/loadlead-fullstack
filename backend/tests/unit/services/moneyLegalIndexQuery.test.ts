/**
 * COA-3 phase 2: the money/legal hot resolvers query a GSI instead of scanning the
 * whole append-only log, with a guarded scan fallback that preserves correctness if
 * the index is unavailable.
 *   - FactoringAssignmentService: getActiveAssignment / listForCarrier -> carrierId-index
 *     (and release() is a point read on the assignmentId hash key, never a scan)
 *   - LegalHoldService.isOnHold (runs on every delete/purge) -> entityId-index
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => ({
  query: vi.fn(),
  scan: vi.fn(),
  getItem: vi.fn(),
  putItem: vi.fn(async () => undefined),
  error: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({
  Database: { query: H.query, scan: H.scan, getItem: H.getItem, putItem: H.putItem },
}));
vi.mock('../../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: H.error },
  Logger: { info: vi.fn(), warn: vi.fn(), error: H.error },
}));
// isOnHold never records audit, but the module imports the service; stub it so the
// import graph stays cheap and no real audit write is attempted.
vi.mock('../../../src/services/adminAuditService', () => ({
  AdminAuditService: { record: vi.fn(async () => undefined) },
}));

import { FactoringAssignmentService } from '../../../src/services/factoringAssignmentService';
import { LegalHoldService } from '../../../src/services/legalHoldService';
import config from '../../../src/config/environment';

const FACT = config.dynamodb.factoringAssignmentsTable;
const HOLDS = config.dynamodb.legalHoldsTable;

const missingIndex = () => {
  const e: any = new Error('The table does not have the specified index');
  e.name = 'ValidationException';
  return e;
};

beforeEach(() => {
  vi.clearAllMocks();
  H.putItem.mockResolvedValue(undefined);
});

describe('FactoringAssignmentService.getActiveAssignment', () => {
  it('queries carrierId-index and honors account-level ACTIVE', async () => {
    H.query.mockResolvedValueOnce([
      { assignmentId: 'a1', carrierId: 'c1', accountLevel: true, status: 'ACTIVE', createdAt: 10 },
    ]);
    const out = await FactoringAssignmentService.getActiveAssignment('c1');
    expect(out?.assignmentId).toBe('a1');
    expect(H.query).toHaveBeenCalledWith(FACT, 'carrierId-index', '#k = :v', { '#k': 'carrierId' }, { ':v': 'c1' });
    expect(H.scan).not.toHaveBeenCalled();
    expect(H.error).not.toHaveBeenCalled();
  });

  it('invoice-level ACTIVE overrides account-level', async () => {
    H.query.mockResolvedValueOnce([
      { assignmentId: 'acct', carrierId: 'c1', accountLevel: true, status: 'ACTIVE', createdAt: 5 },
      { assignmentId: 'inv', carrierId: 'c1', invoiceId: 'i9', accountLevel: false, status: 'ACTIVE', createdAt: 9 },
    ]);
    const out = await FactoringAssignmentService.getActiveAssignment('c1', 'i9');
    expect(out?.assignmentId).toBe('inv');
  });

  it('falls back to a carrier-filtered scan (loudly) when the index is unavailable', async () => {
    H.query.mockRejectedValueOnce(missingIndex());
    H.scan.mockResolvedValueOnce([
      { assignmentId: 'a1', carrierId: 'c1', accountLevel: true, status: 'ACTIVE', createdAt: 10 },
      { assignmentId: 'other', carrierId: 'c2', accountLevel: true, status: 'ACTIVE', createdAt: 20 },
    ]);
    const out = await FactoringAssignmentService.getActiveAssignment('c1');
    expect(out?.assignmentId).toBe('a1'); // c2's row is filtered out
    expect(H.error).toHaveBeenCalledWith(expect.stringContaining('[scan-fallback]'));
  });
});

describe('FactoringAssignmentService.listForCarrier', () => {
  it('queries carrierId-index and returns newest-first', async () => {
    H.query.mockResolvedValueOnce([
      { assignmentId: 'old', carrierId: 'c1', createdAt: 1 },
      { assignmentId: 'new', carrierId: 'c1', createdAt: 2 },
    ]);
    const out = await FactoringAssignmentService.listForCarrier('c1');
    expect(out.map((a) => a.assignmentId)).toEqual(['new', 'old']);
    expect(H.query).toHaveBeenCalledWith(FACT, 'carrierId-index', '#k = :v', { '#k': 'carrierId' }, { ':v': 'c1' });
    expect(H.scan).not.toHaveBeenCalled();
  });
});

describe('FactoringAssignmentService.release', () => {
  it('point-reads the target by assignmentId (no scan)', async () => {
    H.getItem.mockResolvedValueOnce({ assignmentId: 'a1', carrierId: 'c1', accountLevel: true, status: 'ACTIVE', createdAt: 1 });
    H.query.mockResolvedValueOnce([
      { assignmentId: 'a1', carrierId: 'c1', accountLevel: true, status: 'ACTIVE', createdAt: 1 },
    ]);
    const out = await FactoringAssignmentService.release('a1', 'actor');
    expect(H.getItem).toHaveBeenCalledWith(FACT, { assignmentId: 'a1' });
    expect(H.scan).not.toHaveBeenCalled();
    expect(out.status).toBe('RELEASED');
    expect(H.putItem).toHaveBeenCalled();
  });
});

describe('LegalHoldService.isOnHold', () => {
  it('queries entityId-index; newest PLACE => held', async () => {
    H.query.mockResolvedValueOnce([
      { holdId: 'h1', entityType: 'LOAD', entityId: 'L1', eventType: 'PLACE', at: 100, seq: 1 },
    ]);
    expect(await LegalHoldService.isOnHold('LOAD', 'L1')).toBe(true);
    expect(H.query).toHaveBeenCalledWith(HOLDS, 'entityId-index', '#k = :v', { '#k': 'entityId' }, { ':v': 'L1' });
    expect(H.scan).not.toHaveBeenCalled();
  });

  it('newest RELEASE => not held (and filters by entityType)', async () => {
    H.query.mockResolvedValueOnce([
      { holdId: 'h1', entityType: 'LOAD', entityId: 'L1', eventType: 'PLACE', at: 100, seq: 1 },
      { holdId: 'h2', entityType: 'LOAD', entityId: 'L1', eventType: 'RELEASE', at: 200, seq: 2 },
      { holdId: 'h3', entityType: 'INVOICE', entityId: 'L1', eventType: 'PLACE', at: 300, seq: 3 },
    ]);
    expect(await LegalHoldService.isOnHold('LOAD', 'L1')).toBe(false);
  });

  it('falls back to an entity-filtered scan (loudly) when the index is unavailable', async () => {
    H.query.mockRejectedValueOnce(missingIndex());
    H.scan.mockResolvedValueOnce([
      { holdId: 'h1', entityType: 'CARRIER', entityId: 'X', eventType: 'PLACE', at: 100, seq: 1 },
      { holdId: 'h2', entityType: 'CARRIER', entityId: 'other', eventType: 'PLACE', at: 100, seq: 1 },
    ]);
    expect(await LegalHoldService.isOnHold('CARRIER', 'X')).toBe(true);
    expect(H.error).toHaveBeenCalledWith(expect.stringContaining('[scan-fallback]'));
  });
});
