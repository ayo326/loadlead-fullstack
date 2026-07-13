/**
 * Factoring route-level coverage: express -> authenticate -> resolveCarrierId ->
 * service, with real middleware and signed tokens. Proves at the HTTP layer:
 *   - auth gating (401) and no-carrier rejection (404)
 *   - OO and fleet-carrier org managers both resolve (the payee extension e2e)
 *   - the invoice package endpoint returns real resolved facts
 *   - the export flow: 422 when the packet is missing documents, 400 without a
 *     recipient, review-not-send without confirmed:true, 201 submit on confirm
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  // carrier resolution
  getByUserId: vi.fn(async (): Promise<any> => null),
  getMembershipsForUser: vi.fn(async (): Promise<any[]> => []),
  getOrgById: vi.fn(async (): Promise<any> => null),
  // package facts
  getLoadById: vi.fn(async (): Promise<any> => ({ loadId: 'load-1', shipperId: 'ship-1', rateType: 'FLAT', rateAmount: 1000 })),
  computeLinehaulSettlement: vi.fn(async () => ({ carrierNetCents: 100000 })),
  listForLoad: vi.fn(async (): Promise<any[]> => []),
  getActiveAssignment: vi.fn(async (): Promise<any> => null),
  getChain: vi.fn(async (): Promise<any[]> => [{ action: 'DRIVER_DELIVER', signatureId: 'sig-1', signedAt: new Date().toISOString() }]),
  getVerification: vi.fn(async (): Promise<any> => ({ verificationStatus: 'VERIFIED' })),
  getProfileById: vi.fn(async (): Promise<any> => ({ shipperId: 'ship-1', userId: 'user-ship' })),
  listAcceptances: vi.fn(async (): Promise<any[]> => [{ acceptanceId: 'apaccept_1' }]),
  listShipperAgreements: vi.fn(async (): Promise<any[]> => []),
  getItem: vi.fn(async (): Promise<any> => ({ userId: 'user-ship', status: 'ACTIVE' })),
  // profile + export chain
  getFactoringProfile: vi.fn(async (): Promise<any> => ({ carrierId: 'x', mode: 'BYO' })),
  listStopEvents: vi.fn(async (): Promise<any[]> => []),
  assemble: vi.fn(async (): Promise<any> => ({ ok: true, manifest: { items: [] }, pdf: Buffer.from('pdf') })),
  resolveRecipient: vi.fn(async (): Promise<any> => 'factor@example.com'),
  submit: vi.fn(async (): Promise<any> => ({ submissionId: 'sub_1' })),
  getForAssignment: vi.fn(async (): Promise<any> => null),
  resolveLoadCarrierId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock('../../../src/services/ownerOperatorService', () => ({ OwnerOperatorService: { getByUserId: m.getByUserId } }));
vi.mock('../../../src/services/orgService', () => ({
  OrgService: { getOrgById: m.getOrgById },
  OrgMembershipService: { getMembershipsForUser: m.getMembershipsForUser },
}));
vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById: m.getLoadById } }));
vi.mock('../../../src/services/platformFeeService', () => ({ PlatformFeeService: { computeLinehaulSettlement: m.computeLinehaulSettlement } }));
vi.mock('../../../src/services/accessorialChargeService', () => ({ AccessorialChargeService: { listForLoad: m.listForLoad } }));
vi.mock('../../../src/services/factoringAssignmentService', () => ({ FactoringAssignmentService: { getActiveAssignment: m.getActiveAssignment, create: vi.fn(), listForCarrier: vi.fn(async () => []) } }));
vi.mock('../../../src/services/attestation/signatureService', () => ({ getChain: m.getChain }));
vi.mock('../../../src/services/verification', () => ({ getVerification: m.getVerification }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: { getProfileById: m.getProfileById } }));
vi.mock('../../../src/services/accessorialPolicyService', () => ({
  AccessorialPolicyService: { listAcceptances: m.listAcceptances, listShipperAgreements: m.listShipperAgreements },
}));
vi.mock('../../../src/config/database', () => ({
  Database: { getItem: m.getItem, putItem: vi.fn(), scan: vi.fn(async () => []), deleteItem: vi.fn(), updateItem: vi.fn() },
}));
vi.mock('../../../src/services/factoringProfile', () => ({
  getFactoringProfile: m.getFactoringProfile,
  registerByoFactor: vi.fn(), verifyByoFactor: vi.fn(), confirmByoRemittance: vi.fn(),
  byoReady: vi.fn(async () => true), selectIntegratedPartner: vi.fn(), releaseCurrentFactor: vi.fn(),
}));
vi.mock('../../../src/services/stopEventService', () => ({ StopEventService: { list: m.listStopEvents } }));
vi.mock('../../../src/services/factoringPacketService', () => ({ FactoringPacketService: { assemble: m.assemble } }));
vi.mock('../../../src/services/factoringSubmissionService', () => ({
  FactoringSubmissionService: { resolveRecipient: m.resolveRecipient, submit: m.submit, listForCarrier: vi.fn(async () => []) },
}));
vi.mock('../../../src/services/noticeOfAssignmentService', () => ({ NoticeOfAssignmentService: { getForAssignment: m.getForAssignment } }));
vi.mock('../../../src/services/factorContactService', () => ({ FactorContactService: { get: vi.fn(async () => null), save: vi.fn() } }));
vi.mock('../../../src/services/payeeRoutingService', () => ({ PayeeRoutingService: { resolvePayee: vi.fn(async () => ({ type: 'CARRIER' })) } }));
vi.mock('../../../src/services/factoring', () => ({ optInToFactoring: vi.fn(), resolveInvoicePayee: vi.fn(), resolveLoadCarrierId: m.resolveLoadCarrierId }));
vi.mock('../../../src/services/pod', () => ({ assertPodComplete: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import factoringRoutes from '../../../src/routes/factoring';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole, OrgRole, OrgCapability } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/factoring', factoringRoutes);
  return a;
}
const ooToken = Helpers.generateToken({ userId: 'oo-user', email: 'oo@x.test', role: UserRole.OWNER_OPERATOR });
const mgrToken = Helpers.generateToken({ userId: 'mgr-user', email: 'mgr@x.test', role: UserRole.DRIVER });
const strayToken = Helpers.generateToken({ userId: 'stray', email: 'n@x.test', role: UserRole.RECEIVER });

const asOO = () => m.getByUserId.mockImplementation(async (uid: string) => (uid === 'oo-user' ? { operatorId: 'oo-9' } : null));
const asOrgManager = () => {
  m.getMembershipsForUser.mockImplementation(async (uid: string) =>
    uid === 'mgr-user' ? [{ membershipId: 'm1', orgId: 'org-1', userId: uid, orgRole: OrgRole.MANAGER, status: 'ACTIVE' }] : []
  );
  m.getOrgById.mockResolvedValue({ orgId: 'org-1', capabilities: [OrgCapability.CARRIER] });
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getByUserId.mockResolvedValue(null);
  m.getMembershipsForUser.mockResolvedValue([]);
  m.getOrgById.mockResolvedValue(null);
  m.getLoadById.mockResolvedValue({ loadId: 'load-1', shipperId: 'ship-1', rateType: 'FLAT', rateAmount: 1000 });
  m.computeLinehaulSettlement.mockResolvedValue({ carrierNetCents: 100000 });
  m.listForLoad.mockResolvedValue([]);
  m.getActiveAssignment.mockResolvedValue(null);
  m.getChain.mockResolvedValue([{ action: 'DRIVER_DELIVER', signatureId: 'sig-1', signedAt: new Date().toISOString() }]);
  m.getVerification.mockResolvedValue({ verificationStatus: 'VERIFIED' });
  m.getProfileById.mockResolvedValue({ shipperId: 'ship-1', userId: 'user-ship' });
  m.listAcceptances.mockResolvedValue([{ acceptanceId: 'apaccept_1' }]);
  m.listShipperAgreements.mockResolvedValue([]);
  m.getItem.mockResolvedValue({ userId: 'user-ship', status: 'ACTIVE' });
  m.getFactoringProfile.mockResolvedValue({ carrierId: 'x', mode: 'BYO' });
  m.listStopEvents.mockResolvedValue([]);
  m.assemble.mockResolvedValue({ ok: true, manifest: { items: [] }, pdf: Buffer.from('pdf') });
  m.resolveRecipient.mockResolvedValue('factor@example.com');
  m.submit.mockResolvedValue({ submissionId: 'sub_1' });
  m.getForAssignment.mockResolvedValue(null);
});

describe('factoring routes: auth + carrier resolution at the HTTP layer', () => {
  it('401 unauthenticated', async () => {
    const r = await request(app()).get('/api/factoring/profile');
    expect(r.status).toBe(401);
  });

  it('404 for an authenticated user with no carrier to act for', async () => {
    const r = await request(app()).get('/api/factoring/profile').set('Authorization', `Bearer ${strayToken}`);
    expect(r.status).toBe(404);
  });

  it('200 for an owner operator (resolves operatorId)', async () => {
    asOO();
    const r = await request(app()).get('/api/factoring/profile').set('Authorization', `Bearer ${ooToken}`);
    expect(r.status).toBe(200);
    expect(m.getFactoringProfile).toHaveBeenCalledWith('oo-9');
  });

  it('200 for a fleet-carrier org MANAGER (resolves orgId) — payee extension e2e', async () => {
    asOrgManager();
    const r = await request(app()).get('/api/factoring/profile').set('Authorization', `Bearer ${mgrToken}`);
    expect(r.status).toBe(200);
    expect(m.getFactoringProfile).toHaveBeenCalledWith('org-1');
  });
});

describe('factoring routes: invoice package facts over HTTP', () => {
  it('returns the package with real resolved facts (verified, real rateConfRef)', async () => {
    asOO();
    const r = await request(app()).get('/api/factoring/invoices/load-1/package').set('Authorization', `Bearer ${ooToken}`);
    expect(r.status).toBe(200);
    expect(r.body.package.mover.verified).toBe(true);
    expect(r.body.package.rateConfRef).toBe('apaccept_1');
    expect(JSON.stringify(r.body)).not.toContain('rateconf:');
  });

  it('reports honest non-factorable reasons when the mover is unverified', async () => {
    asOO();
    m.getVerification.mockResolvedValue(null);
    const r = await request(app()).get('/api/factoring/invoices/load-1/package').set('Authorization', `Bearer ${ooToken}`);
    expect(r.status).toBe(200);
    const linehaul = r.body.package.lines.find((l: any) => l.kind === 'LINEHAUL');
    expect(linehaul.factorable).toBe(false);
    expect(linehaul.reason).toContain('mover not verified');
  });
});

describe('factoring routes: export flow', () => {
  const exportReq = (body: any, token = ooToken) =>
    request(app()).post('/api/factoring/export').set('Authorization', `Bearer ${token}`).send(body);

  it('422 with the missing list when the packet is incomplete', async () => {
    asOO();
    m.assemble.mockResolvedValue({ ok: false, missing: ['rate confirmation'] });
    const r = await exportReq({ invoiceId: 'load-1' });
    expect(r.status).toBe(422);
    expect(r.body.missing).toContain('rate confirmation');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('400 when no recipient can be resolved', async () => {
    asOO();
    m.resolveRecipient.mockResolvedValue(null);
    const r = await exportReq({ invoiceId: 'load-1' });
    expect(r.status).toBe(400);
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('without confirmed:true returns the review manifest and sends NOTHING', async () => {
    asOO();
    const r = await exportReq({ invoiceId: 'load-1' });
    expect(r.status).toBe(200);
    expect(r.body.requiresConfirmation).toBe(true);
    expect(r.body.recipient).toBe('factor@example.com');
    expect(m.submit).not.toHaveBeenCalled();
  });

  it('confirmed:true submits once and records the submission (201)', async () => {
    asOO();
    const r = await exportReq({ invoiceId: 'load-1', confirmed: true });
    expect(r.status).toBe(201);
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect(m.submit.mock.calls[0][0]).toMatchObject({ carrierId: 'oo-9', confirmed: true, recipientEmail: 'factor@example.com' });
  });

  it('the packet assembler receives the REAL rateConfRef, never a synthetic one', async () => {
    asOO();
    await exportReq({ invoiceId: 'load-1' });
    expect(m.assemble).toHaveBeenCalledTimes(1);
    expect(m.assemble.mock.calls[0][0].rateConfRef).toBe('apaccept_1');
  });

  it('omits rateConfRef entirely when no agreed-terms record exists', async () => {
    asOO();
    m.listAcceptances.mockResolvedValue([]);
    m.listShipperAgreements.mockResolvedValue([]);
    await exportReq({ invoiceId: 'load-1' });
    expect(m.assemble.mock.calls[0][0].rateConfRef).toBeUndefined();
  });
});

// Audit v5 SEC-3 / SEC-8: a load-scoped factoring action must be authorized -
// the caller's carrier must be the load's carrier-of-record.
describe('load-scoped factoring ownership (SEC-3 / SEC-8)', () => {
  const optIn = (loadId: string, token: string) =>
    request(app()).post(`/api/factoring/loads/${loadId}/opt-in`).set('Authorization', `Bearer ${token}`).send({});

  it('403 when the caller is NOT the load\'s carrier-of-record (bypass blocked)', async () => {
    asOO(); // caller resolves to operatorId oo-9
    m.resolveLoadCarrierId.mockResolvedValue('some-other-carrier');
    const res = await optIn('load-1', ooToken);
    expect(res.status).toBe(403);
  });

  it('403 when the load has no resolvable carrier', async () => {
    asOO();
    m.resolveLoadCarrierId.mockResolvedValue(null);
    const res = await optIn('load-1', ooToken);
    expect(res.status).toBe(403);
  });

  it('proceeds (201) when the caller IS the load\'s carrier-of-record', async () => {
    asOO();
    m.resolveLoadCarrierId.mockResolvedValue('oo-9'); // matches the caller
    const res = await optIn('load-1', ooToken);
    expect(res.status).toBe(201);
  });
});
