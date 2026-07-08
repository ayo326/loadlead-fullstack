/**
 * Phase 7: shipper policy versioning, snapshot-at-accept (a later edit never
 * alters the snapshot), and the hauler's attestation signature landing with a
 * content hash. Nothing mutates a prior version.
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

import {
  upsertPolicy,
  getCurrentPolicy,
  snapshotPolicyOntoLoad,
  getPolicyVersion,
  signAttachedPolicy,
} from '../../../src/services/compliance/shipperPolicyService';

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  delete process.env.REQUIRE_SHIPPER_POLICY;
});

describe('shipperPolicyService', () => {
  it('versions on edit; the prior version is immutable', async () => {
    const v1 = await upsertPolicy({ shipperId: 's1', sourceType: 'TEXT', richText: 'Rule A', createdBy: 'u' });
    const v2 = await upsertPolicy({ shipperId: 's1', sourceType: 'TEXT', richText: 'Rule A and B', createdBy: 'u' });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    const current = await getCurrentPolicy('s1');
    expect(current?.policyVersionId).toBe(v2.policyVersionId);

    const oldV1 = await getPolicyVersion(v1.policyVersionId);
    expect(oldV1?.isCurrent).toBe(false);
    expect(oldV1?.richText).toBe('Rule A'); // untouched
    expect(oldV1?.contentHash).toBe(v1.contentHash);
  });

  it('snapshots the current version onto a load; a later edit does not change the snapshot', async () => {
    const v1 = await upsertPolicy({ shipperId: 's1', sourceType: 'TEXT', richText: 'Rule A', createdBy: 'u' });
    const att = await snapshotPolicyOntoLoad('load_1', 's1');
    expect(att?.version).toBe(1);
    expect(att?.snapshotHash).toBe(v1.contentHash);

    // The shipper edits the policy afterward.
    await upsertPolicy({ shipperId: 's1', sourceType: 'TEXT', richText: 'Rule A revised', createdBy: 'u' });
    const stillAtt = await snapshotPolicyOntoLoad('load_1', 's1'); // idempotent, returns the pinned one
    expect(stillAtt?.version).toBe(1);
    expect(stillAtt?.snapshotHash).toBe(v1.contentHash);
  });

  it('proceeds without a policy when the shipper has none (require flag off)', async () => {
    const att = await snapshotPolicyOntoLoad('load_2', 'sX');
    expect(att).toBeNull();
  });

  it('records the hauler signature with a content hash and consent', async () => {
    await upsertPolicy({ shipperId: 's1', sourceType: 'TEXT', richText: 'Rule A', createdBy: 'u' });
    await snapshotPolicyOntoLoad('load_3', 's1');
    const signed = await signAttachedPolicy({ loadId: 'load_3', signerUserId: 'hauler_u', signatureName: 'Jordan', consentGiven: true });
    expect(signed.signedByUserId).toBe('hauler_u');
    expect(signed.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.consentGiven).toBe(true);
  });

  it('refuses to sign without consent', async () => {
    await upsertPolicy({ shipperId: 's1', sourceType: 'TEXT', richText: 'Rule A', createdBy: 'u' });
    await snapshotPolicyOntoLoad('load_4', 's1');
    await expect(
      signAttachedPolicy({ loadId: 'load_4', signerUserId: 'h', signatureName: 'J', consentGiven: false }),
    ).rejects.toThrow();
  });
});
