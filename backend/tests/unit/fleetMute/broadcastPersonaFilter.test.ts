/**
 * Broadcast/matching pool persona filter.
 *
 * The pool is DRIVERS. isFleetCarrierDriver() is the primitive that decides
 * whether a driver hauls under the fleet-carrier persona (carrier of record
 * is a CARRIER-capability org). The broadcast service applies it, gated by the
 * flag, to drop fleet carriers from the pool while muted - so a muted pool
 * selects only owner-operator (and unaffiliated) drivers, and an enabled pool
 * keeps everyone. This proves the selection primitive; it never classifies an
 * owner-operator as fleet, which is why OO flows are identical either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, aFleetDriver, aMembership, anOrg } from '../../fixtures/factories';
import { OrgCapability } from '../../../src/types';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({ docClient: { send: sendMock } }));
vi.mock('../../../src/config/environment', () => ({
  default: { dynamodb: { membershipsTable: 'Memberships', orgsTable: 'Organizations' } },
}));

import { isFleetCarrierDriver } from '../../../src/services/carrierOfRecord';

beforeEach(() => { sendMock.mockReset(); });

describe('isFleetCarrierDriver (pool selection primitive)', () => {
  it('an owner-operator fleet driver is NOT a fleet carrier (no DB read)', async () => {
    const driver = aFleetDriver('OP1'); // ownedByOperatorId set
    expect(await isFleetCarrierDriver(driver)).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('an owner-operator self-driver is NOT a fleet carrier (no DB read)', async () => {
    const driver = anOoSelfDriver('OP1', 'U1');
    expect(await isFleetCarrierDriver(driver)).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('a driver in a CARRIER-capability org IS a fleet carrier', async () => {
    const org = anOrg([OrgCapability.CARRIER], { orgId: 'ORG1', legalName: 'Acme Freight' });
    const membership = aMembership('ORG1', 'U1', { status: 'ACTIVE' });
    const driver = aDriver({ userId: 'U1', ownedByOperatorId: undefined });
    sendMock
      .mockResolvedValueOnce({ Items: [membership] })
      .mockResolvedValueOnce({ Item: org });
    expect(await isFleetCarrierDriver(driver)).toBe(true);
  });

  it('an unaffiliated driver is NOT a fleet carrier (behaviour unchanged by mute)', async () => {
    const driver = aDriver({ userId: 'U1', ownedByOperatorId: undefined });
    sendMock.mockResolvedValueOnce({ Items: [] }); // no memberships
    expect(await isFleetCarrierDriver(driver)).toBe(false);
  });

  it('models the muted pool: only OO/unaffiliated survive an OO-only filter', async () => {
    // Two OO drivers (cheap, no DB) and one fleet-org driver.
    const oo1 = aFleetDriver('OP1');
    const oo2 = anOoSelfDriver('OP2', 'U2');
    const fleet = aDriver({ userId: 'U3', ownedByOperatorId: undefined });
    const org = anOrg([OrgCapability.CARRIER], { orgId: 'ORG9' });
    sendMock
      .mockResolvedValueOnce({ Items: [aMembership('ORG9', 'U3', { status: 'ACTIVE' })] })
      .mockResolvedValueOnce({ Item: org });

    const pool = [oo1, oo2, fleet];
    const flags = await Promise.all(pool.map((d) => isFleetCarrierDriver(d)));
    const kept = pool.filter((_, i) => !flags[i]);
    expect(kept).toEqual([oo1, oo2]); // fleet driver dropped, OO drivers kept
  });
});
