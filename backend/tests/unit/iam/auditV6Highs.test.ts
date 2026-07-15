/**
 * Audit v6 HIGH remediations - negative proofs.
 *   H10  shipper approve/revoke-admin now require DESTRUCTIVE_TIER (not bare requireAdmin)
 *   H9   POD upload-url: image-MIME allowlist + assigned-driver ownership
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// A configurable authenticated user; the real requireAdmin / requireStaffTier / requireRole run.
let currentUser: any = null;
vi.mock('../../../src/middleware/auth', async () => {
  const actual = await vi.importActual<any>('../../../src/middleware/auth');
  return { ...actual, authenticate: (req: any, _res: any, next: any) => { req.user = currentUser; next(); } };
});

const SHIP = vi.hoisted(() => ({ approveAdminPrivileges: vi.fn(async () => undefined), revokeAdminPrivileges: vi.fn(async () => undefined), getPendingAdminRequests: vi.fn(async () => []) }));
const LOAD = vi.hoisted(() => ({ getLoadById: vi.fn() }));
const DRV = vi.hoisted(() => ({ getProfileByUserId: vi.fn() }));

// requireStaffTier re-reads the user's platformRole from the DB (never trusts the JWT),
// so back it with the current test user's tier.
vi.mock('../../../src/config/database', () => ({
  Database: {
    getItem: vi.fn(async (_table: string, key: any) =>
      key?.userId === currentUser?.userId ? { userId: currentUser.userId, platformRole: currentUser.platformRole } : null),
  },
}));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: SHIP }));
vi.mock('../../../src/services/loadService', () => ({ LoadService: LOAD }));
vi.mock('../../../src/services/driverService', () => ({ DriverService: DRV }));
vi.mock('../../../src/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import adminRoutes from '../../../src/routes/admin';
import driverRoutes from '../../../src/routes/driver';
import { errorHandler } from '../../../src/middleware/errorHandler';

beforeEach(() => { vi.clearAllMocks(); currentUser = null; });

describe('H10: shipper admin grant/revoke require DESTRUCTIVE_TIER', () => {
  const app = () => { const a = express(); a.use(express.json()); a.use('/api/admin', adminRoutes); a.use(errorHandler); return a; };

  it('403 for a STAFF_MANAGER (OPS, not destructive) approving shipper admin', async () => {
    currentUser = { userId: 'a1', email: 'a@x.test', role: 'ADMIN', platformRole: 'STAFF_MANAGER' };
    const r = await request(app()).post('/api/admin/shippers/s1/approve-admin').send({});
    expect(r.status).toBe(403);
    expect(SHIP.approveAdminPrivileges).not.toHaveBeenCalled();
  });

  it('200 for a STAFF_ADMIN approving shipper admin', async () => {
    currentUser = { userId: 'a1', email: 'a@x.test', role: 'ADMIN', platformRole: 'STAFF_ADMIN' };
    const r = await request(app()).post('/api/admin/shippers/s1/approve-admin').send({});
    expect(r.status).toBe(200);
    expect(SHIP.approveAdminPrivileges).toHaveBeenCalledWith('s1');
  });

  it('403 for a STAFF_MANAGER revoking shipper admin', async () => {
    currentUser = { userId: 'a1', email: 'a@x.test', role: 'ADMIN', platformRole: 'STAFF_MANAGER' };
    const r = await request(app()).post('/api/admin/shippers/s1/revoke-admin').send({});
    expect(r.status).toBe(403);
  });
});

describe('H9: POD upload-url MIME allowlist + assigned-driver ownership', () => {
  const app = () => { const a = express(); a.use(express.json()); a.use('/api/driver', driverRoutes); a.use(errorHandler); return a; };

  it('415 for a non-image content type', async () => {
    currentUser = { userId: 'd1', email: 'd@x.test', role: 'DRIVER' };
    const r = await request(app()).post('/api/driver/loads/load-1/pod/upload-url').send({ fileType: 'application/x-msdownload' });
    expect(r.status).toBe(415);
  });

  it('403 when the caller is not the load\'s assigned driver', async () => {
    currentUser = { userId: 'd1', email: 'd@x.test', role: 'DRIVER' };
    LOAD.getLoadById.mockResolvedValueOnce({ loadId: 'load-1', assignedDriverId: 'd999' });
    DRV.getProfileByUserId.mockResolvedValueOnce({ driverId: 'd1', userId: 'd1' });
    const r = await request(app()).post('/api/driver/loads/load-1/pod/upload-url').send({ fileType: 'image/png' });
    expect(r.status).toBe(403);
  });
});
