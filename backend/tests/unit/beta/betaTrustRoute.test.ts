/**
 * Admin trust-events route: non-admins are rejected by the inherited
 * authenticate + requireAdmin guards (the same guards every /api/admin/* route
 * uses). Exercises the real middleware with real signed tokens; the service is
 * mocked so the admin-success path does not touch DynamoDB.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { record, getCounts, list } = vi.hoisted(() => ({
  record: vi.fn(async (input: any) => ({ eventId: 'btrust_test', recordedAt: Date.now(), ...input })),
  getCounts: vi.fn(async () => ({ noShows: 0, trustIncidents: 0 })),
  list: vi.fn(async () => []),
}));
vi.mock('../../../src/services/betaTrustEventService', () => ({
  BetaTrustEventService: { record, getCounts, list },
  BETA_TRUST_EVENT_TYPES: ['NO_SHOW', 'TRUST_INCIDENT'],
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import adminBetaTrustRoutes from '../../../src/routes/adminBetaTrust';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/beta/trust-events', adminBetaTrustRoutes);
  return a;
}

const adminToken = Helpers.generateToken({ userId: 'admin-1', email: 'admin@loadlead.test', role: UserRole.ADMIN });
const shipperToken = Helpers.generateToken({ userId: 'ship-1', email: 'ship@loadlead.test', role: UserRole.SHIPPER });
const body = { eventType: 'NO_SHOW', loadId: 'load-1', carrierId: 'carrier-1' };

describe('admin trust-events route is admin-only', () => {
  it('401 when unauthenticated', async () => {
    const r = await request(app()).post('/api/admin/beta/trust-events').send(body);
    expect(r.status).toBe(401);
  });

  it('403 for a non-admin (SHIPPER)', async () => {
    const r = await request(app())
      .post('/api/admin/beta/trust-events')
      .set('Authorization', `Bearer ${shipperToken}`)
      .send(body);
    expect(r.status).toBe(403);
  });

  it('201 for an admin and the event is recorded', async () => {
    const r = await request(app())
      .post('/api/admin/beta/trust-events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(r.status).toBe(201);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'NO_SHOW', recordedByAdminId: 'admin-1' }));
  });

  it('summary endpoint is also admin-only', async () => {
    const anon = await request(app()).get('/api/admin/beta/trust-events/summary');
    expect(anon.status).toBe(401);
    const ok = await request(app())
      .get('/api/admin/beta/trust-events/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ noShows: 0, trustIncidents: 0 });
  });
});
