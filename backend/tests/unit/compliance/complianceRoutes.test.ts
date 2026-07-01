/**
 * Compliance route gating: least privilege + separation are wired. A DISPUTE_ADMIN
 * cannot reach a law-enforcement surface; the right grant passes. Real middleware +
 * signed tokens; services mocked so gating is what is under test.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { hasRole, intake } = vi.hoisted(() => ({
  hasRole: vi.fn(async (_userId: string, _role: string) => false),
  intake: vi.fn(async (input: any) => ({ requestId: 'lereq_1', ...input })),
}));
vi.mock('../../../src/services/complianceRoleService', () => ({
  ComplianceRoleService: { hasRole, grant: vi.fn(), revoke: vi.fn(), getRoles: vi.fn(async () => []) },
}));
vi.mock('../../../src/services/lawEnforcementService', () => ({
  LawEnforcementService: { intake },
  LE_REQUEST_TYPES: ['SUBPOENA', 'COURT_ORDER', 'WARRANT', 'GARNISHMENT', 'LEVY', 'LIEN', 'OTHER'],
}));
vi.mock('../../../src/services/adminAuditService', () => ({
  AdminAuditService: { record: vi.fn(), withAudit: vi.fn(async (_i: any, fn: any) => fn()), list: vi.fn(async () => []) },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import adminComplianceRoutes from '../../../src/routes/adminCompliance';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';
import { ComplianceRole } from '../../../src/types/complianceRole';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/compliance', adminComplianceRoutes);
  return a;
}
const adminToken = Helpers.generateToken({ userId: 'admin-1', email: 'a@x.test', role: UserRole.ADMIN });
const shipperToken = Helpers.generateToken({ userId: 'ship-1', email: 's@x.test', role: UserRole.SHIPPER });
const intakeBody = { type: 'SUBPOENA', issuingAuthority: 'Court', receivedDate: '2026-07-01', describedScope: 'scope', scopeEntities: [{ entityType: 'LOAD', entityId: 'load-1' }] };

describe('compliance route gating', () => {
  it('401 unauthenticated', async () => {
    const r = await request(app()).post('/api/admin/compliance/le/requests').send(intakeBody);
    expect(r.status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    const r = await request(app()).post('/api/admin/compliance/le/requests').set('Authorization', `Bearer ${shipperToken}`).send(intakeBody);
    expect(r.status).toBe(403);
  });

  it('403 when the admin holds only DISPUTE_ADMIN (separation)', async () => {
    hasRole.mockImplementation(async (_u, role) => role === ComplianceRole.DISPUTE_ADMIN);
    const r = await request(app()).post('/api/admin/compliance/le/requests').set('Authorization', `Bearer ${adminToken}`).send(intakeBody);
    expect(r.status).toBe(403);
    expect(intake).not.toHaveBeenCalled();
  });

  it('201 when the admin holds LAW_ENFORCEMENT_LIAISON', async () => {
    hasRole.mockImplementation(async (_u, role) => role === ComplianceRole.LAW_ENFORCEMENT_LIAISON);
    const r = await request(app()).post('/api/admin/compliance/le/requests').set('Authorization', `Bearer ${adminToken}`).send(intakeBody);
    expect(r.status).toBe(201);
    expect(intake).toHaveBeenCalled();
  });
});
