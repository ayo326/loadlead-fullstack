/**
 * Audit v6 M2: rated capacity (Driver.maxCapacityLbs) must be a whole number of
 * pounds within a sane bound. Before the fix, PUT /driver/profile passed the raw
 * request body straight into updateProfile with no schema validation, so a
 * negative, fractional, or unbounded value could reach the equipment profile and
 * break matching math (integer whole pounds) or hand a hauler an effectively
 * unlimited board. The guard is enforced in the service, authoritative for every
 * caller of updateProfile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateItem } = vi.hoisted(() => ({ updateItem: vi.fn(async () => ({})) }));
vi.mock('../../../src/config/database', () => ({
  Database: { updateItem, getItem: vi.fn(), scan: vi.fn(), putItem: vi.fn() },
  default: { updateItem, getItem: vi.fn(), scan: vi.fn(), putItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => {
  const l = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { Logger: l, default: l };
});

import { isValidRatedCapacity, CAPACITY_POLICY } from '../../../src/config/capacityPolicy';
import { DriverService } from '../../../src/services/driverService';

const MAX = CAPACITY_POLICY.maxRatedLbs;

describe('isValidRatedCapacity (audit v6 M2)', () => {
  it('accepts whole pounds within [0, max]', () => {
    expect(isValidRatedCapacity(0)).toBe(true);
    expect(isValidRatedCapacity(45000)).toBe(true);
    expect(isValidRatedCapacity(MAX)).toBe(true);
  });

  it('rejects negatives, fractions, over-max, and non-numbers', () => {
    expect(isValidRatedCapacity(-1)).toBe(false);
    expect(isValidRatedCapacity(1.5)).toBe(false);
    expect(isValidRatedCapacity(MAX + 1)).toBe(false);
    expect(isValidRatedCapacity(Number.NaN)).toBe(false);
    expect(isValidRatedCapacity(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidRatedCapacity('45000' as unknown)).toBe(false);
    expect(isValidRatedCapacity(undefined)).toBe(false);
    expect(isValidRatedCapacity(null)).toBe(false);
  });
});

describe('DriverService.updateProfile guards rated capacity (audit v6 M2)', () => {
  beforeEach(() => updateItem.mockClear());

  it('rejects a negative rated capacity with a 400 and writes nothing', async () => {
    await expect(
      DriverService.updateProfile('drv-1', { maxCapacityLbs: -5 } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('rejects a fractional rated capacity', async () => {
    await expect(
      DriverService.updateProfile('drv-1', { maxCapacityLbs: 1000.5 } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('rejects an absurdly large rated capacity (unlimited-board abuse)', async () => {
    await expect(
      DriverService.updateProfile('drv-1', { maxCapacityLbs: 9e15 } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('persists a valid whole-pound rated capacity', async () => {
    await DriverService.updateProfile('drv-1', { maxCapacityLbs: 45000 } as any);
    expect(updateItem).toHaveBeenCalledTimes(1);
    const [, key, data] = updateItem.mock.calls[0] as [string, any, any];
    expect(key).toEqual({ driverId: 'drv-1' });
    expect(data.maxCapacityLbs).toBe(45000);
  });

  it('leaves updates that omit capacity untouched by the guard', async () => {
    await DriverService.updateProfile('drv-1', { currentCity: 'Dallas' } as any);
    expect(updateItem).toHaveBeenCalledTimes(1);
  });
});
