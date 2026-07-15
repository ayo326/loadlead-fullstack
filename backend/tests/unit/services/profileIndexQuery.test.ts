/**
 * COA-3 / audit v6 H8: the driver/shipper/receiver getProfileByUserId resolvers
 * run first on ~60 authenticated handlers. They must QUERY the userId-index
 * (which exists in every env) rather than scan the whole table, while keeping a
 * loud, guarded scan fallback if the index is ever unavailable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => ({
  query: vi.fn(),
  scan: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({
  Database: { query: H.query, scan: H.scan },
}));
vi.mock('../../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: H.error },
  Logger: { info: vi.fn(), warn: vi.fn(), error: H.error },
}));

import { DriverService } from '../../../src/services/driverService';
import { ShipperService } from '../../../src/services/shipperService';
import { ReceiverService } from '../../../src/services/receiverService';
import config from '../../../src/config/environment';

beforeEach(() => vi.clearAllMocks());

const cases = [
  { name: 'DriverService', call: (u: string) => DriverService.getProfileByUserId(u), idKey: 'driverId', table: config.dynamodb.driversTable },
  { name: 'ShipperService', call: (u: string) => ShipperService.getProfileByUserId(u), idKey: 'shipperId', table: config.dynamodb.shippersTable },
  { name: 'ReceiverService', call: (u: string) => ReceiverService.getProfileByUserId(u), idKey: 'receiverId', table: config.dynamodb.receiversTable },
];

describe.each(cases)('$name.getProfileByUserId', ({ call, idKey, table }) => {
  it('queries the userId-index (no scan, no fallback log) and returns the first row', async () => {
    H.query.mockResolvedValueOnce([{ [idKey]: 'x1', userId: 'u1' }]);
    const out = await call('u1');
    expect(out).toEqual({ [idKey]: 'x1', userId: 'u1' });
    expect(H.query).toHaveBeenCalledWith(table, 'userId-index', '#k = :v', { '#k': 'userId' }, { ':v': 'u1' });
    expect(H.scan).not.toHaveBeenCalled();
    expect(H.error).not.toHaveBeenCalled();
  });

  it('returns null when the index query yields no rows', async () => {
    H.query.mockResolvedValueOnce([]);
    expect(await call('nobody')).toBeNull();
    expect(H.scan).not.toHaveBeenCalled();
  });

  it('falls back to the scan (loudly) if the index is unavailable', async () => {
    const err: any = new Error('The table does not have the specified index: userId-index');
    err.name = 'ValidationException';
    H.query.mockRejectedValueOnce(err);
    H.scan.mockResolvedValueOnce([{ [idKey]: 'x2', userId: 'u2' }]);
    const out = await call('u2');
    expect(out).toEqual({ [idKey]: 'x2', userId: 'u2' });
    expect(H.scan).toHaveBeenCalledWith(table, 'userId = :userId', { ':userId': 'u2' });
    expect(H.error).toHaveBeenCalledWith(expect.stringContaining('[scan-fallback]'));
  });
});
