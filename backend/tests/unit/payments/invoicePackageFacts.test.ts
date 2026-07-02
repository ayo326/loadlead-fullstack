/**
 * Invoice-package fact resolution (routes/factoring.ts buildPackageForInvoice):
 * the caveats are gone — verification, debtor standing, terms aging, and the
 * rate-confirmation reference are resolved from real records, never assumed.
 *
 *   mover.verified  <- Verifications table (VERIFIED only)
 *   debtor.verified <- shipper profile exists + user account not suspended
 *   withinTerms     <- delivery attested within the 90-day aging window
 *   rateConfRef     <- carrier policy acceptance, else shipper agreement,
 *                      else OMITTED (no synthetic rateconf:<loadId>)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getLoadById: vi.fn(async (): Promise<any> => ({ loadId: 'load-1', shipperId: 'ship-1', rateType: 'FLAT', rateAmount: 1000 })),
  computeLinehaulSettlement: vi.fn(async () => ({ carrierNetCents: 100000 })),
  listForLoad: vi.fn(async (): Promise<any[]> => []),
  getActiveAssignment: vi.fn(async (): Promise<any> => null),
  getChain: vi.fn(async (): Promise<any[]> => [{ action: 'DRIVER_DELIVER', signatureId: 'sig-1', signedAt: new Date().toISOString() }]),
  getVerification: vi.fn(async (): Promise<any> => ({ entityId: 'carrier-1', verificationStatus: 'VERIFIED' })),
  getProfileById: vi.fn(async (): Promise<any> => ({ shipperId: 'ship-1', userId: 'user-ship' })),
  listAcceptances: vi.fn(async (): Promise<any[]> => []),
  listShipperAgreements: vi.fn(async (): Promise<any[]> => []),
  getItem: vi.fn(async (): Promise<any> => ({ userId: 'user-ship', status: 'ACTIVE' })),
}));

vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById: m.getLoadById } }));
vi.mock('../../../src/services/platformFeeService', () => ({ PlatformFeeService: { computeLinehaulSettlement: m.computeLinehaulSettlement } }));
vi.mock('../../../src/services/accessorialChargeService', () => ({ AccessorialChargeService: { listForLoad: m.listForLoad } }));
vi.mock('../../../src/services/factoringAssignmentService', () => ({ FactoringAssignmentService: { getActiveAssignment: m.getActiveAssignment } }));
vi.mock('../../../src/services/attestation/signatureService', () => ({ getChain: m.getChain }));
vi.mock('../../../src/services/verification', () => ({ getVerification: m.getVerification }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: { getProfileById: m.getProfileById } }));
vi.mock('../../../src/services/accessorialPolicyService', () => ({
  AccessorialPolicyService: { listAcceptances: m.listAcceptances, listShipperAgreements: m.listShipperAgreements },
}));
vi.mock('../../../src/config/database', () => ({
  Database: { getItem: m.getItem, putItem: vi.fn(), scan: vi.fn(async () => []), deleteItem: vi.fn(), updateItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildPackageForInvoice } from '../../../src/routes/factoring';

const linehaul = (pkg: any) => pkg.lines.find((l: any) => l.kind === 'LINEHAUL');

beforeEach(() => {
  vi.clearAllMocks();
  m.getLoadById.mockResolvedValue({ loadId: 'load-1', shipperId: 'ship-1', rateType: 'FLAT', rateAmount: 1000 });
  m.computeLinehaulSettlement.mockResolvedValue({ carrierNetCents: 100000 });
  m.listForLoad.mockResolvedValue([]);
  m.getActiveAssignment.mockResolvedValue(null);
  m.getChain.mockResolvedValue([{ action: 'DRIVER_DELIVER', signatureId: 'sig-1', signedAt: new Date().toISOString() }]);
  m.getVerification.mockResolvedValue({ entityId: 'carrier-1', verificationStatus: 'VERIFIED' });
  m.getProfileById.mockResolvedValue({ shipperId: 'ship-1', userId: 'user-ship' });
  m.listAcceptances.mockResolvedValue([]);
  m.listShipperAgreements.mockResolvedValue([]);
  m.getItem.mockResolvedValue({ userId: 'user-ship', status: 'ACTIVE' });
});

describe('invoice package fact resolution', () => {
  it('happy path: verified mover + active shipper + fresh delivery => linehaul factorable', async () => {
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.mover.verified).toBe(true);
    expect(pkg.debtor.verified).toBe(true);
    expect(linehaul(pkg).factorable).toBe(true);
  });

  it('unverified mover => not factorable with the real reason', async () => {
    m.getVerification.mockResolvedValue({ entityId: 'carrier-1', verificationStatus: 'PENDING' });
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.mover.verified).toBe(false);
    expect(linehaul(pkg).reason).toContain('mover not verified');
  });

  it('no verification record at all => mover not verified', async () => {
    m.getVerification.mockResolvedValue(null);
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.mover.verified).toBe(false);
  });

  it('suspended shipper account => debtor not verified', async () => {
    m.getItem.mockResolvedValue({ userId: 'user-ship', status: 'SUSPENDED' });
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.debtor.verified).toBe(false);
    expect(linehaul(pkg).reason).toContain('debtor not verified');
  });

  it('missing shipper profile => debtor not verified', async () => {
    m.getProfileById.mockResolvedValue(null);
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.debtor.verified).toBe(false);
  });

  it('legacy shipper user with no status field counts as good standing', async () => {
    m.getItem.mockResolvedValue({ userId: 'user-ship' });
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.debtor.verified).toBe(true);
  });

  it('delivery older than 90 days => outside terms', async () => {
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    m.getChain.mockResolvedValue([{ action: 'DRIVER_DELIVER', signatureId: 'sig-1', signedAt: old }]);
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(linehaul(pkg).reason).toContain('outside terms');
  });

  it('rateConfRef prefers the carrier acceptance, falls back to the shipper agreement', async () => {
    m.listAcceptances.mockResolvedValue([{ acceptanceId: 'apaccept_1' }]);
    m.listShipperAgreements.mockResolvedValue([{ agreementId: 'shipagree_1' }]);
    const withBoth = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(withBoth.pkg.rateConfRef).toBe('apaccept_1');

    m.listAcceptances.mockResolvedValue([]);
    const withAgreement = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(withAgreement.pkg.rateConfRef).toBe('shipagree_1');
  });

  it('no agreed-terms record => rateConfRef omitted, never synthetic', async () => {
    const { pkg } = await buildPackageForInvoice('load-1', 'carrier-1');
    expect(pkg.rateConfRef).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toContain('rateconf:');
  });
});
