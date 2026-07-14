// SEC-C1 (audit v6): public POST /api/auth/signup accepted an attacker-chosen
// `role`, and the validator allowed ADMIN -> a self-registered platform admin
// (amplified to every staff tier by resolvePlatformRole's back-compat). The fix
// is a server-side allowlist: only non-privileged roles may self-register.
// This suite locks the guard at the service layer, independent of the route
// validator, so a bypass of the validator still cannot mint a privileged account.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(async () => [] as any[]),
  putItem: vi.fn(async () => undefined),
  getItem: vi.fn(async () => null),
  updateItem: vi.fn(async () => undefined),
}));
vi.mock('../../../src/config/database', () => ({ Database: dbMock }));
vi.mock('../../../src/config/aws', () => ({ docClient: { send: vi.fn(async () => undefined) } }));
vi.mock('../../../src/config/environment', () => ({
  default: { dynamodb: { usersTable: 'U', membershipsTable: 'M', organizationsTable: 'O' } },
}));

import { AuthService } from '../../../src/services/authService';
import { UserRole } from '../../../src/types';

beforeEach(() => vi.clearAllMocks());

describe('SEC-C1: self-signup role allowlist', () => {
  it('rejects role=ADMIN before any write (privilege escalation blocked)', async () => {
    await expect(AuthService.signup('a@b.com', 'password12', UserRole.ADMIN))
      .rejects.toMatchObject({ message: expect.stringContaining('Invalid role') });
    expect(dbMock.putItem).not.toHaveBeenCalled();
  });

  it('rejects role=CARRIER_ADMIN (only the dedicated /signup/carrier path may mint it)', async () => {
    await expect(AuthService.signup('a@b.com', 'password12', UserRole.CARRIER_ADMIN))
      .rejects.toMatchObject({ message: expect.stringContaining('Invalid role') });
    expect(dbMock.putItem).not.toHaveBeenCalled();
  });

  it('lets a non-privileged role (SHIPPER) past the guard to the email-existence check', async () => {
    dbMock.query.mockResolvedValueOnce([{ userId: 'existing' }] as any); // pretend the email is taken
    await expect(AuthService.signup('a@b.com', 'password12', UserRole.SHIPPER))
      .rejects.toMatchObject({ message: expect.stringContaining('already registered') });
    expect(dbMock.query).toHaveBeenCalled(); // proves it cleared the role guard
  });

  it('accepts every non-privileged self-signup role at the guard', async () => {
    for (const role of [UserRole.SHIPPER, UserRole.DRIVER, UserRole.RECEIVER, UserRole.OWNER_OPERATOR]) {
      dbMock.query.mockResolvedValueOnce([{ userId: 'existing' }] as any);
      await expect(AuthService.signup('a@b.com', 'password12', role))
        .rejects.toMatchObject({ message: expect.stringContaining('already registered') });
    }
  });
});
