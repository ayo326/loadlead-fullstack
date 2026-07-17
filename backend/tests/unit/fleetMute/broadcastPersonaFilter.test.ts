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
 *
 * Audit v7 N1: isFleetCarrierDriver used to short-circuit to false on a raw
 * driver.ownedByOperatorId with no DB read. That shortcut trusted an assertion
 * the operator may not claim, so it could disagree with resolveCarrierOfRecord
 * about the same driver. It now resolves through the one corroborated path,
 * which costs a read on the OO branch - hence the operator seeding below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aDriver, anOoSelfDriver, aFleetDriver, anOwnerOperator, aMembership, anOrg } from '../../fixtures/factories';
import { OrgCapability } from '../../../src/types';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config/aws', () => ({ docClient: { send: sendMock } }));
vi.mock('../../../src/config/environment', () => ({
  default: { dynamodb: { membershipsTable: 'Memberships', orgsTable: 'Organizations' } },
}));

import { isFleetCarrierDriver } from '../../../src/services/carrierOfRecord';

// carrierOfRecord reads the OO table by name (no config slot), same as the service.
const OO_TABLE = 'LoadLead_OwnerOperators';

/**
 * Route by command input rather than call order: the pool test resolves several
 * drivers concurrently, so an ordered mockResolvedValueOnce chain would be
 * decided by scheduling rather than by which row each driver actually needs.
 */
function seed(opts: {
  operators?: Record<string, unknown>;
  membershipsByUser?: Record<string, unknown[]>;
  orgs?: Record<string, unknown>;
}) {
  const { operators = {}, membershipsByUser = {}, orgs = {} } = opts;
  sendMock.mockImplementation((cmd: any) => {
    const input = cmd?.input ?? {};
    if (input.TableName === OO_TABLE) {
      return Promise.resolve({ Item: operators[input.Key?.operatorId] });
    }
    if (input.TableName === 'Memberships') {
      const uid = input.ExpressionAttributeValues?.[':u'];
      return Promise.resolve({ Items: membershipsByUser[uid] ?? [] });
    }
    if (input.TableName === 'Organizations') {
      return Promise.resolve({ Item: orgs[input.Key?.orgId] });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => { sendMock.mockReset(); });

describe('isFleetCarrierDriver (pool selection primitive)', () => {
  it('an owner-operator fleet driver is NOT a fleet carrier', async () => {
    const driver = aFleetDriver('OP1');
    seed({ operators: { OP1: anOwnerOperator({ operatorId: 'OP1', fleetDriverIds: [driver.driverId] }) } });
    expect(await isFleetCarrierDriver(driver)).toBe(false);
  });

  it('an owner-operator self-driver is NOT a fleet carrier', async () => {
    const driver = anOoSelfDriver('OP1', 'U1');
    seed({ operators: { OP1: anOwnerOperator({ operatorId: 'OP1', userId: 'U1', fleetDriverIds: [] }) } });
    expect(await isFleetCarrierDriver(driver)).toBe(false);
  });

  it('a driver in a CARRIER-capability org IS a fleet carrier', async () => {
    const org = anOrg([OrgCapability.CARRIER], { orgId: 'ORG1', legalName: 'Acme Freight' });
    const driver = aDriver({ userId: 'U1', ownedByOperatorId: undefined });
    seed({
      membershipsByUser: { U1: [aMembership('ORG1', 'U1', { status: 'ACTIVE' })] },
      orgs: { ORG1: org },
    });
    expect(await isFleetCarrierDriver(driver)).toBe(true);
  });

  it('an unaffiliated driver is NOT a fleet carrier (behaviour unchanged by mute)', async () => {
    const driver = aDriver({ userId: 'U1', ownedByOperatorId: undefined });
    seed({ membershipsByUser: { U1: [] } });
    expect(await isFleetCarrierDriver(driver)).toBe(false);
  });

  it('a driver whose claimed operator does not claim them back is NOT a fleet carrier either (audit v7 N1)', async () => {
    // the forged link grants no OO carrier, and with no org membership they are
    // simply unaffiliated - never silently promoted into the fleet pool
    const driver = aDriver({ userId: 'U_X', ownedByOperatorId: 'OP_VICTIM' });
    seed({
      operators: { OP_VICTIM: anOwnerOperator({ operatorId: 'OP_VICTIM', fleetDriverIds: [] }) },
      membershipsByUser: { U_X: [] },
    });
    expect(await isFleetCarrierDriver(driver)).toBe(false);
  });

  it('models the muted pool: only OO/unaffiliated survive an OO-only filter', async () => {
    const oo1 = aFleetDriver('OP1');
    const oo2 = anOoSelfDriver('OP2', 'U2');
    const fleet = aDriver({ userId: 'U3', ownedByOperatorId: undefined });
    seed({
      operators: {
        OP1: anOwnerOperator({ operatorId: 'OP1', fleetDriverIds: [oo1.driverId] }),
        OP2: anOwnerOperator({ operatorId: 'OP2', userId: 'U2', fleetDriverIds: [] }),
      },
      membershipsByUser: { U3: [aMembership('ORG9', 'U3', { status: 'ACTIVE' })] },
      orgs: { ORG9: anOrg([OrgCapability.CARRIER], { orgId: 'ORG9' }) },
    });

    const pool = [oo1, oo2, fleet];
    const flags = await Promise.all(pool.map((d) => isFleetCarrierDriver(d)));
    const kept = pool.filter((_, i) => !flags[i]);
    expect(kept).toEqual([oo1, oo2]); // fleet driver dropped, OO drivers kept
  });
});
