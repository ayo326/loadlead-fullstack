/**
 * Phase 2: configurable linehaul take rate with the beta waiver.
 *
 * Proves the money primitives (integer cents, deterministic rounding), the
 * effective-take-rate resolver (waiver on -> 0, waiver off -> 5%), the cents
 * settlement split, and that every policy change is recorded append-only with an
 * actor and a timestamp. Mirrors the Database-mock style of betaTrustEvents.test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, updateItem, deleteItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      (tables[table] ??= []).push(item);
    }),
    getItem: vi.fn(async () => null),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => ({})),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, updateItem, deleteItem, scan },
  default: { putItem, getItem, updateItem, deleteItem, scan },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import config from '../../../src/config/environment';
import { PlatformFeeService } from '../../../src/services/platformFeeService';
import { PLATFORM_FEE_POLICY } from '../../../src/config/platformFee';
import { dollarsToCents, centsToDollars, applyBps, assertIntegerCents, formatCentsUsd } from '../../../src/utils/money';

const FEE_TABLE = config.dynamodb.platformFeePolicyTable;
const LOADS_TABLE = config.dynamodb.loadsTable;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  getItem.mockClear();
  updateItem.mockClear();
  deleteItem.mockClear();
  scan.mockClear();
});

describe('money primitives (integer cents)', () => {
  it('converts dollars to cents with deterministic half-up rounding', () => {
    expect(dollarsToCents(1234.56)).toBe(123456);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(12.345)).toBe(1235); // half-up at the cent
    expect(dollarsToCents(2.675)).toBe(268); // classic float case still resolves
  });

  it('round-trips cents back to dollars', () => {
    expect(centsToDollars(123456)).toBe(1234.56);
  });

  it('applies basis points to cents, rounding half-up to the nearest cent', () => {
    expect(applyBps(100000, 500)).toBe(5000); // 5% of $1,000 = $50.00
    expect(applyBps(100000, 0)).toBe(0); // waiver
    expect(applyBps(12345, 500)).toBe(617); // 617.25 -> 617
    expect(applyBps(0, 500)).toBe(0);
  });

  it('rejects non-integer cents and bad inputs', () => {
    expect(() => assertIntegerCents(10.5)).toThrow();
    expect(() => dollarsToCents(Infinity)).toThrow();
    expect(() => applyBps(100, -1)).toThrow();
    expect(() => applyBps(10.5, 500)).toThrow();
  });

  it('formats cents as USD', () => {
    expect(formatCentsUsd(123456)).toBe('$1,234.56');
    expect(formatCentsUsd(5)).toBe('$0.05');
    expect(formatCentsUsd(-5000)).toBe('-$50.00');
  });
});

describe('effective-take-rate resolver', () => {
  it('resolves to 0 while the beta waiver is on (the seeded default)', async () => {
    const policy = await PlatformFeeService.getCurrentPolicy();
    expect(policy).toEqual({ ...PLATFORM_FEE_POLICY });
    expect(policy.betaFeeWaiver).toBe(true);
    expect(await PlatformFeeService.resolveEffectiveTakeRateBps({ policy })).toBe(0);
  });

  it('resolves to the configured rate when the waiver is off', async () => {
    const bps = await PlatformFeeService.resolveEffectiveTakeRateBps({
      policy: { linehaulTakeRateBps: 500, betaFeeWaiver: false },
    });
    expect(bps).toBe(500);
  });

  it('applies an optional per-account discount, floored at 0, only when not waived', async () => {
    expect(
      await PlatformFeeService.resolveEffectiveTakeRateBps({
        policy: { linehaulTakeRateBps: 500, betaFeeWaiver: false },
        accountDiscountBps: 200,
      })
    ).toBe(300);
    expect(
      await PlatformFeeService.resolveEffectiveTakeRateBps({
        policy: { linehaulTakeRateBps: 500, betaFeeWaiver: false },
        accountDiscountBps: 9999,
      })
    ).toBe(0);
    // Discount is irrelevant while waived: still 0, never negative.
    expect(
      await PlatformFeeService.resolveEffectiveTakeRateBps({
        policy: { linehaulTakeRateBps: 500, betaFeeWaiver: true },
        accountDiscountBps: 200,
      })
    ).toBe(0);
  });
});

describe('linehaul settlement (integer cents)', () => {
  it('waiver on: carrier nets the full gross, platform fee is 0', async () => {
    const s = await PlatformFeeService.computeLinehaulSettlement(150000, {
      policy: { linehaulTakeRateBps: 500, betaFeeWaiver: true },
    });
    expect(s).toEqual({
      grossLinehaulCents: 150000,
      effectiveTakeRateBps: 0,
      platformFeeCents: 0,
      carrierNetCents: 150000,
    });
  });

  it('waiver off: 5% comes off the gross in cents and the split sums to gross', async () => {
    const s = await PlatformFeeService.computeLinehaulSettlement(150000, {
      policy: { linehaulTakeRateBps: 500, betaFeeWaiver: false },
    });
    expect(s.platformFeeCents).toBe(7500);
    expect(s.carrierNetCents).toBe(142500);
    expect(s.platformFeeCents + s.carrierNetCents).toBe(s.grossLinehaulCents);
  });

  it('is idempotent and deterministic for the same gross + policy', async () => {
    const opts = { policy: { linehaulTakeRateBps: 500, betaFeeWaiver: false } };
    const a = await PlatformFeeService.computeLinehaulSettlement(98765, opts);
    const b = await PlatformFeeService.computeLinehaulSettlement(98765, opts);
    expect(a).toEqual(b);
    expect(a.platformFeeCents + a.carrierNetCents).toBe(98765);
  });

  it('rejects a non-integer or negative gross', async () => {
    await expect(PlatformFeeService.computeLinehaulSettlement(10.5)).rejects.toThrow();
    await expect(PlatformFeeService.computeLinehaulSettlement(-1)).rejects.toThrow();
  });
});

describe('append-only policy changes', () => {
  it('records a change with an actor and a timestamp, then reads it back as current', async () => {
    const change = await PlatformFeeService.recordPolicyChange({
      linehaulTakeRateBps: 500,
      betaFeeWaiver: false, // ending the waiver
      actorId: 'admin-1',
      note: 'beta over, take rate live',
    });
    expect(change.changeId.startsWith('feepol_')).toBe(true);
    expect(change.actorId).toBe('admin-1');
    expect(typeof change.recordedAt).toBe('number');
    expect(putItem).toHaveBeenCalledWith(FEE_TABLE, expect.objectContaining({ changeId: change.changeId }));

    const current = await PlatformFeeService.getCurrentPolicy();
    expect(current).toEqual({ linehaulTakeRateBps: 500, betaFeeWaiver: false });
    expect(await PlatformFeeService.resolveEffectiveTakeRateBps()).toBe(500);
  });

  it('current policy is the newest recorded change; older rows are retained (append-only)', async () => {
    await PlatformFeeService.recordPolicyChange({ linehaulTakeRateBps: 500, betaFeeWaiver: true, actorId: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    await PlatformFeeService.recordPolicyChange({ linehaulTakeRateBps: 500, betaFeeWaiver: false, actorId: 'b' });
    expect((await PlatformFeeService.getCurrentPolicy()).betaFeeWaiver).toBe(false);
    // Nothing was ever updated or deleted: both rows remain.
    expect(tables[FEE_TABLE].length).toBe(2);
    expect(updateItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it('validates the take rate and requires an actor', async () => {
    await expect(
      PlatformFeeService.recordPolicyChange({ linehaulTakeRateBps: -1, betaFeeWaiver: false, actorId: 'a' })
    ).rejects.toThrow();
    await expect(
      PlatformFeeService.recordPolicyChange({ linehaulTakeRateBps: 10001, betaFeeWaiver: false, actorId: 'a' })
    ).rejects.toThrow();
    await expect(
      PlatformFeeService.recordPolicyChange({ linehaulTakeRateBps: 500, betaFeeWaiver: false, actorId: '' })
    ).rejects.toThrow();
  });

  it('falls back to the seeded default when the table does not exist yet', async () => {
    scan.mockImplementationOnce(async () => {
      const e: any = new Error('Requested resource not found');
      e.name = 'ResourceNotFoundException';
      throw e;
    });
    expect(await PlatformFeeService.getCurrentPolicy()).toEqual({ ...PLATFORM_FEE_POLICY });
  });

  it('never reads or writes the Load model', async () => {
    await PlatformFeeService.recordPolicyChange({ linehaulTakeRateBps: 500, betaFeeWaiver: false, actorId: 'a' });
    await PlatformFeeService.getCurrentPolicy();
    await PlatformFeeService.computeLinehaulSettlement(100000);
    for (const call of putItem.mock.calls) expect(call[0]).toBe(FEE_TABLE);
    expect(putItem.mock.calls.some((c) => c[0] === LOADS_TABLE)).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });
});
