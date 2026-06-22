// Platform override APIs — LoadLead_Admin_Carrier_IAM_Spec.md §5.
//
// Lightweight unit tests for the route-layer guards (reason required,
// sole-owner protection). Full integration with DynamoDB is covered by
// the existing prod smoke; here we only exercise the route logic in
// isolation via mocked services.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const orgServiceMock = vi.hoisted(() => ({
  suspendOrg: vi.fn(async () => undefined),
  reinstateOrg: vi.fn(async () => undefined),
  getMembersOfOrg: vi.fn(async () => [] as any[]),
}));

const membershipServiceMock = vi.hoisted(() => ({
  getMembersOfOrg: vi.fn(async () => [] as any[]),
  getMembershipsForUser: vi.fn(async () => [] as any[]),
}));

const auditMock = vi.hoisted(() => ({ log: vi.fn(async () => undefined) }));
const dbMock    = vi.hoisted(() => ({ updateItem: vi.fn(async () => undefined) }));
const sendMock  = vi.hoisted(() => vi.fn(async () => ({ Items: [], LastEvaluatedKey: undefined })));

vi.mock('../../../src/services/orgService', () => ({
  OrgService: orgServiceMock,
  OrgMembershipService: membershipServiceMock,
  OrgAuditService: auditMock,
}));

vi.mock('../../../src/config/database', () => ({ Database: dbMock }));
vi.mock('../../../src/config/aws', () => ({ docClient: { send: sendMock } }));
vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      orgsTable: 'LoadLead_Organizations',
      membershipsTable: 'LoadLead_Memberships',
    },
    app: {},
  },
}));

// Bypass real auth so we can simulate an ADMIN actor.
vi.mock('../../../src/middleware/auth', async () => {
  const actual: any = await vi.importActual('../../../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'admin-1', role: 'ADMIN' };
      next();
    },
    requireAdmin: (_req: any, _res: any, next: any) => next(),
  };
});

import express from 'express';
import request from 'supertest';
import adminRoutes from '../../../src/routes/admin';
import { OrgRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin', adminRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode ?? 500).json({ error: err?.message ?? 'error' });
  });
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform override endpoints (LL-AC-004 §5)', () => {
  it('rejects suspend without a reason', async () => {
    const r = await request(app()).post('/api/admin/orgs/org-1/suspend').send({});
    expect(r.status).toBe(400);
    expect(orgServiceMock.suspendOrg).not.toHaveBeenCalled();
  });

  it('accepts suspend with a 6+ char reason', async () => {
    const r = await request(app()).post('/api/admin/orgs/org-1/suspend')
      .send({ reason: 'fraud investigation' });
    expect(r.status).toBe(200);
    expect(orgServiceMock.suspendOrg).toHaveBeenCalledWith('org-1', 'admin-1', 'fraud investigation');
  });

  it('accepts reinstate with a reason and audit-logs it', async () => {
    const r = await request(app()).post('/api/admin/orgs/org-1/reinstate')
      .send({ reason: 'verified - false report' });
    expect(r.status).toBe(200);
    expect(orgServiceMock.reinstateOrg).toHaveBeenCalledWith('org-1', 'admin-1');
    expect(auditMock.log).toHaveBeenCalled();
  });

  describe('revoke-admin', () => {
    it('suspends the org when the target is the sole OWNER', async () => {
      membershipServiceMock.getMembershipsForUser.mockResolvedValueOnce([
        { orgId: 'org-x', userId: 'user-1', orgRole: OrgRole.OWNER, status: 'ACTIVE' },
      ]);
      membershipServiceMock.getMembersOfOrg.mockResolvedValueOnce([
        { orgId: 'org-x', userId: 'user-1', orgRole: OrgRole.OWNER, status: 'ACTIVE' },
      ]);

      const r = await request(app()).post('/api/admin/users/user-1/revoke-admin')
        .send({ reason: 'identity theft confirmed' });

      expect(r.status).toBe(200);
      expect(r.body.suspendedOrgs).toEqual(['org-x']);
      expect(orgServiceMock.suspendOrg).toHaveBeenCalledWith('org-x', 'admin-1', expect.stringContaining('Admin revoke'));
      // Demoted on the membership too
      expect(dbMock.updateItem).toHaveBeenCalled();
    });

    it('does NOT suspend the org if another OWNER remains', async () => {
      membershipServiceMock.getMembershipsForUser.mockResolvedValueOnce([
        { orgId: 'org-y', userId: 'user-2', orgRole: OrgRole.OWNER, status: 'ACTIVE' },
      ]);
      membershipServiceMock.getMembersOfOrg.mockResolvedValueOnce([
        { orgId: 'org-y', userId: 'user-2', orgRole: OrgRole.OWNER, status: 'ACTIVE' },
        { orgId: 'org-y', userId: 'user-3', orgRole: OrgRole.OWNER, status: 'ACTIVE' },
      ]);

      const r = await request(app()).post('/api/admin/users/user-2/revoke-admin')
        .send({ reason: 'rotation' });

      expect(r.status).toBe(200);
      expect(r.body.suspendedOrgs).toEqual([]);
      expect(orgServiceMock.suspendOrg).not.toHaveBeenCalled();
      // The user is still demoted to ORG_DRIVER on their membership
      expect(dbMock.updateItem).toHaveBeenCalled();
    });
  });
});
