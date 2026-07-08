/**
 * COI + Letter of Authority: intake, the FMCSA/QCMobile auto cross-check
 * (PASSED/FAILED recorded as append-only events), manual verify (including a
 * manual override of a failed auto-check), COI expiry flipping to EXPIRED with a
 * renewal creating a new PENDING version, and the insurance-provider stubs.
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
  putObject: vi.fn(async (k: string) => k),
  signedGetUrl: vi.fn(async (k: string) => `https://signed/${k}`),
}));
vi.mock('../../../src/services/compliance/complianceStorage', () => ({ putObject, signedGetUrl, SIGNED_URL_TTL: 300 }));

// FMCSA adapters: control the cross-check outcomes deterministically.
const { getInsuranceFilings, checkCarrierAuthority } = vi.hoisted(() => ({
  getInsuranceFilings: vi.fn(),
  checkCarrierAuthority: vi.fn(),
}));
vi.mock('../../../src/services/integrations/fmcsaInsurance', () => ({ getInsuranceFilings }));
vi.mock('../../../src/services/integrations/fmcsa', () => ({ checkCarrierAuthority }));

import config from '../../../src/config/environment';
import { ComplianceDocumentService } from '../../../src/services/complianceDocumentService';
import { submitCoi, decideCoi, expireDueCois } from '../../../src/services/compliance/coiService';
import { submitLetterOfAuthority } from '../../../src/services/compliance/letterOfAuthorityService';
import { resolveInsuranceProvider, HighwayProvider } from '../../../src/services/compliance/insuranceVerification';

const EVENTS = config.dynamodb.complianceVerificationEventsTable;
const bytes = new Uint8Array([1, 2, 3, 4]);

const coiFields = {
  insurerName: 'Great West Casualty',
  policyNumber: 'POL-1',
  autoLiabilityCents: 1_000_000_00,
  effectiveDate: 1,
  expiryDate: 999_999_999_999,
  dotNumber: '999000001',
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  [putItem, getItem, updateItem, scan, putObject, signedGetUrl, getInsuranceFilings, checkCarrierAuthority].forEach((m) =>
    m.mockClear(),
  );
});

describe('coiService', () => {
  it('records AUTO_CHECK_PASSED when the insurer matches the FMCSA filing', async () => {
    getInsuranceFilings.mockResolvedValue({
      hasActiveInsurance: true,
      insurerNames: ['GREAT WEST CASUALTY'],
      bipdOnFileDollars: 1_000_000,
    });
    const doc = await submitCoi(
      { ownerType: 'HAULER', ownerId: 'oo_1', fileBytes: bytes, originalFilename: 'coi.pdf', contentType: 'application/pdf', fields: coiFields },
      'user_1',
    );
    const evts = (tables[EVENTS] ?? []).filter((e) => e.documentId === doc.documentId).map((e) => e.event);
    expect(evts).toContain('AUTO_CHECK_PASSED');
  });

  it('records AUTO_CHECK_FAILED on an insurer mismatch but still allows a manual verify', async () => {
    getInsuranceFilings.mockResolvedValue({ hasActiveInsurance: true, insurerNames: ['SOME OTHER INSURER'], bipdOnFileDollars: 0 });
    const doc = await submitCoi(
      { ownerType: 'HAULER', ownerId: 'oo_2', fileBytes: bytes, originalFilename: 'coi.pdf', contentType: 'application/pdf', fields: { ...coiFields, autoLiabilityCents: 0 } },
      'user_1',
    );
    const evts = (tables[EVENTS] ?? []).filter((e) => e.documentId === doc.documentId).map((e) => e.event);
    expect(evts).toContain('AUTO_CHECK_FAILED');

    await decideCoi(doc.documentId, 'admin_1', 'VERIFIED', 'reviewed the paper COI');
    const row = await ComplianceDocumentService.getById(doc.documentId);
    expect(row?.verificationStatus).toBe('VERIFIED');
  });

  it('rejects non-integer coverage cents', async () => {
    getInsuranceFilings.mockResolvedValue({ hasActiveInsurance: false, insurerNames: [] });
    await expect(
      submitCoi(
        { ownerType: 'HAULER', ownerId: 'oo_3', fileBytes: bytes, originalFilename: 'c.pdf', contentType: 'application/pdf', fields: { ...coiFields, cargoCents: 1.5 } },
        'user_1',
      ),
    ).rejects.toThrow();
  });

  it('flips an expired COI to EXPIRED and a renewal creates a new PENDING version', async () => {
    getInsuranceFilings.mockResolvedValue({ hasActiveInsurance: true, insurerNames: ['GREAT WEST CASUALTY'], bipdOnFileDollars: 1_000_000 });
    const past = { ...coiFields, expiryDate: 1000 };
    const first = await submitCoi(
      { ownerType: 'HAULER', ownerId: 'oo_4', fileBytes: bytes, originalFilename: 'c.pdf', contentType: 'application/pdf', fields: past },
      'user_1',
    );
    const expired = await expireDueCois(5000);
    expect(expired).toContain(first.documentId);
    expect((await ComplianceDocumentService.getById(first.documentId))?.verificationStatus).toBe('EXPIRED');

    const renewal = await submitCoi(
      { ownerType: 'HAULER', ownerId: 'oo_4', fileBytes: bytes, originalFilename: 'c2.pdf', contentType: 'application/pdf', fields: coiFields },
      'user_1',
    );
    const current = await ComplianceDocumentService.getCurrent('HAULER', 'oo_4', 'COI');
    expect(current?.documentId).toBe(renewal.documentId);
    expect(current?.verificationStatus).toBe('PENDING');
  });
});

describe('letterOfAuthorityService', () => {
  it('passes the authority cross-check on matching active authority', async () => {
    checkCarrierAuthority.mockResolvedValue(true);
    const doc = await submitLetterOfAuthority(
      { ownerType: 'HAULER', ownerId: 'oo_1', fileBytes: bytes, originalFilename: 'loa.pdf', contentType: 'application/pdf', mcNumber: 'MC1', dotNumber: 'DOT1' },
      'user_1',
    );
    const evts = (tables[EVENTS] ?? []).filter((e) => e.documentId === doc.documentId).map((e) => e.event);
    expect(evts).toContain('AUTO_CHECK_PASSED');
  });

  it('fails the authority cross-check on inactive authority', async () => {
    checkCarrierAuthority.mockResolvedValue(false);
    const doc = await submitLetterOfAuthority(
      { ownerType: 'HAULER', ownerId: 'oo_2', fileBytes: bytes, originalFilename: 'loa.pdf', contentType: 'application/pdf', mcNumber: 'MC9', dotNumber: 'DOT9' },
      'user_1',
    );
    const evts = (tables[EVENTS] ?? []).filter((e) => e.documentId === doc.documentId).map((e) => e.event);
    expect(evts).toContain('AUTO_CHECK_FAILED');
  });
});

describe('insuranceVerification seam', () => {
  it('defaults to the manual provider', () => {
    expect(resolveInsuranceProvider().name).toBe('manual');
  });
  it('third-party stubs throw until configured', async () => {
    await expect(new HighwayProvider().submit({ documentId: 'd' })).rejects.toThrow('not configured');
  });
});
