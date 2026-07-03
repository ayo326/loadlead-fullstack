/**
 * Authorization for dispatch-on-behalf negotiation. haulerActor now accepts an
 * optional body.driverId; resolveHaulerDriver authorizes the acting user to act
 * on that driver. This suite drives the real bid route with the REAL permission
 * matrix (orgPermissions is NOT mocked) and mocks only the I/O lookups, proving
 * every hauler persona resolves correctly:
 *   - no driverId          → the caller's own driver (backward compatible)
 *   - own driver by id     → allowed
 *   - OO fleet driver      → allowed (owner-operator owns it) / 403 otherwise
 *   - carrier-org driver   → allowed for DISPATCHER (loads:accept) /
 *                            403 for ORG_DRIVER (no loads:accept) / 403 non-member
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  bid:                vi.fn(async (): Promise<any> => null),
  getProfileByUserId: vi.fn(async (): Promise<any> => null),
  getProfileById:     vi.fn(async (): Promise<any> => null),
  resolveCor:         vi.fn(async (): Promise<any> => null),
  ooGetByUserId:      vi.fn(async (): Promise<any> => null),
  getMembership:      vi.fn(async (): Promise<any> => null),
  send:               vi.fn(async () => undefined),
}));

vi.mock('../../../src/services/negotiationService', () => ({
  NegotiationService: {
    bid: m.bid,
    getById: vi.fn(async () => null),
    basisOf: (neg: any) => neg.rateBasis ?? 'PER_MILE',
  },
}));
vi.mock('../../../src/services/driverService', () => ({
  DriverService: { getProfileByUserId: m.getProfileByUserId, getProfileById: m.getProfileById },
}));
vi.mock('../../../src/services/carrierOfRecord', () => ({ resolveCarrierOfRecord: m.resolveCor }));
vi.mock('../../../src/services/ownerOperatorService', () => ({ OwnerOperatorService: { getByUserId: m.ooGetByUserId } }));
vi.mock('../../../src/services/orgService', () => ({ OrgMembershipService: { getMembership: m.getMembership } }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: { getProfileByUserId: vi.fn(async () => null) } }));
vi.mock('../../../src/services/pushService', () => ({ PushService: { send: m.send } }));
vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById: vi.fn(async () => null) } }));
vi.mock('../../../src/services/verification', () => ({ requireVerifiedCarrier: () => (_r: any, _s: any, n: any) => n() }));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
// NB: orgPermissions is intentionally NOT mocked — the real matrix decides.

import negotiationRoutes from '../../../src/routes/negotiations';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/negotiations', negotiationRoutes);
  return a;
}
const token = Helpers.generateToken({ userId: 'actor-user', email: 'a@x.test', role: UserRole.OWNER_OPERATOR });
const NEG = { negotiationId: 'neg-1', loadId: 'load-1', status: 'PENDING_SHIPPER', roundCount: 1, deadlineAt: Date.now() + 6e5, updatedAt: 2 };
const bidReq = (body: any) => request(app()).post('/api/negotiations/neg-1/bid').set({ Authorization: `Bearer ${token}` }).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  m.bid.mockResolvedValue({ ...NEG, currentOfferRatePerMileCents: 250, currentOfferParty: 'HAULER' });
  m.resolveCor.mockResolvedValue({ entityType: 'OWNER_OPERATOR', entityId: 'op-actor' });
});

describe('dispatch-on-behalf authorization (resolveHaulerDriver)', () => {
  it('no driverId → resolves the caller\'s own driver (backward compatible)', async () => {
    m.getProfileByUserId.mockResolvedValue({ driverId: 'drv-self', userId: 'actor-user' });
    const res = await bidReq({ ratePerMileCents: 250 });
    expect(res.status).toBe(200);
    expect(m.bid).toHaveBeenCalledWith('neg-1', 'drv-self', expect.anything());
    expect(m.getProfileById).not.toHaveBeenCalled();
  });

  it('own driver by id → allowed', async () => {
    m.getProfileById.mockResolvedValue({ driverId: 'drv-self', userId: 'actor-user' });
    const res = await bidReq({ ratePerMileCents: 250, driverId: 'drv-self' });
    expect(res.status).toBe(200);
    expect(m.bid).toHaveBeenCalledWith('neg-1', 'drv-self', expect.anything());
  });

  it('owner-operator acting on a driver in their own fleet → allowed', async () => {
    m.getProfileById.mockResolvedValue({ driverId: 'drv-fleet', userId: 'fleet-driver-user' });
    m.resolveCor.mockResolvedValue({ entityType: 'OWNER_OPERATOR', entityId: 'op-actor' });
    m.ooGetByUserId.mockResolvedValue({ operatorId: 'op-actor' });  // actor owns op-actor
    const res = await bidReq({ ratePerMileCents: 250, driverId: 'drv-fleet' });
    expect(res.status).toBe(200);
    expect(m.bid).toHaveBeenCalledWith('neg-1', 'drv-fleet', expect.anything());
  });

  it('owner-operator acting on a driver NOT in their fleet → 403', async () => {
    m.getProfileById.mockResolvedValue({ driverId: 'drv-foreign', userId: 'other-driver-user' });
    m.resolveCor.mockResolvedValue({ entityType: 'OWNER_OPERATOR', entityId: 'op-someone-else' });
    m.ooGetByUserId.mockResolvedValue({ operatorId: 'op-actor' });  // different operator
    const res = await bidReq({ ratePerMileCents: 250, driverId: 'drv-foreign' });
    expect(res.status).toBe(403);
    expect(m.bid).not.toHaveBeenCalled();
  });

  it('carrier-org DISPATCHER acting on an org driver → allowed (loads:accept)', async () => {
    m.getProfileById.mockResolvedValue({ driverId: 'drv-org', userId: 'org-driver-user' });
    m.resolveCor.mockResolvedValue({ entityType: 'CARRIER_ORG', entityId: 'org-1' });
    m.getMembership.mockResolvedValue({ orgId: 'org-1', userId: 'actor-user', orgRole: 'DISPATCHER', status: 'ACTIVE' });
    const res = await bidReq({ ratePerMileCents: 250, driverId: 'drv-org' });
    expect(res.status).toBe(200);
    expect(m.bid).toHaveBeenCalledWith('neg-1', 'drv-org', expect.anything());
  });

  it('carrier-org ORG_DRIVER (no dispatch authority) → 403', async () => {
    m.getProfileById.mockResolvedValue({ driverId: 'drv-org', userId: 'org-driver-user' });
    m.resolveCor.mockResolvedValue({ entityType: 'CARRIER_ORG', entityId: 'org-1' });
    m.getMembership.mockResolvedValue({ orgId: 'org-1', userId: 'actor-user', orgRole: 'ORG_DRIVER', status: 'ACTIVE' });
    const res = await bidReq({ ratePerMileCents: 250, driverId: 'drv-org' });
    expect(res.status).toBe(403);
    expect(m.bid).not.toHaveBeenCalled();
  });

  it('non-member of the driver\'s org → 403', async () => {
    m.getProfileById.mockResolvedValue({ driverId: 'drv-org', userId: 'org-driver-user' });
    m.resolveCor.mockResolvedValue({ entityType: 'CARRIER_ORG', entityId: 'org-1' });
    m.getMembership.mockResolvedValue(null); // actor is not in org-1
    const res = await bidReq({ ratePerMileCents: 250, driverId: 'drv-org' });
    expect(res.status).toBe(403);
    expect(m.bid).not.toHaveBeenCalled();
  });
});
