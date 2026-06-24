// CONSTRAINT 1 proof — resolver-based signer, no denormalized field.
//
// Reassigning the driver between pickup and delivery must INSTANTLY flip
// who is permitted to sign DRIVER_DELIVER. The proof is that the same
// Load with assignedDriverId mutated yields a different allowed-userIds
// set, with no cache to flush.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Load } from '../../../src/types';

// Mock the entity services so the resolver runs in isolation.
vi.mock('../../../src/services/driverService', () => ({
  DriverService: {
    getProfileById: vi.fn(async (id: string) => {
      if (id === 'driver_D1') return { driverId: 'driver_D1', userId: 'user_d1', ownedByOperatorId: 'oo_1' };
      if (id === 'driver_D2') return { driverId: 'driver_D2', userId: 'user_d2', ownedByOperatorId: 'oo_2' };
      return null;
    }),
  },
}));

vi.mock('../../../src/services/shipperService', () => ({
  ShipperService: {
    getProfileById: vi.fn(async () => ({ shipperId: 'shipper_s1', userId: 'user_shi_1', orgId: null })),
  },
}));

vi.mock('../../../src/services/receiverService', () => ({
  ReceiverService: {
    getProfileById: vi.fn(async () => ({ receiverId: 'receiver_r1', userId: 'user_rec_1' })),
  },
}));

vi.mock('../../../src/services/ownerOperatorService', () => ({
  OwnerOperatorService: {
    getById: vi.fn(async (id: string) =>
      id === 'oo_1' ? { operatorId: 'oo_1', userId: 'user_oo_1' } :
      id === 'oo_2' ? { operatorId: 'oo_2', userId: 'user_oo_2' } : null,
    ),
  },
}));

vi.mock('../../../src/services/carrierOfRecord', () => ({
  resolveCarrierOfRecord: vi.fn(async (driver: any) => ({
    entityType: 'OWNER_OPERATOR',
    entityId: driver.ownedByOperatorId,
  })),
}));

vi.mock('../../../src/config/aws', () => ({ docClient: { send: vi.fn() } }));

import { assertSignerIsLoadParty, resolveSigners } from '../../../src/services/attestation/assertSignerIsLoadParty';

const baseLoad: Partial<Load> = {
  loadId: 'load_abc',
  shipperId: 'shipper_s1',
  receiverId: 'receiver_r1',
};

describe('CONSTRAINT 1 — resolver-based signer (no denormalized field)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SHIPPER user is the allowed BOL_SUBMIT signer (no org)', async () => {
    const r = await resolveSigners(baseLoad as Load, 'BOL_SUBMIT');
    expect(r.signerRole).toBe('SHIPPER');
    expect([...r.allowedUserIds]).toEqual(['user_shi_1']);
  });

  it('DRIVER_DELIVER signer is the load.assignedDriverId driver — resolved live', async () => {
    const loadD1: Load = { ...baseLoad, assignedDriverId: 'driver_D1' } as Load;
    const r = await resolveSigners(loadD1, 'DRIVER_DELIVER');
    expect([...r.allowedUserIds]).toEqual(['user_d1']);
  });

  it('reassigning the driver INSTANTLY flips the allowed signer (the cache-flush-not-needed proof)', async () => {
    const load: Load = { ...baseLoad, assignedDriverId: 'driver_D1' } as Load;

    const before = await resolveSigners(load, 'DRIVER_DELIVER');
    expect([...before.allowedUserIds]).toEqual(['user_d1']);

    // Reassign in place. NO cache, NO denormalized signer field on Load.
    load.assignedDriverId = 'driver_D2';

    const after = await resolveSigners(load, 'DRIVER_DELIVER');
    expect([...after.allowedUserIds]).toEqual(['user_d2']);

    // And the OLD user is now rejected with the structured error code.
    await expect(
      assertSignerIsLoadParty(load, 'DRIVER_DELIVER', 'user_d1'),
    ).rejects.toThrow(/WRONG_SIGNER/);
  });

  it('CARRIER_ACCEPT for an OO driver resolves to the operator userId', async () => {
    const load: Load = { ...baseLoad, assignedDriverId: 'driver_D1' } as Load;
    const r = await resolveSigners(load, 'CARRIER_ACCEPT');
    expect(r.signerRole).toBe('OWNER_OPERATOR');
    expect([...r.allowedUserIds]).toEqual(['user_oo_1']);
    expect(r.carrierOfRecordEntityType).toBe('OWNER_OPERATOR');
    expect(r.carrierOfRecordEntityId).toBe('oo_1');
  });

  it('a wrong-party user is rejected on every action (no proxy signing)', async () => {
    const load: Load = { ...baseLoad, assignedDriverId: 'driver_D1' } as Load;

    await expect(
      assertSignerIsLoadParty(load, 'BOL_SUBMIT', 'user_d1'),     // driver tries to sign as shipper
    ).rejects.toThrow(/WRONG_SIGNER/);

    await expect(
      assertSignerIsLoadParty(load, 'RECEIVER_CONFIRM', 'user_d1'), // driver tries to sign as receiver
    ).rejects.toThrow(/WRONG_SIGNER/);

    await expect(
      assertSignerIsLoadParty(load, 'DRIVER_PICKUP', 'user_shi_1'), // shipper tries to sign pickup
    ).rejects.toThrow(/WRONG_SIGNER/);
  });

  it('RECEIVER_CONFIRM rejects a load that has no receiverId assigned', async () => {
    const noReceiver: Load = { ...baseLoad, receiverId: undefined } as unknown as Load;
    await expect(resolveSigners(noReceiver, 'RECEIVER_CONFIRM')).rejects.toThrow(/no receiver/i);
  });
});
