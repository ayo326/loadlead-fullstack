/**
 * Notification outbox (audit v4 M7/COA-3B): a failed push leaves a durable
 * PENDING row the sweeper retries; success marks SENT; exhausted attempts go
 * FAILED-terminal. The business action never throws on notification plumbing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const H = vi.hoisted(() => {
  const rows = new Map<string, any>();
  return {
    rows,
    putItem: vi.fn(async (_t: string, item: any) => { rows.set(item.outboxId, { ...item }); }),
    updateItem: vi.fn(async (_t: string, key: any, patch: any) => {
      const r = rows.get(key.outboxId);
      if (r) rows.set(key.outboxId, { ...r, ...patch });
    }),
    scan: vi.fn(async () => [...rows.values()]),
    send: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/config/database', () => ({
  Database: { putItem: H.putItem, updateItem: H.updateItem, scan: H.scan },
}));
vi.mock('../../src/services/pushService', () => ({
  PushService: { send: H.send },
}));
vi.mock('../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NotificationOutboxService } from '../../src/services/notificationOutboxService';

beforeEach(() => {
  H.rows.clear();
  vi.clearAllMocks();
  H.send.mockReset();
  H.send.mockResolvedValue(undefined);
});

const only = () => [...H.rows.values()][0];

describe('deliver', () => {
  it('marks the row SENT on first-attempt success', async () => {
    await NotificationOutboxService.deliver('user-1', 'Assigned', 'Load L1 is yours', '/driver/loads/L1');
    expect(only()).toMatchObject({ toUserId: 'user-1', status: 'SENT', attempts: 1 });
    expect(only().sentAt).toBeGreaterThan(0);
  });

  it('leaves a PENDING row with the error when the push fails - and does not throw', async () => {
    H.send.mockRejectedValueOnce(new Error('push provider down'));
    await expect(
      NotificationOutboxService.deliver('user-1', 'Assigned', 'body'),
    ).resolves.toBeUndefined();
    expect(only()).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(only().lastError).toContain('push provider down');
  });

  it('falls back to a direct send if even the outbox write fails', async () => {
    H.putItem.mockRejectedValueOnce(new Error('ddb down'));
    await NotificationOutboxService.deliver('user-1', 'T', 'B');
    expect(H.send).toHaveBeenCalledTimes(1); // direct fallback attempt
    expect(H.rows.size).toBe(0);
  });
});

describe('sweep', () => {
  it('retries a PENDING row and marks it SENT when the outage ends', async () => {
    H.send.mockRejectedValueOnce(new Error('outage'));
    await NotificationOutboxService.deliver('user-1', 'T', 'B');
    expect(only().status).toBe('PENDING');

    const { retried, sent } = await NotificationOutboxService.sweep();
    expect(retried).toBe(1);
    expect(sent).toBe(1);
    expect(only()).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('goes FAILED-terminal after MAX_ATTEMPTS and stops retrying', async () => {
    H.send.mockRejectedValue(new Error('permanent'));
    await NotificationOutboxService.deliver('user-1', 'T', 'B'); // attempt 1
    for (let i = 0; i < 4; i++) await NotificationOutboxService.sweep(); // attempts 2..5
    expect(only()).toMatchObject({ status: 'FAILED', attempts: 5 });

    const { retried } = await NotificationOutboxService.sweep();
    expect(retried).toBe(0); // terminal rows are not picked up again
  });

  it('does not touch rows already SENT', async () => {
    await NotificationOutboxService.deliver('user-1', 'T', 'B');
    H.send.mockClear();
    await NotificationOutboxService.sweep();
    expect(H.send).not.toHaveBeenCalled();
  });
});
