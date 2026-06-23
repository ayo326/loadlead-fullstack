// Phase 1 — Platform-staff role separation + per-route tier checks.
// Proves:
//   1. PlatformRole and OrgRole are distinct TypeScript types (no
//      structural overlap); even though both have a member literally
//      called "MANAGER", the values differ ("STAFF_MANAGER" vs
//      "MANAGER") so a stored OrgRole can never satisfy a PlatformRole
//      check by accident.
//   2. SUPERVISOR + TEAM_LEAD get 403 on destructive endpoints
//      (suspend org, reinstate org, revoke admin).
//   3. STAFF_ADMIN passes.
//   4. STAFF_MANAGER also 403s on destructive endpoints (only ADMIN
//      tier owns those).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const orgServiceMock = vi.hoisted(() => ({
  suspendOrg: vi.fn(async () => undefined),
  reinstateOrg: vi.fn(async () => undefined),
}));
const membershipServiceMock = vi.hoisted(() => ({
  getMembersOfOrg: vi.fn(async () => [] as any[]),
  getMembershipsForUser: vi.fn(async () => [] as any[]),
}));
const auditMock = vi.hoisted(() => ({ log: vi.fn(async () => undefined) }));
const dbMock    = vi.hoisted(() => ({
  getItem: vi.fn(),
  updateItem: vi.fn(async () => undefined),
}));
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
      usersTable: 'LoadLead_Users',
    },
    app: {},
  },
}));

// Inject the tier under test via the JWT (sets req.user.userId so the
// tier middleware can read the user row from the mocked DB).
let CURRENT_TIER: string | null = null;
vi.mock('../../../src/middleware/auth', async () => {
  const actual: any = await vi.importActual('../../../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'staff-1', role: 'ADMIN' };
      next();
    },
    requireAdmin: (_req: any, _res: any, next: any) => next(),
  };
});

import express from 'express';
import request from 'supertest';
import adminRoutes from '../../../src/routes/admin';
import { PlatformRole, ALL_PLATFORM_ROLES, DESTRUCTIVE_TIER, OPS_TIER, READ_TIER }
  from '../../../src/types/platformRole';
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
  // Default: tier reflected by CURRENT_TIER via DB read
  dbMock.getItem.mockImplementation(async () => ({ userId: 'staff-1', platformRole: CURRENT_TIER }));
});

describe('PlatformRole vs OrgRole separation', () => {
  it('PlatformRole values are namespaced with STAFF_ prefix (cannot collide with OrgRole MANAGER)', () => {
    for (const r of ALL_PLATFORM_ROLES) {
      expect(r.startsWith('STAFF_')).toBe(true);
    }
    // OrgRole.MANAGER is a different string value than PlatformRole.STAFF_MANAGER
    expect(OrgRole.MANAGER).toBe('MANAGER');
    expect(PlatformRole.STAFF_MANAGER).toBe('STAFF_MANAGER');
    expect((OrgRole.MANAGER as string)).not.toBe(PlatformRole.STAFF_MANAGER as string);
  });

  it('tier matrices are non-overlapping where the spec says they should be', () => {
    // Destructive: ADMIN only
    expect(DESTRUCTIVE_TIER).toEqual([PlatformRole.STAFF_ADMIN]);
    // Ops includes ADMIN + MANAGER, no read-tier roles
    expect(OPS_TIER).toContain(PlatformRole.STAFF_ADMIN);
    expect(OPS_TIER).toContain(PlatformRole.STAFF_MANAGER);
    expect(OPS_TIER).not.toContain(PlatformRole.STAFF_SUPERVISOR);
    expect(OPS_TIER).not.toContain(PlatformRole.STAFF_TEAM_LEAD);
    // Read tier is supervisor + team_lead exclusively
    expect(READ_TIER).toEqual([PlatformRole.STAFF_SUPERVISOR, PlatformRole.STAFF_TEAM_LEAD]);
  });
});

describe('per-route tier enforcement on destructive admin endpoints', () => {
  const destructiveCases: Array<[string, string, string, any]> = [
    ['suspend org',   'post', '/api/admin/orgs/org-1/suspend',       { reason: 'fraud investigation' }],
    ['reinstate org', 'post', '/api/admin/orgs/org-1/reinstate',     { reason: 'verified - false report' }],
    ['revoke admin',  'post', '/api/admin/users/u-1/revoke-admin',   { reason: 'identity theft confirmed' }],
  ];

  for (const [label, method, url, body] of destructiveCases) {
    it(`${label}: STAFF_ADMIN -> 200`, async () => {
      CURRENT_TIER = PlatformRole.STAFF_ADMIN;
      const r = await (request(app()) as any)[method](url).send(body);
      expect(r.status).toBe(200);
    });

    it(`${label}: STAFF_MANAGER -> 403`, async () => {
      CURRENT_TIER = PlatformRole.STAFF_MANAGER;
      const r = await (request(app()) as any)[method](url).send(body);
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/insufficient platform tier/i);
    });

    it(`${label}: STAFF_SUPERVISOR -> 403`, async () => {
      CURRENT_TIER = PlatformRole.STAFF_SUPERVISOR;
      const r = await (request(app()) as any)[method](url).send(body);
      expect(r.status).toBe(403);
    });

    it(`${label}: STAFF_TEAM_LEAD -> 403`, async () => {
      CURRENT_TIER = PlatformRole.STAFF_TEAM_LEAD;
      const r = await (request(app()) as any)[method](url).send(body);
      expect(r.status).toBe(403);
    });
  }

  it('legacy admin row with no platformRole resolves to STAFF_ADMIN (back-compat)', async () => {
    CURRENT_TIER = null;
    const r = await request(app()).post('/api/admin/orgs/org-1/suspend').send({ reason: 'lookup test' });
    expect(r.status).toBe(200);
  });
});
