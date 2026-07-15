/**
 * Audit v6 M1: AML screening wiring. resolveScreeningName pulls the natural-
 * person name per entity type; screenEntityAml resolves the name, runs the Didit
 * AML check, and persists amlStatus. These are the pieces the post-KYB/IDV
 * webhook trigger and the backfill script both call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());
const getItemMock = vi.hoisted(() => vi.fn());
const checkAmlMock = vi.hoisted(() => vi.fn());
const ooGetByIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({ docClient: { send: sendMock } }));
vi.mock('../../../src/config/environment', () => ({
  default: { dynamodb: { membershipsTable: 'Memberships', orgsTable: 'Organizations', usersTable: 'Users' } },
}));
vi.mock('../../../src/config/database', () => ({
  Database: { getItem: getItemMock, putItem: vi.fn(), updateItem: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../src/services/integrations/fmcsa', () => ({ checkCarrierAuthority: vi.fn() }));
vi.mock('../../../src/services/integrations/didit', () => ({ createDiditSession: vi.fn(), checkAml: checkAmlMock }));
vi.mock('../../../src/services/driverService', () => ({ DriverService: { getProfileById: vi.fn(), getProfileByUserId: vi.fn(), createProfile: vi.fn() } }));
vi.mock('../../../src/services/ownerOperatorService', () => ({ OwnerOperatorService: { getByUserId: vi.fn(), getById: ooGetByIdMock } }));

import { resolveScreeningName, screenEntityAml, EntityType } from '../../../src/services/verification';

beforeEach(() => {
  sendMock.mockReset();
  getItemMock.mockReset();
  checkAmlMock.mockReset();
  ooGetByIdMock.mockReset();
});

describe('resolveScreeningName (audit v6 M1)', () => {
  it('DRIVER → the User full name', async () => {
    getItemMock.mockResolvedValueOnce({ userId: 'U1', fullName: 'Jane Q Driver' });
    expect(await resolveScreeningName('U1', EntityType.DRIVER)).toBe('Jane Q Driver');
    expect(getItemMock).toHaveBeenCalledWith('Users', { userId: 'U1' });
  });

  it('DRIVER → falls back to firstName + lastName when no fullName', async () => {
    getItemMock.mockResolvedValueOnce({ userId: 'U2', firstName: 'John', lastName: 'Doe' });
    expect(await resolveScreeningName('U2', EntityType.DRIVER)).toBe('John Doe');
  });

  it('OWNER_OPERATOR → the operator legal name', async () => {
    ooGetByIdMock.mockResolvedValueOnce({ operatorId: 'OP1', legalName: 'Acme Hauling LLC' });
    expect(await resolveScreeningName('OP1', EntityType.OWNER_OPERATOR)).toBe('Acme Hauling LLC');
    expect(ooGetByIdMock).toHaveBeenCalledWith('OP1');
  });

  it('ORGANIZATION → the org legal name', async () => {
    getItemMock.mockResolvedValueOnce({ orgId: 'ORG1', legalName: 'Globex Freight Inc' });
    expect(await resolveScreeningName('ORG1', EntityType.ORGANIZATION)).toBe('Globex Freight Inc');
    expect(getItemMock).toHaveBeenCalledWith('Organizations', { orgId: 'ORG1' });
  });

  it('returns null when the record has no usable name', async () => {
    getItemMock.mockResolvedValueOnce({ userId: 'U3' });
    expect(await resolveScreeningName('U3', EntityType.DRIVER)).toBeNull();
  });
});

describe('screenEntityAml (audit v6 M1)', () => {
  it('resolves the name, screens, and persists a pass', async () => {
    ooGetByIdMock.mockResolvedValueOnce({ operatorId: 'OP1', legalName: 'Acme Hauling LLC' });
    checkAmlMock.mockResolvedValueOnce('pass');
    // recomputeAndPersist: GetCommand then PutCommand.
    sendMock
      .mockResolvedValueOnce({ Item: { entityId: 'OP1', entityType: EntityType.OWNER_OPERATOR, docsSubmittedAt: new Date().toISOString(), fmcsaAuthorityActive: true, kybStatus: 'pass' } })
      .mockResolvedValueOnce({});

    const result = await screenEntityAml('OP1', EntityType.OWNER_OPERATOR);

    expect(result).toBe('pass');
    expect(checkAmlMock).toHaveBeenCalledWith('OP1', 'Acme Hauling LLC');
    // The persisted item carries the AML result.
    const putCall = sendMock.mock.calls[1][0];
    expect(putCall.input.Item.amlStatus).toBe('pass');
  });

  it('a Declined screen persists fail (which deriveStatus REJECTs)', async () => {
    getItemMock.mockResolvedValueOnce({ userId: 'U1', fullName: 'Jane Q Driver' });
    checkAmlMock.mockResolvedValueOnce('fail');
    sendMock
      .mockResolvedValueOnce({ Item: { entityId: 'U1', entityType: EntityType.DRIVER, docsSubmittedAt: new Date().toISOString(), idvStatus: 'pass' } })
      .mockResolvedValueOnce({});

    const result = await screenEntityAml('U1', EntityType.DRIVER);
    expect(result).toBe('fail');
    expect(sendMock.mock.calls[1][0].input.Item.amlStatus).toBe('fail');
  });

  it('does NOT call the AML provider when no name resolves', async () => {
    getItemMock.mockResolvedValueOnce({ userId: 'U9' }); // no name
    const result = await screenEntityAml('U9', EntityType.DRIVER);
    expect(result).toBeNull();
    expect(checkAmlMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
