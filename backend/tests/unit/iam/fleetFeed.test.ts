// Phase 2 -- fleet feed contract + no-fabrication invariant.
//
// Proves:
//   1. Drivers with no lastLocationUpdate get position: null. The
//      backend MUST NOT invent coordinates.
//   2. Drivers with real coordinates surface them under
//      position.source = "driver-app" -- explicitly NOT presented as
//      a live telematics fix.
//   3. liveTracking.connected reflects the TELEMATICS_PROVIDER env
//      strictly: empty/unset = false, any value = true. Never both.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const driverServiceMock = vi.hoisted(() => ({
  getDriversByStatus: vi.fn(),
  getProfileById:     vi.fn(),
}));
const loadServiceMock = vi.hoisted(() => ({ getLoadById: vi.fn() }));
const dbMock          = vi.hoisted(() => ({ getItem: vi.fn() }));
const sendMock        = vi.hoisted(() => vi.fn(async () => ({ Items: [] })));

vi.mock('../../../src/services/driverService',  () => ({ DriverService:  driverServiceMock }));
vi.mock('../../../src/services/loadService',    () => ({ LoadService:    loadServiceMock }));
vi.mock('../../../src/config/database',         () => ({ Database:       dbMock }));
vi.mock('../../../src/config/aws',              () => ({ docClient: { send: sendMock } }));
vi.mock('../../../src/config/environment',      () => ({
  default: { dynamodb: { usersTable: 'LoadLead_Users', orgsTable: 'LoadLead_Organizations', membershipsTable: 'LoadLead_Memberships' } },
}));
vi.mock('../../../src/middleware/auth', async () => {
  const actual: any = await vi.importActual('../../../src/middleware/auth');
  return {
    ...actual,
    authenticate:     (req: any, _res: any, next: any) => { req.user = { userId: 'staff-1', role: 'ADMIN' }; next(); },
    requireAdmin:     (_req: any, _res: any, next: any) => next(),
    requireStaffTier: () => (_req: any, _res: any, next: any) => next(),
  };
});

import express from 'express';
import request from 'supertest';
import adminRoutes from '../../../src/routes/admin';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin', adminRoutes);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TELEMATICS_PROVIDER;
  loadServiceMock.getLoadById.mockResolvedValue(null);
  dbMock.getItem.mockResolvedValue({ idvStatus: 'UNVERIFIED' });
});

describe('GET /api/admin/fleet/feed -- no fabrication, honest source labelling', () => {
  it('drivers with no coordinates: position is null (not zero, not made up)', async () => {
    // The implementation iterates every DriverStatus enum value; return
    // our one un-located driver from PENDING_VERIFICATION and empty
    // arrays from the rest.
    driverServiceMock.getDriversByStatus.mockImplementation(async (status: any) =>
      status === 'PENDING_VERIFICATION'
        ? [{ driverId: 'd-1', userId: 'u-1', status, currentLat: 0, currentLng: 0, lastLocationUpdate: 0 }]
        : []);

    const r = await request(app()).get('/api/admin/fleet/feed');
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].position).toBeNull();
  });

  it('drivers with real coordinates: position present, source = "driver-app" (never "live")', async () => {
    driverServiceMock.getDriversByStatus.mockImplementation(async (status: any) =>
      status === 'AVAILABLE'
        ? [{ driverId: 'd-2', userId: 'u-2', status, currentLat: 32.7767, currentLng: -96.7970,
             currentCity: 'Dallas', currentState: 'TX', lastLocationUpdate: 1782170000000 }]
        : []);

    const r = await request(app()).get('/api/admin/fleet/feed');
    expect(r.status).toBe(200);
    expect(r.body.items[0].position).toMatchObject({
      lat: 32.7767,
      lng: -96.797,
      source: 'driver-app',
    });
    // Critical: source must NEVER claim telematics when none is wired.
    expect(r.body.items[0].position.source).not.toBe('telematics');
    expect(r.body.items[0].position.source).not.toBe('live');
  });

  it('TELEMATICS_PROVIDER unset: liveTracking.connected = false', async () => {
    driverServiceMock.getDriversByStatus.mockResolvedValue([]);
    const r = await request(app()).get('/api/admin/fleet/feed');
    expect(r.body.liveTracking).toEqual({ connected: false, provider: null });
  });

  it('TELEMATICS_PROVIDER set: liveTracking.connected = true + provider echoed', async () => {
    process.env.TELEMATICS_PROVIDER = 'samsara';
    driverServiceMock.getDriversByStatus.mockResolvedValue([]);
    const r = await request(app()).get('/api/admin/fleet/feed');
    expect(r.body.liveTracking).toEqual({ connected: true, provider: 'samsara' });
  });

  it('counts buckets drivers by status', async () => {
    driverServiceMock.getDriversByStatus.mockImplementation(async (status: any) => {
      if (status === 'AVAILABLE') return [{ driverId: 'a', userId: 'a', status, currentLat: 1, currentLng: 1 }];
      if (status === 'VERIFIED')  return [
        { driverId: 'b', userId: 'b', status, currentLat: 0, currentLng: 0 },
        { driverId: 'c', userId: 'c', status, currentLat: 2, currentLng: 2 },
      ];
      return [];
    });

    const r = await request(app()).get('/api/admin/fleet/feed');
    expect(r.body.counts).toEqual({ AVAILABLE: 1, VERIFIED: 2 });
  });
});

describe('GET /api/admin/fleet/drivers/:driverId -- drawer payload', () => {
  it('404 when driver does not exist', async () => {
    driverServiceMock.getProfileById.mockResolvedValueOnce(null);
    const r = await request(app()).get('/api/admin/fleet/drivers/missing');
    expect(r.status).toBe(404);
  });

  it('joins IDV from the User row and surfaces current load when assigned', async () => {
    driverServiceMock.getProfileById.mockResolvedValueOnce({
      driverId: 'd-9', userId: 'u-9', status: 'AVAILABLE',
      currentLat: 0, currentLng: 0,
      currentLoadId: 'load-7',
    });
    dbMock.getItem.mockResolvedValueOnce({ idvStatus: 'VERIFIED', email: 'd@x.com', phone: '555-0100' });
    loadServiceMock.getLoadById.mockResolvedValueOnce({
      loadId: 'load-7', status: 'IN_TRANSIT',
      pickupCity: 'Houston',  pickupState: 'TX',
      deliveryCity: 'Atlanta', deliveryState: 'GA',
    });

    const r = await request(app()).get('/api/admin/fleet/drivers/d-9');
    expect(r.status).toBe(200);
    expect(r.body.idv.status).toBe('VERIFIED');
    expect(r.body.currentLoad).toMatchObject({
      loadId: 'load-7', pickupCity: 'Houston', deliveryCity: 'Atlanta',
    });
    // Driver has no real coords; position must be null (no fabrication).
    expect(r.body.driver.position).toBeNull();
  });
});
