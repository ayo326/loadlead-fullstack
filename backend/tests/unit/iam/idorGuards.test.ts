/**
 * Audit v6 object-level authorization (IDOR) fixes, at the HTTP layer with real
 * middleware + signed tokens:
 *   SEC-H4 - a receiver may only read loads addressed to them.
 *   SEC-H5 - a shipper may only create a BOL on a load they own.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  getLoadById: vi.fn(async (): Promise<any> => null),
  receiverByUserId: vi.fn(async (): Promise<any> => null),
  shipperByUserId: vi.fn(async (): Promise<any> => null),
  receiverById: vi.fn(async (): Promise<any> => null),
  driverById: vi.fn(async (): Promise<any> => null),
  createBOL: vi.fn(async (): Promise<any> => ({ bolId: 'bol-1' })),
}));

vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById: h.getLoadById } }));
vi.mock('../../../src/services/receiverService', () => ({ ReceiverService: { getProfileByUserId: h.receiverByUserId, getProfileById: h.receiverById } }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: { getProfileByUserId: h.shipperByUserId } }));
vi.mock('../../../src/services/driverService', () => ({ DriverService: { getProfileByUserId: vi.fn(async () => null), getProfileById: h.driverById } }));
vi.mock('../../../src/services/bolService', () => ({ BOLService: { createBOL: h.createBOL, getBOLById: vi.fn(async () => null), getBOLByLoadId: vi.fn(async () => null) } }));
vi.mock('../../../src/services/googleMapsService', () => ({ GoogleMapsService: {} }));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import receiverRoutes from '../../../src/routes/receiver';
import bolRoutes from '../../../src/routes/bol';
import mapsRoutes from '../../../src/routes/maps';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/receiver', receiverRoutes);
  a.use('/api/bol', bolRoutes);
  a.use('/api/maps', mapsRoutes);
  return a;
}
const receiverToken = Helpers.generateToken({ userId: 'ru1', email: 'r@x.test', role: UserRole.RECEIVER });
const shipperToken  = Helpers.generateToken({ userId: 'su1', email: 's@x.test', role: UserRole.SHIPPER });

beforeEach(() => vi.clearAllMocks());

describe('SEC-H4: receiver load read is receiver-scoped', () => {
  it('200 when the load is addressed to the calling receiver', async () => {
    h.getLoadById.mockResolvedValue({ loadId: 'load-1', receiverId: 'r1' });
    h.receiverByUserId.mockResolvedValue({ receiverId: 'r1', userId: 'ru1' });
    const r = await request(app()).get('/api/receiver/loads/load-1').set('Authorization', `Bearer ${receiverToken}`);
    expect(r.status).toBe(200);
  });

  it('404 when the load is addressed to a DIFFERENT receiver (no cross-tenant read)', async () => {
    h.getLoadById.mockResolvedValue({ loadId: 'load-1', receiverId: 'r2' });
    h.receiverByUserId.mockResolvedValue({ receiverId: 'r1', userId: 'ru1' });
    const r = await request(app()).get('/api/receiver/loads/load-1').set('Authorization', `Bearer ${receiverToken}`);
    expect(r.status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    const r = await request(app()).get('/api/receiver/loads/load-1');
    expect(r.status).toBe(401);
  });
});

describe('SEC-H5: BOL creation is shipper-scoped', () => {
  it('201 when the shipper owns the load', async () => {
    h.getLoadById.mockResolvedValue({ loadId: 'load-1', shipperId: 'sh1' });
    h.shipperByUserId.mockResolvedValue({ shipperId: 'sh1', userId: 'su1' });
    const r = await request(app()).post('/api/bol').set('Authorization', `Bearer ${shipperToken}`).send({ loadId: 'load-1' });
    expect(r.status).toBe(201);
    expect(h.createBOL).toHaveBeenCalled();
  });

  it('403 when the shipper does NOT own the load (no cross-tenant BOL)', async () => {
    h.getLoadById.mockResolvedValue({ loadId: 'load-1', shipperId: 'sh2' }); // owned by another shipper
    h.shipperByUserId.mockResolvedValue({ shipperId: 'sh1', userId: 'su1' });
    const r = await request(app()).post('/api/bol').set('Authorization', `Bearer ${shipperToken}`).send({ loadId: 'load-1' });
    expect(r.status).toBe(403);
    expect(h.createBOL).not.toHaveBeenCalled();
  });
});

describe('SEC-H6: the billed maps proxy requires auth', () => {
  it('401 unauthenticated (no anonymous Google calls)', async () => {
    const r = await request(app()).get('/api/maps/geocode?address=x');
    expect(r.status).toBe(401);
  });
});
