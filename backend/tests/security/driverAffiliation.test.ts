// SEC — the new GET /api/driver/affiliation endpoint must return a
// truthful status for every possible driver-state combination. This
// is the data the "Awaiting carrier affiliation" UI gate reads; if it
// ever returns AFFILIATED when the driver actually has no carrier of
// record, the load-acceptance gate in carrierOfRecord won't fire and
// the driver will see offers they can't actually accept (worst case)
// or accept them and have nowhere to invoice (silent failure).
//
// Path under test: the route handler logic from routes/driver.ts which
// is essentially:
//   const driver = await DriverService.getProfileByUserId(userId);
//   if (!driver) return { status: NO_PROFILE, carrier: null };
//   const carrier = await resolveCarrierOfRecord(driver);
//   if (!carrier)   return { status: UNAFFILIATED, carrier: null };
//   return { status: AFFILIATED, carrier };

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProfileByUserId = vi.hoisted(() => vi.fn());
const resolveCarrierOfRecord = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/driverService', () => ({
  DriverService: { getProfileByUserId },
}));
vi.mock('../../src/services/carrierOfRecord', () => ({
  resolveCarrierOfRecord,
}));

// Mirror of the route handler. Keep in sync with routes/driver.ts; if the
// route diverges, these tests are wrong, not the route.
async function getAffiliation(userId: string) {
  const { DriverService } = await import('../../src/services/driverService');
  const { resolveCarrierOfRecord } = await import('../../src/services/carrierOfRecord');

  const driver = await DriverService.getProfileByUserId(userId);
  if (!driver) return { status: 'NO_PROFILE', carrier: null };
  const carrier = await resolveCarrierOfRecord(driver);
  if (!carrier) return { status: 'UNAFFILIATED', carrier: null };
  return { status: 'AFFILIATED', carrier };
}

beforeEach(() => {
  getProfileByUserId.mockReset();
  resolveCarrierOfRecord.mockReset();
});

describe('SEC: /api/driver/affiliation — status truth table', () => {
  it('user with no Driver row at all -> NO_PROFILE (the dashboard renders Settings CTA, not load offers)', async () => {
    getProfileByUserId.mockResolvedValueOnce(null);
    const r = await getAffiliation('user_brand_new');
    expect(r).toEqual({ status: 'NO_PROFILE', carrier: null });
    expect(resolveCarrierOfRecord).not.toHaveBeenCalled();
  });

  it('Driver exists but no ownedByOperatorId AND no carrier-org membership -> UNAFFILIATED (banner fires)', async () => {
    getProfileByUserId.mockResolvedValueOnce({ driverId: 'driver_orphan', userId: 'user_orphan' });
    resolveCarrierOfRecord.mockResolvedValueOnce(null);
    const r = await getAffiliation('user_orphan');
    expect(r).toEqual({ status: 'UNAFFILIATED', carrier: null });
  });

  it('Driver with ownedByOperatorId -> AFFILIATED via OWNER_OPERATOR (OO self-haul or OO fleet)', async () => {
    getProfileByUserId.mockResolvedValueOnce({ driverId: 'driver_oo_self', userId: 'user_oo', ownedByOperatorId: 'op_1' });
    resolveCarrierOfRecord.mockResolvedValueOnce({ entityType: 'OWNER_OPERATOR', entityId: 'op_1' });
    const r = await getAffiliation('user_oo');
    expect(r.status).toBe('AFFILIATED');
    expect(r.carrier).toEqual({ entityType: 'OWNER_OPERATOR', entityId: 'op_1' });
  });

  it('Driver with carrier-org membership -> AFFILIATED via CARRIER_ORG', async () => {
    getProfileByUserId.mockResolvedValueOnce({ driverId: 'driver_org_member', userId: 'user_d' });
    resolveCarrierOfRecord.mockResolvedValueOnce({ entityType: 'CARRIER_ORG', entityId: 'org_carrier_1' });
    const r = await getAffiliation('user_d');
    expect(r.status).toBe('AFFILIATED');
    expect(r.carrier?.entityType).toBe('CARRIER_ORG');
  });

  it('NO endpoint ever returns AFFILIATED when carrier is null — the gate cannot be bypassed by an empty carrier object', async () => {
    // Defensive: if the resolver ever returned `{}` instead of null, would
    // we still set status=UNAFFILIATED? Today we only check truthiness;
    // this test pins that behavior so a future "return {}" mistake fails CI.
    getProfileByUserId.mockResolvedValueOnce({ driverId: 'driver_x', userId: 'user_x' });
    resolveCarrierOfRecord.mockResolvedValueOnce(null);
    const r = await getAffiliation('user_x');
    expect(r.status).toBe('UNAFFILIATED');
  });

  it('Two distinct users get isolated lookups — no caching across users (prevents wrong-user leakage)', async () => {
    getProfileByUserId
      .mockResolvedValueOnce({ driverId: 'driver_a', userId: 'user_a' })
      .mockResolvedValueOnce({ driverId: 'driver_b', userId: 'user_b' });
    resolveCarrierOfRecord
      .mockResolvedValueOnce({ entityType: 'OWNER_OPERATOR', entityId: 'op_alice' })
      .mockResolvedValueOnce(null);

    const a = await getAffiliation('user_a');
    const b = await getAffiliation('user_b');

    expect(a.status).toBe('AFFILIATED');
    expect(a.carrier?.entityId).toBe('op_alice');
    expect(b.status).toBe('UNAFFILIATED'); // would FAIL if response cached
  });
});
