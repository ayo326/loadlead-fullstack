/**
 * w9Service intake orchestration: validate -> render -> encrypt -> store ->
 * append-only row + certification event. Asserts the TIN is encrypted and masked
 * (never plaintext in the row or the public shape), the non-US W-8 gate, the
 * Applied For hold (cannot verify), the access-logged full view, and the
 * name/TIN-change refresh trigger.
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

const { putObject, signedGetUrl } = vi.hoisted(() => ({
  putObject: vi.fn(async (key: string) => key),
  signedGetUrl: vi.fn(async (key: string) => `https://signed.example/${key}?sig=abc`),
}));
vi.mock('../../../src/services/compliance/complianceStorage', () => ({
  putObject,
  signedGetUrl,
  SIGNED_URL_TTL: 300,
}));

import config from '../../../src/config/environment';
import {
  submitW9,
  openFullW9,
  markW9Verified,
  flagW9RefreshRequired,
  SubmitW9Input,
} from '../../../src/services/compliance/w9Service';

const DOCS = config.dynamodb.complianceDocumentsTable;
const ACCESS = config.dynamodb.w9AccessLogTable;

const soleProp: SubmitW9Input = {
  ownerType: 'HAULER',
  ownerId: 'oo_1',
  line1Name: 'Jordan Hauler',
  classification: 'INDIVIDUAL_SOLE_PROPRIETOR',
  address: '100 Main St',
  cityStateZip: 'Dallas, TX 75201',
  tinType: 'SSN',
  tin: '123-45-6789',
  isUsPerson: true,
  signatureName: 'Jordan Hauler',
  signedDateISO: '2026-07-07',
  consentGiven: true,
};

const ctx = { actorAccountId: 'user_1', ipAddress: '1.2.3.4', userAgent: 'test' };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  [putItem, getItem, updateItem, scan, putObject, signedGetUrl].forEach((m) => m.mockClear());
});

describe('w9Service', () => {
  it('stores a W-9 with the TIN encrypted and masked, never in plaintext', async () => {
    const res = await submitW9(soleProp, ctx);
    expect(res.status).toBe('CREATED');
    expect(res.document?.tinLast4).toBe('6789');
    expect(res.contentHash).toBeTruthy();

    // The stored row holds ciphertext + last4, never the raw TIN.
    const row = tables[DOCS][0];
    expect(row.encryptedTin).toBeTruthy();
    expect(row.tinLast4).toBe('6789');
    expect(JSON.stringify(row)).not.toContain('123-45-6789');
    // The public shape carries no ciphertext.
    expect(JSON.stringify(res.document)).not.toContain(row.encryptedTin);
    expect(putObject).toHaveBeenCalledOnce();
  });

  it('blocks a non-US person with the W-8 signal and stores nothing', async () => {
    const res = await submitW9({ ...soleProp, isUsPerson: false }, ctx);
    expect(res.status).toBe('REQUIRES_W8');
    expect(res.requiresW8).toBe(true);
    expect(tables[DOCS] ?? []).toHaveLength(0);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects an SSN for a C corporation without storing', async () => {
    const res = await submitW9({ ...soleProp, classification: 'C_CORPORATION' }, ctx);
    expect(res.status).toBe('INVALID');
    expect(res.errors?.map((e) => e.code)).toContain('EIN_REQUIRED_FOR_ENTITY');
    expect(tables[DOCS] ?? []).toHaveLength(0);
  });

  it('holds an Applied For W-9 at PENDING and refuses to verify it', async () => {
    const res = await submitW9({ ...soleProp, tin: undefined, tinAppliedFor: true }, ctx);
    expect(res.status).toBe('CREATED');
    expect(res.document?.verificationStatus).toBe('PENDING');
    expect(res.document?.tinAppliedFor).toBe(true);

    await expect(markW9Verified(res.document!.documentId, 'admin_1')).rejects.toThrow();
    const row = tables[DOCS][0];
    expect(row.verificationStatus).toBe('PENDING');
  });

  it('opens the full W-9 through an access-logged signed URL', async () => {
    const res = await submitW9(soleProp, ctx);
    const opened = await openFullW9(res.document!.documentId, 'shipper_9', 'ASSIGNED_LOAD:load_5');
    expect(opened.url).toContain('signed.example');
    const log = tables[ACCESS];
    expect(log).toHaveLength(1);
    expect(log[0].viewerAccountId).toBe('shipper_9');
    expect(log[0].relationshipBasis).toBe('ASSIGNED_LOAD:load_5');
  });

  it('verifies a real-TIN W-9 and flags a refresh on a name/TIN change', async () => {
    const res = await submitW9(soleProp, ctx);
    await markW9Verified(res.document!.documentId, 'admin_1');
    expect(tables[DOCS][0].verificationStatus).toBe('VERIFIED');

    await flagW9RefreshRequired('HAULER', 'oo_1', 'legal name changed');
    const events = tables[config.dynamodb.complianceVerificationEventsTable];
    expect(events.some((e) => e.event === 'REFRESH_REQUIRED')).toBe(true);
  });
});
