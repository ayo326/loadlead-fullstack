// BL-C1 (audit v6): Database.scan/query issued a single command and returned
// result.Items, ignoring LastEvaluatedKey. DynamoDB caps a page at 1 MB, so
// once an append-only table (payout_intercepts / factoring_assignments /
// legal_holds) crossed 1 MB the resolvers silently dropped rows - a levied
// carrier could be paid in full, funds misrouted, or a held record deleted.
// These tests pin that scan/query now walk every page.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/config/aws', () => ({ docClient: { send: sendMock } }));

import { Database } from '../../../src/config/database';

beforeEach(() => sendMock.mockReset());

describe('BL-C1: Database.scan paginates across LastEvaluatedKey', () => {
  it('accumulates items across all pages and threads ExclusiveStartKey', async () => {
    sendMock
      .mockResolvedValueOnce({ Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } })
      .mockResolvedValueOnce({ Items: [{ id: 'b' }], LastEvaluatedKey: { id: 'b' } })
      .mockResolvedValueOnce({ Items: [{ id: 'c' }] }); // no LastEvaluatedKey -> stop
    const out = await Database.scan<{ id: string }>('T');
    expect(out.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(sendMock).toHaveBeenCalledTimes(3);
    // page 2 must carry page 1's key; page 1 must start from the beginning
    expect(sendMock.mock.calls[0][0].input.ExclusiveStartKey).toBeUndefined();
    expect(sendMock.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ id: 'a' });
    expect(sendMock.mock.calls[2][0].input.ExclusiveStartKey).toEqual({ id: 'b' });
  });

  it('returns immediately for a single-page result', async () => {
    sendMock.mockResolvedValueOnce({ Items: [{ id: 'only' }] });
    const out = await Database.scan<{ id: string }>('T');
    expect(out.map(x => x.id)).toEqual(['only']);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('carries the FilterExpression on every page', async () => {
    sendMock
      .mockResolvedValueOnce({ Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } })
      .mockResolvedValueOnce({ Items: [{ id: 'b' }] });
    await Database.scan<{ id: string }>('T', '#s = :v', { ':v': 'x' }, { '#s': 'status' });
    expect(sendMock.mock.calls[1][0].input.FilterExpression).toBe('#s = :v');
    expect(sendMock.mock.calls[1][0].input.ExpressionAttributeValues).toEqual({ ':v': 'x' });
  });

  it('returns [] on an empty result (no undefined)', async () => {
    sendMock.mockResolvedValueOnce({});
    expect(await Database.scan('T')).toEqual([]);
  });
});

describe('BL-C1: Database.query paginates across LastEvaluatedKey', () => {
  it('accumulates items across all pages', async () => {
    sendMock
      .mockResolvedValueOnce({ Items: [{ id: 'x' }], LastEvaluatedKey: { id: 'x' } })
      .mockResolvedValueOnce({ Items: [{ id: 'y' }] });
    const out = await Database.query<{ id: string }>('T', 'idx', '#k = :v', { '#k': 'k' }, { ':v': 1 });
    expect(out.map(x => x.id)).toEqual(['x', 'y']);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ id: 'x' });
  });
});
