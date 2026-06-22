// IAM-5 — ADMIN login must require enrolled 2FA.
// Spec: "Mandatory MFA (TOTP or WebAuthn) for ADMIN sign-in."

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authServiceMock = vi.hoisted(() => ({
  login: vi.fn(),
  getUserById: vi.fn(),
}));
const securityServiceMock = vi.hoisted(() => ({
  hasTwoFactor: vi.fn(),
  mintTwoFactorTicket: vi.fn(() => 'ticket-x'),
  setupTwoFactor: vi.fn(),
  verifyAndEnableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  exchangeTwoFactorTicket: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('../../../src/services/authService', () => ({ AuthService: authServiceMock }));
vi.mock('../../../src/services/securityService', () => ({ SecurityService: securityServiceMock }));
vi.mock('../../../src/middleware/auth', async () => {
  const actual: any = await vi.importActual('../../../src/middleware/auth');
  return { ...actual, authenticate: (_req: any, _res: any, next: any) => next() };
});
vi.mock('../../../src/utils/helpers', () => ({
  Helpers: {
    generateToken: () => 'jwt-token',
    getCurrentTimestamp: () => Date.now(),
  },
}));

import express from 'express';
import request from 'supertest';
import authRoutes from '../../../src/routes/auth';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRoutes);
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe('ADMIN login MFA mandatory (LL-AC-004, IAM spec)', () => {
  it('refuses ADMIN login when 2FA is not enrolled', async () => {
    authServiceMock.login.mockResolvedValueOnce({
      user: { userId: 'a1', email: 'admin@x.com', role: 'ADMIN' },
      token: 'jwt-x',
    });
    securityServiceMock.hasTwoFactor.mockResolvedValueOnce(false);

    const r = await request(app()).post('/api/auth/login')
      .send({ email: 'admin@x.com', password: 'longenough' });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('MFA_REQUIRED');
    expect(securityServiceMock.mintTwoFactorTicket).not.toHaveBeenCalled();
  });

  it('allows ADMIN login when 2FA is enrolled (returns ticket)', async () => {
    authServiceMock.login.mockResolvedValueOnce({
      user: { userId: 'a1', email: 'admin@x.com', role: 'ADMIN' },
      token: 'jwt-x',
    });
    securityServiceMock.hasTwoFactor.mockResolvedValueOnce(true);

    const r = await request(app()).post('/api/auth/login')
      .send({ email: 'admin@x.com', password: 'longenough' });

    expect(r.status).toBe(200);
    expect(r.body.needsTwoFactor).toBe(true);
    expect(r.body.twoFactorTicket).toBe('ticket-x');
  });

  it('does NOT require MFA for non-ADMIN users (preserves existing UX)', async () => {
    authServiceMock.login.mockResolvedValueOnce({
      user: { userId: 'u1', email: 'driver@x.com', role: 'DRIVER' },
      token: 'jwt-x',
    });
    securityServiceMock.hasTwoFactor.mockResolvedValueOnce(false);

    const r = await request(app()).post('/api/auth/login')
      .send({ email: 'driver@x.com', password: 'longenough' });

    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('DRIVER');
    expect(r.body.needsTwoFactor).toBeUndefined();
  });
});
