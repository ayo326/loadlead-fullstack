import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgCapability, UserRole } from '../../../src/types';

vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      membershipsTable: 'Memberships',
      orgsTable: 'Organizations',
    },
    jwt: { secret: 'test' },
  },
}));

const getMembershipMock = vi.hoisted(() => vi.fn());
const getOrgByIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/orgService', () => ({
  OrgMembershipService: { getMembership: getMembershipMock },
  OrgService: { getOrgById: getOrgByIdMock },
}));

import { requireOrgCapability } from '../../../src/middleware/auth';

function mockReqRes(role: UserRole, orgId: string) {
  const req: any = { user: { userId: 'U1', email: 't@t.com', role }, params: { orgId } };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  getMembershipMock.mockReset();
  getOrgByIdMock.mockReset();
});

describe('requireOrgCapability middleware', () => {
  it('[C9] CARRIER-only org blocked from SHIPPER capability route', async () => {
    const { req, res, next } = mockReqRes(UserRole.CARRIER_ADMIN, 'ORG1');
    getMembershipMock.mockResolvedValueOnce({ status: 'ACTIVE' });
    getOrgByIdMock.mockResolvedValueOnce({ capabilities: [OrgCapability.CARRIER] });

    const mw = requireOrgCapability(OrgCapability.SHIPPER);
    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('[C10] SHIPPER-only org blocked from CARRIER capability route', async () => {
    const { req, res, next } = mockReqRes(UserRole.SHIPPER, 'ORG2');
    getMembershipMock.mockResolvedValueOnce({ status: 'ACTIVE' });
    getOrgByIdMock.mockResolvedValueOnce({ capabilities: [OrgCapability.SHIPPER] });

    const mw = requireOrgCapability(OrgCapability.CARRIER);
    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('matching capability → next()', async () => {
    const { req, res, next } = mockReqRes(UserRole.CARRIER_ADMIN, 'ORG3');
    getMembershipMock.mockResolvedValueOnce({ status: 'ACTIVE' });
    getOrgByIdMock.mockResolvedValueOnce({ capabilities: [OrgCapability.CARRIER] });

    const mw = requireOrgCapability(OrgCapability.CARRIER);
    await mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('ADMIN bypasses capability check', async () => {
    const { req, res, next } = mockReqRes(UserRole.ADMIN, 'ORG4');

    const mw = requireOrgCapability(OrgCapability.CARRIER);
    await mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getMembershipMock).not.toHaveBeenCalled();
  });
});
