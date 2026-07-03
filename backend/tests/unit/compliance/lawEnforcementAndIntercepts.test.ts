/**
 * Phases 5-7: law-enforcement handling + payout intercepts (+ role separation).
 *
 * Proves: intake auto-places a legal hold; disclosure is impossible without a
 * counsel sign-off and recorded once signed off; non-disclosure restricts an
 * entity; an active garnishment redirects the correct amount at settlement (only
 * with counsel sign-off) while the remainder routes normally, without mutating
 * underlying records; and a DISPUTE_ADMIN cannot hold the law-enforcement role.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      if (item.userId && item.roles) { // compliance grants upsert
        const idx = arr.findIndex((x) => x.userId === item.userId);
        if (idx >= 0) { arr[idx] = item; return; }
      }
      arr.push(item);
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, scan, getItem: vi.fn(async (t: string, k: any) => (tables[t] ?? []).find((x) => Object.keys(k).every((kk) => x[kk] === k[kk])) ?? null), updateItem: vi.fn(), deleteItem: vi.fn() },
  default: { putItem, scan, getItem: vi.fn(async () => null), updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { LawEnforcementService } from '../../../src/services/lawEnforcementService';
import { LegalHoldService } from '../../../src/services/legalHoldService';
import { PayoutInterceptService } from '../../../src/services/payoutInterceptService';
import { ComplianceRoleService } from '../../../src/services/complianceRoleService';
import { ComplianceRole } from '../../../src/types/complianceRole';

const DISC = config.dynamodb.disclosuresTable;
const RECON = config.dynamodb.reconciliationOutcomesTable;

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; putItem.mockClear(); });

const intakeInput = {
  type: 'SUBPOENA' as const, issuingAuthority: 'US District Court', receivedDate: '2026-07-01',
  describedScope: 'all records for load-1', scopeEntities: [{ entityType: 'LOAD', entityId: 'load-1' }], actorId: 'liaison-1',
};

describe('law-enforcement handling', () => {
  it('intake auto-places a legal hold on the in-scope entities', async () => {
    const intake = await LawEnforcementService.intake(intakeInput);
    expect(intake.validityReviewStatus).toBe('PENDING_REVIEW');
    expect(await LegalHoldService.isOnHold('LOAD', 'load-1')).toBe(true);
  });

  it('blocks disclosure without a counsel sign-off, and records it after sign-off', async () => {
    const intake = await LawEnforcementService.intake(intakeInput);
    await expect(LawEnforcementService.discloseScoped({
      requestId: intake.requestId, recipient: 'agent@fbi.gov', recordRefs: ['charge-1'], actorId: 'liaison-1',
    })).rejects.toThrow(/DISCLOSURE_BLOCKED_NO_COUNSEL_SIGNOFF/);
    expect(tables[DISC] ?? []).toHaveLength(0);

    await LawEnforcementService.recordCounselSignOff({
      requestId: intake.requestId, counselId: 'counsel-1', validityDetermination: 'VALID', actorId: 'liaison-1',
    });
    const d = await LawEnforcementService.discloseScoped({
      requestId: intake.requestId, recipient: 'agent@fbi.gov', recordRefs: ['charge-1', 'adv-1'], actorId: 'liaison-1',
    });
    expect(d.recipient).toBe('agent@fbi.gov');
    expect(d.recordRefs).toEqual(['charge-1', 'adv-1']);
    expect(tables[DISC]).toHaveLength(1);
  });

  it('a non-disclosure order restricts the in-scope entity', async () => {
    await LawEnforcementService.intake({ ...intakeInput, nonDisclosure: true, nonDisclosureBasis: '18 USC 2705(b)' });
    expect(await LawEnforcementService.isEntityRestricted('LOAD', 'load-1')).toBe(true);
    expect(await LawEnforcementService.isEntityRestricted('LOAD', 'other')).toBe(false);
  });
});

describe('payout intercepts', () => {
  async function signedRequest() {
    const intake = await LawEnforcementService.intake({ ...intakeInput, type: 'GARNISHMENT', scopeEntities: [{ entityType: 'CARRIER', entityId: 'carrier-1' }] });
    await LawEnforcementService.recordCounselSignOff({ requestId: intake.requestId, counselId: 'c', validityDetermination: 'VALID', actorId: 'liaison-1' });
    return intake.requestId;
  }

  it('an active garnishment redirects the correct amount, remainder routes normally', async () => {
    const requestId = await signedRequest();
    await PayoutInterceptService.create({
      requestId, targetType: 'CARRIER', targetId: 'carrier-1', carrierId: 'carrier-1',
      instrumentRef: 'WG-2026-77', percentageBps: 2500, instruction: 'REDIRECT', redirectTo: 'State of Texas', actorId: 'liaison-1',
    });
    const res = await PayoutInterceptService.applyAtSettlement({ invoiceId: 'inv-1', carrierId: 'carrier-1', grossCarrierCents: 100000, actorId: 'liaison-1' });
    expect(res.interceptedCents).toBe(25000); // 25% of $1000
    expect(res.carrierNetCents).toBe(75000);
    expect(res.applications[0].redirectTo).toBe('State of Texas');
    expect((tables[RECON] ?? []).some((o) => o.type === 'INTERCEPT_APPLIED' && o.amountCents === 25000)).toBe(true);
  });

  it('applies nothing without a counsel sign-off on the request', async () => {
    const intake = await LawEnforcementService.intake({ ...intakeInput, type: 'LEVY', scopeEntities: [{ entityType: 'CARRIER', entityId: 'carrier-1' }] });
    await PayoutInterceptService.create({
      requestId: intake.requestId, targetType: 'CARRIER', targetId: 'carrier-1', carrierId: 'carrier-1',
      instrumentRef: 'LEVY-9', amountCents: 30000, instruction: 'HOLD', actorId: 'liaison-1',
    });
    const res = await PayoutInterceptService.applyAtSettlement({ invoiceId: 'inv-1', carrierId: 'carrier-1', grossCarrierCents: 100000, actorId: 'liaison-1' });
    expect(res.interceptedCents).toBe(0);
    expect(res.carrierNetCents).toBe(100000);
  });
});

describe('role separation', () => {
  it('a DISPUTE_ADMIN does not hold the law-enforcement role', async () => {
    await ComplianceRoleService.grant('super', 'user-1', ComplianceRole.DISPUTE_ADMIN);
    expect(await ComplianceRoleService.hasRole('user-1', ComplianceRole.DISPUTE_ADMIN)).toBe(true);
    expect(await ComplianceRoleService.hasRole('user-1', ComplianceRole.LAW_ENFORCEMENT_LIAISON)).toBe(false);
  });
});
