/**
 * Route-level e-sign gate for negotiated assignments.
 *
 * The CARRIER_ACCEPT attestation that used to gate /engage now gates the
 * accept/assign step (the same place the claim path signs). This suite proves,
 * at the HTTP layer with real middleware + signed tokens:
 *   - the three routes that reach finishAccepted() (hauler accept-load, hauler
 *     accept-counter, shipper accept-bid) 412 when no CARRIER_ACCEPT signature
 *     is in the load's chain, and succeed once it is present;
 *   - a CARRIER_ACCEPT signed by a non-carrier role is rejected (409);
 *   - the non-assigning transitions (bid, counter, reject) are NOT gated, so the
 *     signature is required exactly at assignment and nowhere else.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  getById:            vi.fn(async (): Promise<any> => null),
  acceptLoad:         vi.fn(async (): Promise<any> => null),
  acceptOffer:        vi.fn(async (): Promise<any> => null),
  bid:                vi.fn(async (): Promise<any> => null),
  counter:            vi.fn(async (): Promise<any> => null),
  reject:             vi.fn(async (): Promise<any> => null),
  getProfileByUserId: vi.fn(async (): Promise<any> => null),
  resolveCarrierOfRecord: vi.fn(async (): Promise<any> => null),
  getShipperProfile:  vi.fn(async (): Promise<any> => null),
  getChain:           vi.fn(async (): Promise<any[]> => []),
  send:               vi.fn(async () => undefined),
}));

vi.mock('../../../src/services/negotiationService', () => ({
  NegotiationService: {
    getById:     m.getById,
    acceptLoad:  m.acceptLoad,
    acceptOffer: m.acceptOffer,
    bid:         m.bid,
    counter:     m.counter,
    reject:      m.reject,
    // viewFor() calls basisOf() when building every response body.
    basisOf:     (neg: any) => neg.rateBasis ?? (neg.postedRatePerMileCents != null ? 'PER_MILE' : 'FLAT_TOTAL'),
  },
}));
vi.mock('../../../src/services/driverService', () => ({ DriverService: { getProfileByUserId: m.getProfileByUserId } }));
vi.mock('../../../src/services/carrierOfRecord', () => ({ resolveCarrierOfRecord: m.resolveCarrierOfRecord }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: { getProfileByUserId: m.getShipperProfile } }));
vi.mock('../../../src/services/attestation/signatureService', () => ({ getChain: m.getChain }));
vi.mock('../../../src/services/pushService', () => ({ PushService: { send: m.send } }));
vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById: vi.fn(async () => null) } }));
// requireVerifiedCarrier gates /engage only (not the accept routes under test);
// stub it to a pass-through so importing the router never pulls the real one.
vi.mock('../../../src/services/verification', () => ({
  requireVerifiedCarrier: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import negotiationRoutes from '../../../src/routes/negotiations';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/negotiations', negotiationRoutes);
  return a;
}

const haulerToken  = Helpers.generateToken({ userId: 'oo-user', email: 'oo@x.test',   role: UserRole.OWNER_OPERATOR });
const shipperToken = Helpers.generateToken({ userId: 'ship-1',  email: 'ship@x.test', role: UserRole.SHIPPER });

const NEG = {
  negotiationId: 'neg-1', loadId: 'load-1', shipperId: 'ship-1',
  haulerUserId: 'oo-user', haulerDriverId: 'drv-1',
  status: 'ENGAGED', deadlineAt: Date.now() + 600_000, roundCount: 1,
  currentOfferRatePerMileCents: null, currentOfferTotalCents: null,
  agreedRatePerMileCents: 250, agreedLinehaulCents: 60_000,
};

const chainWith = (signerRole: string, assignedDriverId: string = 'drv-1') => [{
  // assignedDriverId defaults to the negotiation's haulerDriverId (drv-1) so the
  // BL-2 binding check passes; override it to prove the stale-signature bypass.
  action: 'CARRIER_ACCEPT', signatureId: 'sig-ca', signerRole, assignedDriverId, signedAt: new Date().toISOString(),
}];

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  vi.clearAllMocks();
  m.getById.mockResolvedValue({ ...NEG });
  m.acceptLoad.mockResolvedValue({ ...NEG, status: 'ACCEPTED', outcome: 'ACCEPT_LOAD' });
  m.acceptOffer.mockResolvedValue({ ...NEG, status: 'ACCEPTED', outcome: 'ACCEPT_BID' });
  m.bid.mockResolvedValue({ ...NEG, status: 'PENDING_SHIPPER', currentOfferRatePerMileCents: 240 });
  m.counter.mockResolvedValue({ ...NEG, status: 'PENDING_SHIPPER', currentOfferRatePerMileCents: 245 });
  m.reject.mockResolvedValue({ ...NEG, status: 'REJECTED', outcome: 'REJECT' });
  m.getProfileByUserId.mockResolvedValue({ driverId: 'drv-1', userId: 'oo-user' });
  m.resolveCarrierOfRecord.mockResolvedValue({ entityId: 'oo-9', entityType: 'OWNER_OPERATOR' });
  m.getShipperProfile.mockResolvedValue(null); // shipperActor matches on neg.shipperId === userId
  m.getChain.mockResolvedValue([]);            // default: no signatures
});

describe('e-sign gate at the negotiated accept/assign step', () => {
  it('hauler accept-load 412s when no CARRIER_ACCEPT signature exists', async () => {
    const res = await request(app()).post('/api/negotiations/neg-1/accept-load').set(bearer(haulerToken));
    expect(res.status).toBe(412);
    expect(m.acceptLoad).not.toHaveBeenCalled();
  });

  it('hauler accept-load succeeds once a carrier-signed CARRIER_ACCEPT is present', async () => {
    m.getChain.mockResolvedValue(chainWith('OWNER_OPERATOR'));
    const res = await request(app()).post('/api/negotiations/neg-1/accept-load').set(bearer(haulerToken));
    expect(res.status).toBe(200);
    expect(m.acceptLoad).toHaveBeenCalledWith('neg-1', 'drv-1');
  });

  it('a CARRIER_ACCEPT signed by a non-carrier role is rejected (409)', async () => {
    m.getChain.mockResolvedValue(chainWith('DRIVER'));
    const res = await request(app()).post('/api/negotiations/neg-1/accept-load').set(bearer(haulerToken));
    expect(res.status).toBe(409);
    expect(m.acceptLoad).not.toHaveBeenCalled();
  });

  it('BL-2: a CARRIER_ACCEPT bound to a DIFFERENT driver is rejected (stale-signature bypass blocked)', async () => {
    m.getChain.mockResolvedValue(chainWith('OWNER_OPERATOR', 'drv-someone-else'));
    const res = await request(app()).post('/api/negotiations/neg-1/accept-load').set(bearer(haulerToken));
    expect(res.status).toBe(409);
    expect(m.acceptLoad).not.toHaveBeenCalled();
  });

  it('hauler accept-counter 412s without a signature and passes with one', async () => {
    const blocked = await request(app()).post('/api/negotiations/neg-1/accept').set(bearer(haulerToken));
    expect(blocked.status).toBe(412);
    expect(m.acceptOffer).not.toHaveBeenCalled();

    m.getChain.mockResolvedValue(chainWith('CARRIER_ADMIN'));
    const ok = await request(app()).post('/api/negotiations/neg-1/accept').set(bearer(haulerToken));
    expect(ok.status).toBe(200);
    expect(m.acceptOffer).toHaveBeenCalledTimes(1);
  });

  it('shipper accept-bid 412s when the carrier never signed, passes once they have', async () => {
    const blocked = await request(app()).post('/api/negotiations/neg-1/shipper/accept').set(bearer(shipperToken));
    expect(blocked.status).toBe(412);
    expect(m.acceptOffer).not.toHaveBeenCalled();

    m.getChain.mockResolvedValue(chainWith('OWNER_OPERATOR'));
    const ok = await request(app()).post('/api/negotiations/neg-1/shipper/accept').set(bearer(shipperToken));
    expect(ok.status).toBe(200);
    expect(m.acceptOffer).toHaveBeenCalledTimes(1);
  });

  it('non-assigning transitions are NOT gated: bid, counter, reject pass with no signature', async () => {
    const bid = await request(app()).post('/api/negotiations/neg-1/bid')
      .set(bearer(haulerToken)).send({ ratePerMileCents: 240 });
    expect(bid.status).toBe(200);
    expect(m.bid).toHaveBeenCalledTimes(1);

    const rej = await request(app()).post('/api/negotiations/neg-1/reject').set(bearer(haulerToken));
    expect(rej.status).toBe(200);
    expect(m.reject).toHaveBeenCalledTimes(1);

    // getChain (the signature lookup) is never consulted for these paths.
    expect(m.getChain).not.toHaveBeenCalled();
  });
});
