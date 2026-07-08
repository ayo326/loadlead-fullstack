/**
 * ComplianceDocumentService: append-only versioning, supersession of the prior
 * current row (never deleted), the append-only verification-event trail, and the
 * append-only W9 access log. Nothing here touches the Load model.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, updateItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const keyOf = (item: any) =>
    item.documentId ?? item.eventId ?? item.accessId;
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      (tables[table] ??= []).push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const rows = tables[table] ?? [];
      const [k, v] = Object.entries(key)[0] as [string, any];
      return rows.find((r) => r[k] === v) ?? null;
    }),
    updateItem: vi.fn(async (table: string, key: any, patch: any) => {
      const rows = tables[table] ?? [];
      const [k, v] = Object.entries(key)[0] as [string, any];
      const row = rows.find((r) => r[k] === v);
      if (row) Object.assign(row, patch);
      return {};
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, updateItem, scan },
  default: { putItem, getItem, updateItem, scan },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import config from '../../../src/config/environment';
import { ComplianceDocumentService } from '../../../src/services/complianceDocumentService';

const DOCS = config.dynamodb.complianceDocumentsTable;
const EVENTS = config.dynamodb.complianceVerificationEventsTable;
const ACCESS = config.dynamodb.w9AccessLogTable;
const LOADS = config.dynamodb.loadsTable;

const base = {
  ownerType: 'HAULER' as const,
  ownerId: 'oo_1',
  documentType: 'COI' as const,
  s3Key: 'compliance/oo_1/coi/v1.pdf',
  originalFilename: 'coi.pdf',
  contentHash: 'hash-v1',
  uploadedBy: 'user_1',
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  getItem.mockClear();
  updateItem.mockClear();
  scan.mockClear();
});

describe('ComplianceDocumentService', () => {
  it('creates a document as the current version and writes a SUBMITTED event', async () => {
    const doc = await ComplianceDocumentService.createDocument(base);
    expect(doc.documentId).toMatch(/^cdoc_/);
    expect(doc.isCurrentVersion).toBe(true);
    expect(doc.verificationStatus).toBe('PENDING');

    const events = await ComplianceDocumentService.listEvents(doc.documentId);
    expect(events.map((e) => e.event)).toEqual(['SUBMITTED']);
  });

  it('a re-upload supersedes the prior version without deleting it (append-only)', async () => {
    const v1 = await ComplianceDocumentService.createDocument(base);
    const v2 = await ComplianceDocumentService.createDocument({
      ...base,
      s3Key: 'compliance/oo_1/coi/v2.pdf',
      contentHash: 'hash-v2',
    });

    // Both rows still exist (nothing deleted).
    const all = await ComplianceDocumentService.listByOwner('HAULER', 'oo_1');
    expect(all).toHaveLength(2);

    // Only v2 is current; v1 is superseded and points at v2.
    const current = await ComplianceDocumentService.getCurrent('HAULER', 'oo_1', 'COI');
    expect(current?.documentId).toBe(v2.documentId);

    const oldV1 = await ComplianceDocumentService.getById(v1.documentId);
    expect(oldV1?.isCurrentVersion).toBe(false);
    expect(oldV1?.supersededByDocumentId).toBe(v2.documentId);

    // The old row recorded a SUPERSEDED event.
    const v1Events = await ComplianceDocumentService.listEvents(v1.documentId);
    expect(v1Events.map((e) => e.event)).toContain('SUPERSEDED');
  });

  it('setVerificationStatus updates the live status and appends the event', async () => {
    const doc = await ComplianceDocumentService.createDocument(base);
    await ComplianceDocumentService.setVerificationStatus(doc.documentId, 'VERIFIED', 'VERIFIED', 'admin_1', 'looks good');

    const refreshed = await ComplianceDocumentService.getById(doc.documentId);
    expect(refreshed?.verificationStatus).toBe('VERIFIED');

    const events = await ComplianceDocumentService.listEvents(doc.documentId);
    expect(events.map((e) => e.event)).toEqual(['SUBMITTED', 'VERIFIED']);
  });

  it('records W9 access rows append-only with the relationship basis', async () => {
    const doc = await ComplianceDocumentService.createDocument({ ...base, documentType: 'W9' });
    await ComplianceDocumentService.recordW9Access(doc.documentId, 'shipper_9', 'ASSIGNED_LOAD:load_5');
    await ComplianceDocumentService.recordW9Access(doc.documentId, 'shipper_9', 'ASSIGNED_LOAD:load_5');

    const log = await ComplianceDocumentService.listW9Access(doc.documentId);
    expect(log).toHaveLength(2);
    expect(log[0].relationshipBasis).toBe('ASSIGNED_LOAD:load_5');
    expect(log.every((r) => r.viewerAccountId === 'shipper_9')).toBe(true);
  });

  it('never writes to the Load model', async () => {
    await ComplianceDocumentService.createDocument(base);
    await ComplianceDocumentService.createDocument({ ...base, contentHash: 'hash-v2' });
    for (const call of putItem.mock.calls) {
      expect([DOCS, EVENTS, ACCESS]).toContain(call[0]);
      expect(call[0]).not.toBe(LOADS);
    }
    expect(updateItem.mock.calls.every((c) => c[0] !== LOADS)).toBe(true);
  });
});
