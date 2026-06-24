// CONSTRAINT extension — chain READ authZ.
//
// Per spec: chain is "visible to the load's parties and read-only to
// platform admin." assertChainReadAccess unions per-action signer sets
// and admits ADMIN-role users separately. Anyone NOT in either set
// gets 403 WRONG_READER.

import { describe, it, expect, vi } from 'vitest';
import type { Load } from '../../../src/types';

vi.mock('../../../src/services/driverService', () => ({
  DriverService: {
    getProfileById: vi.fn(async (id: string) =>
      id === 'driver_D1' ? { driverId: 'driver_D1', userId: 'user_d1', ownedByOperatorId: 'oo_1' } : null,
    ),
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
    getById: vi.fn(async () => ({ operatorId: 'oo_1', userId: 'user_oo_1' })),
  },
}));

vi.mock('../../../src/services/carrierOfRecord', () => ({
  resolveCarrierOfRecord: vi.fn(async (driver: any) => ({
    entityType: 'OWNER_OPERATOR',
    entityId: driver.ownedByOperatorId,
  })),
}));

vi.mock('../../../src/config/aws', () => ({ docClient: { send: vi.fn() } }));

import { assertChainReadAccess } from '../../../src/services/attestation/assertSignerIsLoadParty';

const load: Load = {
  loadId: 'load_abc',
  shipperId: 'shipper_s1',
  receiverId: 'receiver_r1',
  assignedDriverId: 'driver_D1',
} as Load;

describe('assertChainReadAccess — chain READ authZ', () => {
  it('platform admin (UserRole.ADMIN) always reads', async () => {
    const r = await assertChainReadAccess(load, 'user_some_admin', 'ADMIN');
    expect(r.matchedAsAdmin).toBe(true);
  });

  it("the load's SHIPPER user is a party", async () => {
    const r = await assertChainReadAccess(load, 'user_shi_1', 'SHIPPER');
    expect(r.matchedAsAdmin).toBe(false);
    expect(r.allowedUserIds.has('user_shi_1')).toBe(true);
  });

  it("the load's assigned DRIVER is a party", async () => {
    const r = await assertChainReadAccess(load, 'user_d1', 'DRIVER');
    expect(r.allowedUserIds.has('user_d1')).toBe(true);
  });

  it("the load's RECEIVER is a party", async () => {
    const r = await assertChainReadAccess(load, 'user_rec_1', 'RECEIVER');
    expect(r.allowedUserIds.has('user_rec_1')).toBe(true);
  });

  it("the OO who is the driver's carrier-of-record is a party", async () => {
    const r = await assertChainReadAccess(load, 'user_oo_1', 'OWNER_OPERATOR');
    expect(r.allowedUserIds.has('user_oo_1')).toBe(true);
  });

  it('a random authenticated user (no party, not admin) gets 403 WRONG_READER', async () => {
    await expect(
      assertChainReadAccess(load, 'user_random', 'DRIVER'),
    ).rejects.toThrow(/WRONG_READER/);
  });

  it('missing entity for one action does NOT deny the read for a different party', async () => {
    // Simulate a load with no receiverId: RECEIVER_CONFIRM resolution
    // throws inside the helper, but the union should still include the
    // shipper + driver, so the shipper's read passes.
    const noReceiver = { ...load, receiverId: undefined } as unknown as Load;
    const r = await assertChainReadAccess(noReceiver, 'user_shi_1', 'SHIPPER');
    expect(r.allowedUserIds.has('user_shi_1')).toBe(true);
  });
});
