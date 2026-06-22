// LL-AC-004 race-safety test for the admin bootstrap.
//
// Verifies that two simultaneous /api/setup/complete calls with valid
// distinct tokens cannot both create an ADMIN. The atomic
// ConditionExpression on the singleton marker is what enforces this.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock the AWS Dynamo client used by the route ──────────────────────────────

const realState = {
  hasSingleton: false,
  hasAdmin: false,
  tokens: new Map<string, { email: string; name: string; expiresAt: number; createdAt: number }>(),
};

const sendMock = vi.hoisted(() => vi.fn(async (cmd: any) => {
  const name = cmd?.constructor?.name ?? 'Command';
  const input = cmd.input ?? {};

  if (name === 'GetCommand' && input.TableName === 'LoadLead_Users') {
    if (input.Key?.userId === '__admin_singleton__') {
      return realState.hasSingleton ? { Item: { userId: '__admin_singleton__' } } : { Item: undefined };
    }
  }
  if (name === 'GetCommand' && input.TableName === 'LoadLead_SetupTokens') {
    const t = realState.tokens.get(input.Key.token);
    return { Item: t ? { token: input.Key.token, ...t } : undefined };
  }
  if (name === 'ScanCommand' && input.TableName === 'LoadLead_Users') {
    return { Count: realState.hasAdmin ? 1 : 0, Items: [] };
  }
  if (name === 'PutCommand' && input.TableName === 'LoadLead_Users') {
    if (input.Item?.userId === '__admin_singleton__') {
      if (realState.hasSingleton) {
        const e: any = new Error('The conditional request failed');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      realState.hasSingleton = true;
      return {};
    }
    if (input.Item?.role === 'ADMIN') {
      realState.hasAdmin = true;
      return {};
    }
  }
  if (name === 'PutCommand' && input.TableName === 'LoadLead_SetupTokens') {
    realState.tokens.set(input.Item.token, input.Item);
    return {};
  }
  if (name === 'DeleteCommand' && input.TableName === 'LoadLead_SetupTokens') {
    realState.tokens.delete(input.Key.token);
    return {};
  }
  if (name === 'PutCommand' && input.TableName?.includes('AdminBootstrapAttempts')) {
    return {};
  }
  return {};
}));

vi.mock('../../src/config/aws', () => ({
  docClient: { send: sendMock },
}));

vi.mock('../../src/services/emailService', () => ({
  EmailService: {
    adminSetupInvite: vi.fn(async () => undefined),
    welcome: vi.fn(async () => undefined),
  },
}));

process.env.ALLOW_ADMIN_BOOTSTRAP = 'true';

import express from 'express';
import request from 'supertest';
import setupRoutes from '../../src/routes/setup';

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/setup', setupRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode ?? 500).json({ error: err?.message ?? 'error' });
  });
  return a;
}

beforeEach(() => {
  realState.hasSingleton = false;
  realState.hasAdmin = false;
  realState.tokens.clear();
});

describe('admin bootstrap race safety (LL-AC-004)', () => {
  it('exactly one of two concurrent /complete requests succeeds', async () => {
    const a = makeApp();
    const now = Date.now();
    const t1 = 'tok-1'.padEnd(80, 'a');
    const t2 = 'tok-2'.padEnd(80, 'b');
    realState.tokens.set(t1, { email: 'a@x.com', name: 'A', expiresAt: now + 86_400_000, createdAt: now });
    realState.tokens.set(t2, { email: 'b@x.com', name: 'B', expiresAt: now + 86_400_000, createdAt: now });

    const [r1, r2] = await Promise.all([
      request(a).post('/api/setup/complete').send({ token: t1, password: 'longenough-A' }),
      request(a).post('/api/setup/complete').send({ token: t2, password: 'longenough-B' }),
    ]);

    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([200, 409]);
    expect(realState.hasAdmin).toBe(true);
    expect(realState.hasSingleton).toBe(true);
  });
});
