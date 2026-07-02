/**
 * Compliance /me and grant-management gating at the HTTP layer.
 *   /me     — any ADMIN gets their own roles + tier; non-admin 403; grants nothing.
 *   /grants — STAFF_ADMIN tier only (fresh DB read, never the JWT): a lower-tier
 *             admin is 403 even though they are an ADMIN; STAFF_ADMIN passes and
 *             the grant is audited-then-written.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  getRoles: vi.fn(async (): Promise<string[]> => []),
  hasRole: vi.fn(async () => false),
  grant: vi.fn(async (): Promise<any> => ({ userId: 'target-1', roles: ['DISPUTE_ADMIN'] })),
  record: vi.fn(async (): Promise<any> => undefined),
  getItem: vi.fn(async (): Promise<any> => null),
}));
vi.mock('../../../src/services/complianceRoleService', () => ({
  ComplianceRoleService: { getRoles: m.getRoles, hasRole: m.hasRole, grant: m.grant, revoke: vi.fn() },
}));
vi.mock('../../../src/services/adminAuditService', () => ({
  AdminAuditService: { record: m.record, withAudit: vi.fn(async (_i: any, fn: any) => fn()), list: vi.fn(async () => []) },
}));
vi.mock('../../../src/config/database', () => ({
  Database: { getItem: m.getItem, putItem: vi.fn(), scan: vi.fn(async () => []), deleteItem: vi.fn(), updateItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import adminComplianceRoutes from '../../../src/routes/adminCompliance';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/compliance', adminComplianceRoutes);
  return a;
}
const adminToken = Helpers.generateToken({ userId: 'admin-1', email: 'a@x.test', role: UserRole.ADMIN });
const driverToken = Helpers.generateToken({ userId: 'drv-1', email: 'd@x.test', role: UserRole.DRIVER });

beforeEach(() => {
  vi.clearAllMocks();
  m.getRoles.mockResolvedValue([]);
  m.getItem.mockResolvedValue(null);
});

describe('GET /compliance/me', () => {
  it('403 for a non-admin', async () => {
    const r = await request(app()).get('/api/admin/compliance/me').set('Authorization', `Bearer ${driverToken}`);
    expect(r.status).toBe(403);
  });

  it('returns the caller roles + tier for an admin', async () => {
    m.getRoles.mockResolvedValue(['LEGAL_ADMIN']);
    m.getItem.mockResolvedValue({ userId: 'admin-1', platformRole: 'STAFF_ADMIN' });
    const r = await request(app()).get('/api/admin/compliance/me').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.complianceRoles).toEqual(['LEGAL_ADMIN']);
    expect(r.body.isStaffAdmin).toBe(true);
  });

  it('an admin with no grants gets an empty roles list (me grants nothing)', async () => {
    m.getItem.mockResolvedValue({ userId: 'admin-1', platformRole: 'STAFF_TEAM_LEAD' });
    const r = await request(app()).get('/api/admin/compliance/me').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.complianceRoles).toEqual([]);
    expect(r.body.isStaffAdmin).toBe(false);
  });
});

describe('POST /compliance/grants (STAFF_ADMIN tier only)', () => {
  const grantBody = { userId: 'target-1', role: 'DISPUTE_ADMIN' };

  it('403 for an admin below STAFF_ADMIN tier (fresh DB read decides, not the JWT)', async () => {
    m.getItem.mockResolvedValue({ userId: 'admin-1', platformRole: 'STAFF_TEAM_LEAD' });
    const r = await request(app()).post('/api/admin/compliance/grants').set('Authorization', `Bearer ${adminToken}`).send(grantBody);
    expect(r.status).toBe(403);
    expect(m.grant).not.toHaveBeenCalled();
  });

  it('201 for a STAFF_ADMIN, and the grant is audited', async () => {
    m.getItem.mockResolvedValue({ userId: 'admin-1', platformRole: 'STAFF_ADMIN' });
    const r = await request(app()).post('/api/admin/compliance/grants').set('Authorization', `Bearer ${adminToken}`).send(grantBody);
    expect(r.status).toBe(201);
    expect(m.record).toHaveBeenCalled();
    expect(m.grant).toHaveBeenCalledWith('admin-1', 'target-1', 'DISPUTE_ADMIN');
  });

  it('400 for an invalid role value', async () => {
    m.getItem.mockResolvedValue({ userId: 'admin-1', platformRole: 'STAFF_ADMIN' });
    const r = await request(app()).post('/api/admin/compliance/grants').set('Authorization', `Bearer ${adminToken}`).send({ userId: 'target-1', role: 'SUPER_GOD' });
    expect(r.status).toBe(400);
    expect(m.grant).not.toHaveBeenCalled();
  });
});
