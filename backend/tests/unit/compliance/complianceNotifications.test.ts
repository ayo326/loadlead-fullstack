/**
 * Phase 8: compliance notifications - verification-outcome to the hauler and the
 * COI expiry-ahead notices at the configured day thresholds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, updateItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (t: string, item: any) => {
      (tables[t] ??= []).push(item);
    }),
    getItem: vi.fn(async (t: string, key: any) => {
      const [k, v] = Object.entries(key)[0] as [string, any];
      return (tables[t] ?? []).find((r) => r[k] === v) ?? null;
    }),
    updateItem: vi.fn(async (t: string, key: any, patch: any) => {
      const [k, v] = Object.entries(key)[0] as [string, any];
      const row = (tables[t] ?? []).find((r) => r[k] === v);
      if (row) Object.assign(row, patch);
      return {};
    }),
    scan: vi.fn(async (t: string) => [...(tables[t] ?? [])]),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, updateItem, scan },
  default: { putItem, getItem, updateItem, scan },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { record } = vi.hoisted(() => ({ record: vi.fn(async () => undefined) }));
vi.mock('../../../src/services/notificationService', () => ({
  NotificationService: { record },
}));

const { getById: ooGetById } = vi.hoisted(() => ({ getById: vi.fn() }));
vi.mock('../../../src/services/ownerOperatorService', () => ({
  OwnerOperatorService: { getById: ooGetById },
}));

import { ComplianceDocumentService } from '../../../src/services/complianceDocumentService';
import {
  notifyVerificationOutcome,
  notifyExpiringCois,
} from '../../../src/services/compliance/complianceNotifications';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  record.mockClear();
  ooGetById.mockReset();
  ooGetById.mockResolvedValue({ operatorId: 'oo_1', userId: 'user_1' });
});

describe('complianceNotifications', () => {
  it('notifies the hauler when a document is verified', async () => {
    const doc = await ComplianceDocumentService.createDocument({
      ownerType: 'HAULER',
      ownerId: 'oo_1',
      documentType: 'W9',
      s3Key: 'k',
      originalFilename: 'w9.pdf',
      contentHash: 'h',
      uploadedBy: 'u',
      initialStatus: 'VERIFIED',
    });
    await notifyVerificationOutcome(doc.documentId);
    expect(record).toHaveBeenCalledOnce();
    const arg = record.mock.calls[0][0];
    expect(arg.userId).toBe('user_1');
    expect(arg.kind).toBe('COMPLIANCE');
    expect(arg.title).toMatch(/verified/i);
  });

  it('sends a COI expiry notice at 7 days but not at 10', async () => {
    const now = 1_000_000_000_000;
    await ComplianceDocumentService.createDocument({
      ownerType: 'HAULER',
      ownerId: 'oo_1',
      documentType: 'COI',
      s3Key: 'k',
      originalFilename: 'coi.pdf',
      contentHash: 'h',
      uploadedBy: 'u',
      initialStatus: 'VERIFIED',
      expiresAt: now + 7 * DAY,
    });
    const sent = await notifyExpiringCois(now, [30, 7]);
    expect(sent).toBe(1);

    record.mockClear();
    const none = await notifyExpiringCois(now, [30]); // 7-day COI does not match a 30-day threshold
    expect(none).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });
});
