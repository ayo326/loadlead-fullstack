/**
 * Accessorial routes: role gating is correctly wired. Mover-side stop events are
 * driver/OO-only; the charge approve/adjust/dispute lifecycle is shipper-only.
 * Real middleware + signed tokens; services are mocked so nothing touches DynamoDB.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { checkIn, checkOut, listStop, approve, getCharge, getLoadById, getShipperByUserId } = vi.hoisted(() => ({
  checkIn: vi.fn(async (input: any) => ({ eventId: 'stopevt_1', ...input })),
  checkOut: vi.fn(async (input: any) => ({ eventId: 'stopevt_2', ...input })),
  listStop: vi.fn(async () => []),
  approve: vi.fn(async (chargeId: string) => ({ chargeId, status: 'APPROVED' })),
  getCharge: vi.fn(async (chargeId: string) => ({ chargeId, loadId: 'load-1', status: 'PENDING_REVIEW' })),
  getLoadById: vi.fn(async () => ({ loadId: 'load-1', hazmat: false, equipmentType: 'DRY_VAN', assignedDriverId: 'd1', shipperId: 's1' })),
  // SEC-H2: the caller's shipper profile; shipperId matches the load's by default.
  getShipperByUserId: vi.fn(async () => ({ shipperId: 's1', userId: 's1' })),
}));

vi.mock('../../../src/services/stopEventService', () => ({
  StopEventService: { checkIn, checkOut, list: listStop },
}));
vi.mock('../../../src/services/accessorialChargeService', () => ({
  AccessorialChargeService: { approve, getCharge, adjust: vi.fn(), dispute: vi.fn(), listForLoad: vi.fn(async () => []), computeForStop: vi.fn() },
}));
vi.mock('../../../src/services/accessorialPolicyService', () => ({
  AccessorialPolicyService: { getOrCreateForLoad: vi.fn(async () => ({})), acceptPolicy: vi.fn() },
}));
vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById } }));
// SEC-M2: the caller (driver d1) resolves to the load's assigned mover, so stop
// events are authorized. getProfileById(assignedDriverId) stays null so resolveMoverId
// falls back to the assignedDriverId ('d1'), which callerMoverIds also yields.
vi.mock('../../../src/services/driverService', () => ({
  DriverService: {
    getProfileById: vi.fn(async () => null),
    getProfileByUserId: vi.fn(async () => ({ driverId: 'd1', userId: 'd1' })),
  },
}));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: { getProfileByUserId: getShipperByUserId } }));
vi.mock('../../../src/services/carrierOfRecord', () => ({ resolveCarrierOfRecord: vi.fn(async () => ({ entityId: 'carrier-1' })) }));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import accessorialRoutes from '../../../src/routes/accessorials';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/accessorials', accessorialRoutes);
  return a;
}

const driverToken = Helpers.generateToken({ userId: 'd1', email: 'd@x.test', role: UserRole.DRIVER });
const shipperToken = Helpers.generateToken({ userId: 's1', email: 's@x.test', role: UserRole.SHIPPER });

describe('stop events are mover-only', () => {
  it('401 unauthenticated', async () => {
    const r = await request(app()).post('/api/accessorials/loads/load-1/stops/PICKUP/check-in').send({});
    expect(r.status).toBe(401);
  });
  it('403 for a shipper', async () => {
    const r = await request(app())
      .post('/api/accessorials/loads/load-1/stops/PICKUP/check-in')
      .set('Authorization', `Bearer ${shipperToken}`).send({});
    expect(r.status).toBe(403);
  });
  it('201 for a driver and the check-in is recorded with the driver as actor', async () => {
    const r = await request(app())
      .post('/api/accessorials/loads/load-1/stops/PICKUP/check-in')
      .set('Authorization', `Bearer ${driverToken}`).send({ geofenceMatch: true });
    expect(r.status).toBe(201);
    expect(checkIn).toHaveBeenCalledWith(expect.objectContaining({ loadId: 'load-1', stopId: 'PICKUP', actorId: 'd1' }));
  });
});

describe('charge lifecycle is shipper-only', () => {
  it('403 for a driver approving a charge', async () => {
    const r = await request(app())
      .post('/api/accessorials/charges/charge-1/approve')
      .set('Authorization', `Bearer ${driverToken}`).send({});
    expect(r.status).toBe(403);
  });
  it('200 for a shipper approving their OWN load\'s charge', async () => {
    const r = await request(app())
      .post('/api/accessorials/charges/charge-1/approve')
      .set('Authorization', `Bearer ${shipperToken}`).send({});
    expect(r.status).toBe(200);
    expect(approve).toHaveBeenCalledWith('charge-1', 's1');
  });
  // SEC-H2: a shipper may only act on charges for loads they own.
  it('403 for a shipper approving a charge on ANOTHER shipper\'s load', async () => {
    getLoadById.mockResolvedValueOnce({ loadId: 'load-1', shipperId: 's2' }); // load belongs to s2, caller is s1
    const r = await request(app())
      .post('/api/accessorials/charges/charge-1/approve')
      .set('Authorization', `Bearer ${shipperToken}`).send({});
    expect(r.status).toBe(403); // guard throws before approve() is reached
  });
});
