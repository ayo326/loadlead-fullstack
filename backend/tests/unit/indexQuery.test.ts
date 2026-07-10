/**
 * queryIndexOrScan (audit v4 COA-3A): query-first with a loud, guarded scan
 * fallback. The fallback must trigger only for missing-index/missing-query
 * conditions - real errors propagate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => ({
  query: vi.fn(),
  scan: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/config/database', () => ({
  Database: { query: H.query, scan: H.scan },
}));
vi.mock('../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: H.error },
}));

import { queryIndexOrScan, isMissingIndex } from '../../src/utils/indexQuery';

beforeEach(() => vi.clearAllMocks());

const scanRows = [{ id: 'a' }, { id: 'b' }];
const fallback = vi.fn(async () => scanRows);

describe('queryIndexOrScan', () => {
  it('returns query results without falling back or logging', async () => {
    H.query.mockResolvedValueOnce([{ id: 'q' }]);
    const out = await queryIndexOrScan('T', 'x-index', 'x', 'v', fallback, 'test');
    expect(out).toEqual([{ id: 'q' }]);
    expect(fallback).not.toHaveBeenCalled();
    expect(H.error).not.toHaveBeenCalled();
  });

  it('falls back to the scan on a missing index, logging [scan-fallback]', async () => {
    const err: any = new Error('The table does not have the specified index: x-index');
    err.name = 'ValidationException';
    H.query.mockRejectedValueOnce(err);
    const out = await queryIndexOrScan('T', 'x-index', 'x', 'v', fallback, 'test');
    expect(out).toEqual(scanRows);
    expect(H.error).toHaveBeenCalledWith(expect.stringContaining('[scan-fallback]'));
  });

  it('returns [] on ResourceNotFoundException (table absent in this env)', async () => {
    const err: any = new Error('table not found');
    err.name = 'ResourceNotFoundException';
    H.query.mockRejectedValueOnce(err);
    const out = await queryIndexOrScan('T', 'x-index', 'x', 'v', fallback, 'test');
    expect(out).toEqual([]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('propagates real errors instead of masking them with a scan', async () => {
    const err: any = new Error('throttled');
    err.name = 'ProvisionedThroughputExceededException';
    H.query.mockRejectedValueOnce(err);
    await expect(queryIndexOrScan('T', 'x-index', 'x', 'v', fallback, 'test')).rejects.toThrow('throttled');
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('isMissingIndex', () => {
  it('matches only ValidationException mentioning an index', () => {
    expect(isMissingIndex({ name: 'ValidationException', message: 'no such index' })).toBe(true);
    expect(isMissingIndex({ name: 'ValidationException', message: 'bad key' })).toBe(false);
    expect(isMissingIndex({ name: 'SomethingElse', message: 'index' })).toBe(false);
  });
});
