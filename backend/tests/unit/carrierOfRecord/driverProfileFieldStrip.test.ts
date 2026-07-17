/**
 * Audit v7 N1: the driver profile routes are the untrusted boundary. A driver
 * could previously PUT/POST `ownedByOperatorId` onto their own row and inherit an
 * arbitrary VERIFIED carrier's FMCSA authority + insurance, because PUT has no
 * request schema and POST's express-validator schema validates known fields but
 * does not STRIP unknown ones. Both routes must drop server-controlled fields
 * before the body reaches DriverService.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { createProfile, updateProfile, getProfileByUserId } = vi.hoisted(() => ({
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  getProfileByUserId: vi.fn(),
}));
const holder = vi.hoisted(() => ({ user: { userId: 'attacker-user', role: 'DRIVER' } }));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = holder.user; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../src/middleware/validation', () => ({
  validate: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../../src/services/driverService', () => ({
  DriverService: { createProfile, updateProfile, getProfileByUserId },
}));
vi.mock('../../../src/services/attestation/podStorage', () => ({ presignedPodPost: vi.fn() }));
vi.mock('../../../src/services/offerService', () => ({ OfferService: {} }));
vi.mock('../../../src/services/loadService', () => ({ LoadService: {} }));
vi.mock('../../../src/services/capacityService', () => ({ CapacityService: {}, calcUsableVolume: vi.fn() }));
vi.mock('../../../src/services/haulerCapacityService', () => ({
  HaulerCapacityService: { recordRatedChange: vi.fn() },
  applyCapacityFilter: vi.fn(),
}));
vi.mock('../../../src/services/emailService', () => ({ EmailService: {} }));
vi.mock('../../../src/services/pushService', () => ({ PushService: {} }));
vi.mock('../../../src/services/verification', () => ({
  // a middleware FACTORY - driver.ts calls requireVerifiedCarrier() at mount time
  requireVerifiedCarrier: () => (_req: any, _res: any, next: any) => next(),
  submitDriverIdv: vi.fn(),
  getVerification: vi.fn(),
}));
vi.mock('../../../src/services/carrierOfRecord', () => ({ resolveCarrierOfRecord: vi.fn() }));
vi.mock('../../../src/services/ownerOperatorService', () => ({ OwnerOperatorService: {} }));
vi.mock('../../../src/services/orgService', () => ({ OrgMembershipService: {} }));
vi.mock('../../../src/config/database', () => ({ Database: { updateItem: vi.fn(), getItem: vi.fn() } }));
vi.mock('../../../src/config/environment', () => ({ default: { dynamodb: { driversTable: 'Drivers' } } }));
vi.mock('../../../src/utils/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { Logger: l, default: l };
});

import driverRouter from '../../../src/routes/driver';
import { errorHandler } from '../../../src/middleware/errorHandler';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/driver', driverRouter);
  a.use(errorHandler);
  return a;
}

// the exact payload an attacker would send to graft themselves onto a real carrier
const ATTACK_BODY = {
  legalName: 'Mallory Hauler',
  phone: '555-0199',
  ownedByOperatorId: 'op_a_real_verified_operator',
  isSelf: true,
  carrierId: 'op_a_real_verified_operator',
  driverId: 'drv_someone_else',
  userId: 'victim-user',
  status: 'AVAILABLE',
};

beforeEach(() => {
  createProfile.mockReset().mockResolvedValue({ driverId: 'drv-1' });
  updateProfile.mockReset().mockResolvedValue(undefined);
  getProfileByUserId.mockReset().mockResolvedValue({ driverId: 'drv-1', maxCapacityLbs: 40000 });
  holder.user = { userId: 'attacker-user', role: 'DRIVER' };
});

describe('driver profile routes strip server-controlled fields (audit v7 N1)', () => {
  it('PUT /profile does not persist a self-declared ownedByOperatorId', async () => {
    const res = await request(app()).put('/api/driver/profile').send(ATTACK_BODY);
    expect(res.status).toBe(200);

    expect(updateProfile).toHaveBeenCalledTimes(1);
    const persisted = updateProfile.mock.calls[0][1];
    expect('ownedByOperatorId' in persisted).toBe(false);
    expect('isSelf' in persisted).toBe(false);
    expect('driverId' in persisted).toBe(false);
    expect('userId' in persisted).toBe(false);
    expect('status' in persisted).toBe(false);
    // the driver's own editable fields still go through - including carrierId,
    // which is a user-entered profile field (REQUIRED_PROFILE in SettingsPage),
    // not an authority field: resolveCarrierOfRecord never reads it
    expect(persisted.legalName).toBe('Mallory Hauler');
    expect(persisted.phone).toBe('555-0199');
    expect(persisted.carrierId).toBe('op_a_real_verified_operator');
  });

  it('POST /profile does not accept an ownedByOperatorId from the body', async () => {
    const res = await request(app()).post('/api/driver/profile').send(ATTACK_BODY);
    expect(res.status).toBe(201);

    expect(createProfile).toHaveBeenCalledTimes(1);
    const [userIdArg, data] = createProfile.mock.calls[0];
    // userId comes from the authenticated session, never the body
    expect(userIdArg).toBe('attacker-user');
    expect('ownedByOperatorId' in data).toBe(false);
    expect('isSelf' in data).toBe(false);
    expect('userId' in data).toBe(false);
    expect(data.legalName).toBe('Mallory Hauler');
  });

  it('PUT /profile still saves a normal edit untouched', async () => {
    const res = await request(app())
      .put('/api/driver/profile')
      .send({ phone: '555-0123', truckMake: 'Peterbilt', maxCapacityLbs: 44000 });
    expect(res.status).toBe(200);

    const persisted = updateProfile.mock.calls[0][1];
    expect(persisted).toEqual({ phone: '555-0123', truckMake: 'Peterbilt', maxCapacityLbs: 44000 });
  });
});
