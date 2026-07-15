/**
 * Audit v6 MEDIUM remediations - negative (vuln-closed) proofs.
 *   M8  invitation accept is email-bound; revoke is org-bound
 *   M9  shipper load edit is field-allowlisted (no status/rate/assignment mass-assign)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const DB = vi.hoisted(() => ({ getItem: vi.fn(), updateItem: vi.fn(async () => ({})), scan: vi.fn(async () => []), query: vi.fn(), putItem: vi.fn(async () => ({})) }));
const LOAD = vi.hoisted(() => ({ updateLoad: vi.fn(async () => undefined), getLoadById: vi.fn(async () => ({ loadId: 'load-1', shipperId: 's1' })) }));
const SHIP = vi.hoisted(() => ({ getProfileByUserId: vi.fn(async () => ({ shipperId: 's1', userId: 's1' })) }));

vi.mock('../../../src/config/database', () => ({ Database: DB, default: DB }));
vi.mock('../../../src/services/loadService', () => ({ LoadService: { ...LOAD, getLoadsByShipper: vi.fn(async () => []) } }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: SHIP }));
vi.mock('../../../src/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/middleware/auth', async () => {
  const actual = await vi.importActual<any>('../../../src/middleware/auth');
  return { ...actual, authenticate: (req: any, _res: any, next: any) => { req.user = { userId: 's1', email: 's1@x.test', role: 'SHIPPER' }; next(); } };
});

import { OrgInvitationService } from '../../../src/services/orgService';
import shipperRoutes from '../../../src/routes/shipper';

beforeEach(() => vi.clearAllMocks());

describe('M8: invitation accept is email-bound, revoke is org-bound', () => {
  it('rejects accept when the caller email does not match the invited email (403)', async () => {
    DB.getItem.mockResolvedValueOnce({ token: 't', email: 'invited@x.test', orgId: 'org-1', orgRole: 'ORG_DRIVER', expiresAt: Date.now() + 1e6 });
    await expect(OrgInvitationService.acceptInvitation('t', 'user-9', 'someone-else@x.test')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows accept when the caller email matches (no 403 from the bind)', async () => {
    DB.getItem.mockResolvedValueOnce({ token: 't', email: 'invited@x.test', orgId: undefined, orgRole: 'ORG_DRIVER', expiresAt: Date.now() + 1e6 });
    // self-signup branch (no orgId) just consumes the token; email matches so the bind passes.
    await expect(OrgInvitationService.acceptInvitation('t', 'user-9', 'invited@x.test')).resolves.toBeNull();
  });

  it('rejects revoke when the invite belongs to a different org (404)', async () => {
    DB.getItem.mockResolvedValueOnce({ token: 't', email: 'invited@x.test', orgId: 'org-OTHER', orgRole: 'ORG_DRIVER', expiresAt: Date.now() + 1e6 });
    await expect(OrgInvitationService.revokeInvitation('t', 'actor-1', 'org-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('M9: shipper load edit strips non-allowlisted fields', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/shipper', shipperRoutes);
    return a;
  }

  it('drops status / rateAmount / assignedDriverId / loadId but keeps pickupCity', async () => {
    LOAD.getLoadById.mockResolvedValue({ loadId: 'load-1', shipperId: 's1' });
    SHIP.getProfileByUserId.mockResolvedValue({ shipperId: 's1', userId: 's1' });

    const r = await request(app())
      .put('/api/shipper/loads/load-1')
      .send({ pickupCity: 'Dallas', status: 'DELIVERED', rateAmount: 999999, assignedDriverId: 'evil', loadId: 'other' });

    expect(r.status).toBe(200);
    expect(LOAD.updateLoad).toHaveBeenCalledTimes(1);
    const passed = LOAD.updateLoad.mock.calls[0][1];
    expect(passed).toEqual({ pickupCity: 'Dallas' });
    for (const forbidden of ['status', 'rateAmount', 'assignedDriverId', 'loadId']) {
      expect(passed).not.toHaveProperty(forbidden);
    }
  });
});
