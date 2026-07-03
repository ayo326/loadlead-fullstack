/**
 * Admin audit log: the audit of the auditors.
 *
 * Append-only. Every admin read of sensitive data, every export, disclosure,
 * adjudication, hold, and intercept is recorded here with who, what, when, why,
 * and under what authority. Rows are never updated or deleted.
 *
 * The audit write is NON-OPTIONAL: record() does not swallow errors, so a
 * sensitive operation that awaits it fails closed if the audit cannot be written.
 * withAudit() enforces the ordering: the audit entry is written first, then the
 * action runs; if the audit write fails, the action never happens.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';

export interface AdminAuditEntry {
  auditId: string; // 'aud_...'
  actorId: string;
  actorRole: string; // the platform or compliance role acting
  action: string; // e.g. READ_CASE_FILE, DISCLOSE, ADJUDICATE_REVERSE, PLACE_HOLD
  targetRefs: string[]; // ids of the records acted on
  reason?: string;
  authorityRef?: string; // legal authority reference (request id, court order, etc.)
  at: number;
}

export interface RecordAuditInput {
  actorId: string;
  actorRole: string;
  action: string;
  targetRefs?: string[];
  reason?: string;
  authorityRef?: string;
}

export class AdminAuditService {
  /**
   * Write one append-only audit entry. Throws (does not swallow) so callers fail
   * closed when the audit cannot be recorded.
   */
  static async record(input: RecordAuditInput): Promise<AdminAuditEntry> {
    if (!input.actorId) throw new Error('adminAudit: actorId is required');
    if (!input.actorRole) throw new Error('adminAudit: actorRole is required');
    if (!input.action) throw new Error('adminAudit: action is required');

    const entry: AdminAuditEntry = {
      auditId: Helpers.generateId('aud'),
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetRefs: input.targetRefs ?? [],
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.authorityRef ? { authorityRef: input.authorityRef } : {}),
      at: Helpers.getCurrentTimestamp(),
    };
    // No try/catch: if this throws, the caller (and the whole action) fails.
    await Database.putItem(config.dynamodb.adminAuditLogTable, entry);
    return entry;
  }

  /**
   * Record the audit entry FIRST, then run the action. If the audit cannot be
   * written the action never runs (fail closed). Returns the action's result.
   */
  static async withAudit<T>(input: RecordAuditInput, action: () => Promise<T>): Promise<T> {
    await this.record(input);
    return action();
  }

  /** Read audit entries, newest first. Optionally filtered by actor or a target ref. */
  static async list(filter?: { actorId?: string; targetRef?: string; limit?: number }): Promise<AdminAuditEntry[]> {
    let rows: AdminAuditEntry[];
    try {
      rows = await Database.scan<AdminAuditEntry>(config.dynamodb.adminAuditLogTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
    let out = rows;
    if (filter?.actorId) out = out.filter((r) => r.actorId === filter.actorId);
    if (filter?.targetRef) out = out.filter((r) => r.targetRefs.includes(filter.targetRef!));
    out.sort((a, b) => b.at - a.at);
    return typeof filter?.limit === 'number' ? out.slice(0, filter.limit) : out;
  }
}
