/**
 * Live-path seam: payout intercepts are applied inside reconcileDebtorPayment
 * when the mover is the payee. A counsel-signed garnishment reduces the carrier's
 * routed amount and records the intercept; with no intercept the full amount
 * routes. Underlying records are never mutated (only appends).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => { (tables[table] ??= []).push(item); }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, scan, getItem: vi.fn(async () => null), updateItem: vi.fn(), deleteItem: vi.fn() },
  default: { putItem, scan, getItem: vi.fn(async () => null), updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { ReconciliationService } from '../../../src/services/reconciliationService';
import { LawEnforcementService } from '../../../src/services/lawEnforcementService';
import { PayoutInterceptService } from '../../../src/services/payoutInterceptService';
import type { PayeeResolution } from '../../../src/services/payeeRoutingService';

const RECON = config.dynamodb.reconciliationOutcomesTable;
const carrierPayee: PayeeResolution = { type: 'CARRIER', carrierId: 'carrier-1', destination: 'acct://mover', reason: 'no assignment' };

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; putItem.mockClear(); });

describe('intercepts applied at settlement (CARRIER payee)', () => {
  it('a counsel-signed garnishment reduces the routed amount; the intercept is recorded', async () => {
    const intake = await LawEnforcementService.intake({
      type: 'GARNISHMENT', issuingAuthority: 'Court', receivedDate: '2026-07-01', describedScope: 'garnish carrier-1',
      scopeEntities: [{ entityType: 'CARRIER', entityId: 'carrier-1' }], actorId: 'liaison-1',
    });
    await LawEnforcementService.recordCounselSignOff({ requestId: intake.requestId, counselId: 'c', validityDetermination: 'VALID', actorId: 'liaison-1' });
    await PayoutInterceptService.create({
      requestId: intake.requestId, targetType: 'CARRIER', targetId: 'carrier-1', carrierId: 'carrier-1',
      instrumentRef: 'WG-1', percentageBps: 2500, instruction: 'REDIRECT', redirectTo: 'State', actorId: 'liaison-1',
    });

    const outcomes = await ReconciliationService.reconcileDebtorPayment({
      invoiceId: 'inv-1', carrierId: 'carrier-1', payee: carrierPayee, collectedCents: 100000, actorId: 'liaison-1',
    });
    const routed = outcomes.find((o) => o.type === 'PAYMENT_ROUTED')!;
    expect(routed.amountCents).toBe(75000); // 100000 minus a 25% garnishment
    expect((tables[RECON] ?? []).some((o) => o.type === 'INTERCEPT_APPLIED' && o.amountCents === 25000)).toBe(true);
  });

  it('routes the full amount when there is no intercept', async () => {
    const outcomes = await ReconciliationService.reconcileDebtorPayment({
      invoiceId: 'inv-2', carrierId: 'carrier-1', payee: carrierPayee, collectedCents: 100000, actorId: 'sys',
    });
    expect(outcomes.find((o) => o.type === 'PAYMENT_ROUTED')!.amountCents).toBe(100000);
    expect((tables[RECON] ?? []).some((o) => o.type === 'INTERCEPT_APPLIED')).toBe(false);
  });
});
