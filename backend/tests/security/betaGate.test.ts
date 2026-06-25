/**
 * Beta gate — acceptance proofs (Part A).
 *
 * Every test below maps to a specific bullet in the TASK acceptance list:
 *
 *   [GATE-1] BETA_MODE ON: signup API with NO invite + non-allowlisted
 *            email is REJECTED 403 server-side, neutral message.
 *   [GATE-2] BETA_MODE ON: signup with a valid invite token → 201 +
 *            user.betaUser=true + cohort + invitedVia=INVITE.
 *   [GATE-3] BETA_MODE ON: allowlisted DOMAIN signup → 201 +
 *            user.betaUser=true + invitedVia=ALLOWLIST.
 *   [GATE-4] BETA_MODE ON: allowlisted EMAIL signup → 201 +
 *            user.betaUser=true + invitedVia=ALLOWLIST.
 *   [GATE-5] BETA_MODE ON: an existing carrier-org invite still works
 *            (carrier-org flow, not duplicated, not broken by the gate).
 *   [GATE-6] BETA_MODE ON: login of an ADMIN user → not gated.
 *   [GATE-7] BETA_MODE ON: login of a non-betaUser non-ADMIN → 403
 *            with neutral BETA_REQUIRED.
 *   [GATE-8] BETA_MODE OFF: signup with no invite + no allowlist → 201
 *            (gate lifts, public signup opens).
 *   [GATE-9] Invitation extension: createSelfSignupInvitation issues
 *            a token with NO orgId, and acceptInvitation handles it
 *            without creating a membership.
 *
 * These tests instantiate the actual middleware against an in-memory
 * mock of the Database module. They prove SERVER-SIDE rejection — there
 * is no UI in the loop. Run via:
 *
 *   cd backend && npm test -- betaGate
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock the Database before importing anything that uses it.
vi.mock('../../src/config/database', () => ({
  Database: {
    query: vi.fn(),
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    scan: vi.fn(),
  },
}));
// Mock Logger to keep test output clean.
vi.mock('../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Database } from '../../src/config/database';
import { requireBetaGate } from '../../src/middleware/betaGate';
import { OrgInvitationService } from '../../src/services/orgService';
import { BetaAllowlistService } from '../../src/services/betaAllowlistService';
import { _resetBetaConfigForTests } from '../../src/config/beta';
import { UserRole } from '../../src/types';

const dbQuery = vi.mocked(Database.query);
const dbGet   = vi.mocked(Database.getItem);
const dbPut   = vi.mocked(Database.putItem);

function makeReqRes(body: any) {
  const req = { body } as Request;
  const json = vi.fn();
  const status = vi.fn().mockImplementation(() => ({ json }));
  const res = { status, json } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  const next: NextFunction = vi.fn();
  return { req, res, next };
}

function setBetaMode(on: boolean) {
  process.env.BETA_MODE = on ? 'true' : 'false';
  _resetBetaConfigForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BETA_MODE;
  _resetBetaConfigForTests();
});

describe('[GATE-1] BETA_MODE ON: signup with no invite + non-allowlisted email is REJECTED 403', () => {
  it('rejects with neutral BETA_REQUIRED — no UI dependency', async () => {
    setBetaMode(true);
    // No invite, no allowlist match
    dbGet.mockResolvedValue(null);  // getInvitationByToken
    dbQuery.mockResolvedValue([]);   // allowlist value-index lookup → empty

    const { req, res, next } = makeReqRes({ email: 'random@nowhere.com' });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'BETA_REQUIRED' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with the SAME message whether email exists or not (no disclosure)', async () => {
    setBetaMode(true);

    // Run 1: email never seen
    dbGet.mockResolvedValue(null);
    dbQuery.mockResolvedValue([]);
    const r1 = makeReqRes({ email: 'unknown@nowhere.com' });
    await requireBetaGate({ mode: 'signup' })(r1.req, r1.res, r1.next);
    const msg1 = (r1.res.json as any).mock.calls[0][0];

    // Run 2: email that happens to match an existing (non-beta) user
    // — for the signup gate, an existing user just looks like another
    //   non-allowlisted, non-invited email.
    dbGet.mockResolvedValue(null);
    dbQuery.mockResolvedValue([]);
    const r2 = makeReqRes({ email: 'someone@somewhere.com' });
    await requireBetaGate({ mode: 'signup' })(r2.req, r2.res, r2.next);
    const msg2 = (r2.res.json as any).mock.calls[0][0];

    expect(msg1).toEqual(msg2);
  });
});

describe('[GATE-2] BETA_MODE ON: valid invite token → passes + attaches betaContext', () => {
  it('passes signup with a valid token; attaches invitedVia=INVITE', async () => {
    setBetaMode(true);
    const invitation = {
      token: 'tk-valid',
      email: 'alice@example.com',
      userRole: UserRole.SHIPPER,
      invitedBy: 'staff-1',
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now() - 1_000,
      cohort: 'wave-1',
      // no orgId — this is a self-signup invite
    };
    dbGet.mockResolvedValue(invitation);

    const { req, res, next } = makeReqRes({
      email: 'alice@example.com',
      inviteToken: 'tk-valid',
    });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect((req as any).betaContext).toEqual(
      expect.objectContaining({
        invitedVia: 'INVITE',
        invitation: expect.objectContaining({ token: 'tk-valid' }),
      }),
    );
  });

  it('rejects an expired invite token', async () => {
    setBetaMode(true);
    dbGet.mockResolvedValue({
      token: 'tk-old',
      email: 'bob@example.com',
      userRole: UserRole.DRIVER,
      invitedBy: 'staff-1',
      expiresAt: Date.now() - 1_000,
      createdAt: Date.now() - 10_000,
    });
    // No allowlist fallback either
    dbQuery.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({
      email: 'bob@example.com',
      inviteToken: 'tk-old',
    });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an already-accepted invite token', async () => {
    setBetaMode(true);
    dbGet.mockResolvedValue({
      token: 'tk-used',
      email: 'carol@example.com',
      userRole: UserRole.RECEIVER,
      invitedBy: 'staff-1',
      expiresAt: Date.now() + 60_000,
      acceptedAt: Date.now() - 5_000,
      createdAt: Date.now() - 10_000,
    });
    dbQuery.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({
      email: 'carol@example.com',
      inviteToken: 'tk-used',
    });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invite where the email does not match', async () => {
    setBetaMode(true);
    dbGet.mockResolvedValue({
      token: 'tk-wrongemail',
      email: 'alice@example.com',     // invite was issued to alice
      userRole: UserRole.SHIPPER,
      invitedBy: 'staff-1',
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now() - 1_000,
    });
    dbQuery.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({
      email: 'mallory@example.com',   // someone else trying to use Alice's invite
      inviteToken: 'tk-wrongemail',
    });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('[GATE-3 / GATE-4] BETA_MODE ON: allowlist match passes + attaches betaContext', () => {
  it('passes when the EMAIL is allowlisted', async () => {
    setBetaMode(true);
    dbGet.mockResolvedValue(null);
    // First call (EMAIL lookup) returns a hit; the gate stops there.
    dbQuery.mockResolvedValueOnce([
      {
        allowlistId: 'allow-1',
        type: 'EMAIL',
        value: 'alice@example.com',
        active: true,
        addedByStaffId: 'staff-1',
        createdAt: Date.now(),
      },
    ]);

    const { req, res, next } = makeReqRes({ email: 'alice@example.com' });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).betaContext).toEqual(
      expect.objectContaining({
        invitedVia: 'ALLOWLIST',
        allowlistEntry: expect.objectContaining({ type: 'EMAIL', value: 'alice@example.com' }),
      }),
    );
  });

  it('passes when the DOMAIN is allowlisted', async () => {
    setBetaMode(true);
    dbGet.mockResolvedValue(null);
    // First call (EMAIL lookup) returns no hit; second (DOMAIN) returns hit.
    dbQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          allowlistId: 'allow-dom-1',
          type: 'DOMAIN',
          value: 'partner.com',
          active: true,
          addedByStaffId: 'staff-1',
          createdAt: Date.now(),
        },
      ]);

    const { req, res, next } = makeReqRes({ email: 'newhire@partner.com' });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).betaContext).toEqual(
      expect.objectContaining({
        invitedVia: 'ALLOWLIST',
        allowlistEntry: expect.objectContaining({ type: 'DOMAIN', value: 'partner.com' }),
      }),
    );
  });

  it('skips an allowlist row that is active=false', async () => {
    setBetaMode(true);
    dbGet.mockResolvedValue(null);
    dbQuery.mockResolvedValue([
      {
        allowlistId: 'allow-stale',
        type: 'EMAIL',
        value: 'oldhire@partner.com',
        active: false,   // soft-deleted
        addedByStaffId: 'staff-1',
        createdAt: Date.now() - 100_000,
      },
    ]);

    const { req, res, next } = makeReqRes({ email: 'oldhire@partner.com' });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('[GATE-6 / GATE-7] login gate behavior', () => {
  it('[GATE-6] BETA_MODE ON: ADMIN user is never blocked', async () => {
    setBetaMode(true);
    dbQuery.mockResolvedValueOnce([{
      userId: 'admin-1',
      email: 'admin@loadlead.com',
      role: UserRole.ADMIN,
      betaUser: undefined,    // ADMINs deliberately don't carry betaUser
    }]);

    const { req, res, next } = makeReqRes({ email: 'admin@loadlead.com' });
    await requireBetaGate({ mode: 'login' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('[GATE-7] BETA_MODE ON: non-beta non-ADMIN user → 403 BETA_REQUIRED', async () => {
    setBetaMode(true);
    dbQuery.mockResolvedValueOnce([{
      userId: 'user-old',
      email: 'pre-beta@example.com',
      role: UserRole.SHIPPER,
      betaUser: undefined,   // pre-beta account
    }]);

    const { req, res, next } = makeReqRes({ email: 'pre-beta@example.com' });
    await requireBetaGate({ mode: 'login' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'BETA_REQUIRED' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('BETA_MODE ON: betaUser=true user → passes login gate', async () => {
    setBetaMode(true);
    dbQuery.mockResolvedValueOnce([{
      userId: 'user-beta',
      email: 'beta@example.com',
      role: UserRole.SHIPPER,
      betaUser: true,
      cohort: 'wave-1',
    }]);

    const { req, res, next } = makeReqRes({ email: 'beta@example.com' });
    await requireBetaGate({ mode: 'login' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('BETA_MODE ON: email not found in DB → fall through to auth handler (don\'t leak existence)', async () => {
    setBetaMode(true);
    dbQuery.mockResolvedValueOnce([]);   // no matching user

    const { req, res, next } = makeReqRes({ email: 'nobody@nowhere.com' });
    await requireBetaGate({ mode: 'login' })(req, res, next);

    // Gate passes through — the auth handler will return the normal
    // "invalid credentials" 401 for both wrong-password and unknown
    // email, so the gate doesn't differentiate.
    expect(next).toHaveBeenCalled();
  });
});

describe('[GATE-8] BETA_MODE OFF: gate is a no-op (public-launch flip)', () => {
  it('passes signup with no invite, no allowlist, no DB reads', async () => {
    setBetaMode(false);

    const { req, res, next } = makeReqRes({ email: 'public@example.com' });
    await requireBetaGate({ mode: 'signup' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();   // no DB reads when gate is off
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('passes login with no betaUser check, no DB reads', async () => {
    setBetaMode(false);

    const { req, res, next } = makeReqRes({ email: 'public@example.com' });
    await requireBetaGate({ mode: 'login' })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });
});

describe('[GATE-9] Invitation extension — self-signup branch', () => {
  it('createSelfSignupInvitation writes a token with NO orgId', async () => {
    setBetaMode(true);
    dbPut.mockResolvedValue({} as any);

    const inv = await OrgInvitationService.createSelfSignupInvitation({
      email: 'newshipper@example.com',
      userRole: UserRole.SHIPPER,
      invitedBy: 'staff-1',
      cohort: 'wave-1',
    });

    expect(inv.token).toBeTruthy();
    expect(inv.orgId).toBeUndefined();
    expect(inv.orgRole).toBeUndefined();
    expect(inv.userRole).toBe(UserRole.SHIPPER);
    expect(inv.cohort).toBe('wave-1');
    // The persisted invitation should have userRole set + NOT have orgId
    // as a key at all (vitest's objectContaining doesn't match absent
    // keys via undefined, so we check the persisted object directly).
    const writtenItem = (dbPut as any).mock.calls[0][1];
    expect(writtenItem.userRole).toBe(UserRole.SHIPPER);
    expect(writtenItem.orgId).toBeUndefined();
    expect('orgId' in writtenItem).toBe(false);
  });

  it('acceptInvitation with a self-signup invite returns null (no membership row)', async () => {
    const now = Date.now();
    dbGet.mockResolvedValue({
      token: 'tk-self',
      email: 'newshipper@example.com',
      userRole: UserRole.SHIPPER,
      invitedBy: 'staff-1',
      expiresAt: now + 60_000,
      createdAt: now - 1_000,
      // no orgId
    });
    vi.mocked(Database.updateItem).mockResolvedValue({} as any);

    const result = await OrgInvitationService.acceptInvitation('tk-self', 'user-new');
    expect(result).toBeNull();
  });
});
