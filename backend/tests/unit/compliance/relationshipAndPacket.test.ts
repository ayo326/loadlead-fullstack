/**
 * Phase 6: the single relationship resolver (pure decision) and the compliance
 * packet/badges. An unrelated shipper is denied full access; an active
 * negotiation, an assigned load, or a completed load within 90 days grants it.
 * Badges are public; the packet manifest carries hashes, never the TIN.
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

import { ComplianceDocumentService } from '../../../src/services/complianceDocumentService';
import { decideRelationship, COMPLETED_WINDOW_DAYS } from '../../../src/services/compliance/relationshipResolver';
import { complianceBadges, assemblePacket } from '../../../src/services/compliance/compliancePacketService';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
});

describe('decideRelationship (the one enforcement rule)', () => {
  const now = 1_000_000_000_000;
  it('denies an unrelated shipper', () => {
    const d = decideRelationship({ hasActiveNegotiation: false, hasAssignedLoad: false, mostRecentCompletedAt: null }, now);
    expect(d.allowed).toBe(false);
    expect(d.basis).toBeNull();
  });
  it('allows an active negotiation', () => {
    expect(decideRelationship({ hasActiveNegotiation: true, hasAssignedLoad: false, mostRecentCompletedAt: null }, now)).toEqual({
      allowed: true,
      basis: 'ACTIVE_NEGOTIATION',
    });
  });
  it('allows an assigned load', () => {
    expect(decideRelationship({ hasActiveNegotiation: false, hasAssignedLoad: true, mostRecentCompletedAt: null }, now).basis).toBe(
      'ASSIGNED_LOAD',
    );
  });
  it('allows a completed load within the window and denies past it', () => {
    const inWindow = now - (COMPLETED_WINDOW_DAYS - 1) * DAY;
    const outWindow = now - (COMPLETED_WINDOW_DAYS + 1) * DAY;
    expect(decideRelationship({ hasActiveNegotiation: false, hasAssignedLoad: false, mostRecentCompletedAt: inWindow }, now).allowed).toBe(true);
    expect(decideRelationship({ hasActiveNegotiation: false, hasAssignedLoad: false, mostRecentCompletedAt: outWindow }, now).allowed).toBe(false);
  });
});

describe('compliance badges + packet', () => {
  async function seedW9() {
    return ComplianceDocumentService.createDocument({
      ownerType: 'HAULER',
      ownerId: 'oo_1',
      documentType: 'W9',
      s3Key: 'k',
      originalFilename: 'w9.pdf',
      contentHash: 'hash-w9',
      uploadedBy: 'u',
      initialStatus: 'VERIFIED',
      tinLast4: '6789',
      encryptedTin: 'CIPHERTEXT',
    });
  }

  it('exposes public badges including MISSING for absent documents', async () => {
    await seedW9();
    const badges = await complianceBadges('oo_1');
    const w9 = badges.find((b) => b.documentType === 'W9')!;
    const coi = badges.find((b) => b.documentType === 'COI')!;
    expect(w9.present).toBe(true);
    expect(w9.status).toBe('VERIFIED');
    expect(coi.present).toBe(false);
    expect(coi.status).toBe('MISSING');
    expect(coi.actionRequired).toBe(true);
    // Badges never carry the ciphertext or the TIN.
    expect(JSON.stringify(badges)).not.toContain('CIPHERTEXT');
  });

  it('assembles a packet manifest with hashes and no TIN', async () => {
    await seedW9();
    const packet = await assemblePacket('oo_1');
    expect(packet.entries).toHaveLength(1);
    expect(packet.entries[0].contentHash).toBe('hash-w9');
    expect(packet.packetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(packet)).not.toContain('CIPHERTEXT');
    // Stable hash for the same contents.
    const again = await assemblePacket('oo_1');
    expect(again.packetHash).toBe(packet.packetHash);
  });
});
