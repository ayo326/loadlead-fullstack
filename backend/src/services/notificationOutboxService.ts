/**
 * Durable push-notification outbox (audit v4 M7/COA-3B).
 *
 * The old pattern was fire-and-forget: `PushService.send(...).catch(() => {})`
 * - a transient push outage silently dropped the counterparty's notification
 * (a driver never learns the load is assigned; misses the pickup window).
 *
 * Every send now writes an outbox row FIRST (durable intent), then attempts
 * delivery inline. A failed attempt leaves the row PENDING with the error;
 * the sweeper retries with capped attempts until SENT or FAILED-terminal.
 * Rows self-prune via the table's TTL. The in-app notification (if any) is
 * the caller's concern - this outbox owns only the push leg.
 */
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { PushService } from './pushService';

export type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface OutboxRow {
  outboxId: string; // 'obx_...'
  toUserId: string;
  title: string;
  body: string;
  url?: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
  /** Epoch SECONDS for the DynamoDB TTL attribute (rows self-prune). */
  expiresAt: number;
}

const MAX_ATTEMPTS = 5;
const ROW_TTL_DAYS = 14;

const TABLE = () => config.dynamodb.notificationOutboxTable;

export class NotificationOutboxService {
  /**
   * Durably enqueue a push and attempt delivery inline. Never throws - the
   * caller's business action must not fail on notification plumbing; the
   * worst case is a PENDING row the sweeper retries.
   */
  static async deliver(toUserId: string, title: string, body: string, url?: string): Promise<void> {
    const now = Helpers.getCurrentTimestamp();
    const row: OutboxRow = {
      outboxId: Helpers.generateId('obx'),
      toUserId,
      title,
      body,
      ...(url ? { url } : {}),
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: Math.floor(now / 1000) + ROW_TTL_DAYS * 24 * 60 * 60,
    };
    try {
      await Database.putItem(TABLE(), row);
    } catch (err) {
      // Outbox write itself failed: fall back to the old direct best-effort
      // send so the notification still has one chance, and log loudly.
      Logger.error(`[outbox] enqueue failed for ${toUserId}; attempting direct send`, err);
      await PushService.send(toUserId, title, body, url).catch(() => undefined);
      return;
    }
    await this.attempt(row);
  }

  /** One delivery attempt; updates the row in place. Never throws. */
  private static async attempt(row: OutboxRow): Promise<boolean> {
    const attempts = row.attempts + 1;
    try {
      await PushService.send(row.toUserId, row.title, row.body, row.url);
      await Database.updateItem(TABLE(), { outboxId: row.outboxId }, {
        status: 'SENT',
        attempts,
        sentAt: Helpers.getCurrentTimestamp(),
        updatedAt: Helpers.getCurrentTimestamp(),
      }).catch(() => undefined); // delivery already happened; a stale row is harmless
      return true;
    } catch (err: any) {
      const terminal = attempts >= MAX_ATTEMPTS;
      await Database.updateItem(TABLE(), { outboxId: row.outboxId }, {
        status: terminal ? 'FAILED' : 'PENDING',
        attempts,
        lastError: String(err?.message ?? err).slice(0, 500),
        updatedAt: Helpers.getCurrentTimestamp(),
      }).catch(() => undefined);
      if (terminal) {
        Logger.error(`[outbox] notification FAILED terminally for ${row.toUserId} after ${attempts} attempts (${row.title})`);
      }
      return false;
    }
  }

  /**
   * Retry PENDING rows (sweeper; wired in index.ts). Scan is fine: the table
   * holds only in-flight/recent rows and TTL prunes it. Returns counts for
   * the ops log line.
   */
  static async sweep(): Promise<{ retried: number; sent: number }> {
    let rows: OutboxRow[];
    try {
      rows = await Database.scan<OutboxRow>(TABLE());
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return { retried: 0, sent: 0 };
      throw err;
    }
    const pending = rows.filter((r) => r.status === 'PENDING' && r.attempts > 0 && r.attempts < MAX_ATTEMPTS);
    let sent = 0;
    for (const row of pending) {
      if (await this.attempt(row)) sent++;
    }
    if (pending.length > 0) Logger.info(`[outbox] sweep retried ${pending.length}, delivered ${sent}`);
    return { retried: pending.length, sent };
  }
}
