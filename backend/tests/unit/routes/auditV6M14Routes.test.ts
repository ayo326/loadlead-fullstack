/**
 * M14 (audit v6): the Canopy webhook route and the capacity route were untested
 * end-to-end. Cover the security-critical seams: the Canopy raw-body signature gate
 * (fail-closed in prod, reject bad signatures) and the capacity route's role gate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';

// ─── Canopy webhook ───────────────────────────────────────────────────────────
const cfg = vi.hoisted(() => ({ webhookSecret: '' as string, live: false }));
vi.mock('../../../src/config/canopyConfig', () => ({ default: cfg }));
vi.mock('../../../src/services/canopy/canopyClient', () => ({ CanopyClient: { getPull: vi.fn(async () => ({ pull_id: 'p1' })) } }));
vi.mock('../../../src/services/canopy/canopyIngestionService', () => ({ ingestPullObject: vi.fn(async () => undefined) }));
vi.mock('../../../src/services/canopy/canopyMonitoringService', () => ({ ingestMonitoringPullObject: vi.fn(async () => undefined), markDisconnected: vi.fn(async () => undefined) }));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { canopyWebhookHandler } from '../../../src/routes/canopyWebhook';

function makeReqRes(rawBody: string, headers: Record<string, string> = {}) {
  const req = { body: Buffer.from(rawBody, 'utf8'), headers } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status };
}

describe('M14: Canopy webhook signature gate', () => {
  beforeEach(() => { cfg.webhookSecret = ''; cfg.live = false; });

  it('401 when no secret is configured in production (fail-closed)', async () => {
    cfg.webhookSecret = '';
    cfg.live = true;
    const { req, res, status } = makeReqRes(JSON.stringify({ event_type: 'pull.ready', pull_id: 'p1' }));
    await canopyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('401 on a bad signature when a secret IS configured', async () => {
    cfg.webhookSecret = 'shhh';
    cfg.live = true;
    const { req, res, status } = makeReqRes(JSON.stringify({ event_type: 'pull.ready', pull_id: 'p1' }), {
      'canopy-signature': `t=${Math.floor(Date.now() / 1000)},s=deadbeef`,
    });
    await canopyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('accepts a correctly-signed body (not 401)', async () => {
    cfg.webhookSecret = 'shhh';
    cfg.live = true;
    const raw = JSON.stringify({ event_type: 'pull.ready', pull_id: 'p1', source: 'CARRIER_ONBOARDING' });
    const t = String(Math.floor(Date.now() / 1000));
    const s = createHmac('sha256', 'shhh').update(`${t}.${raw}`, 'utf8').digest('hex');
    const { req, res, status } = makeReqRes(raw, { 'canopy-signature': `t=${t},s=${s}` });
    await canopyWebhookHandler(req, res);
    expect(status).not.toHaveBeenCalledWith(401);
  });
});

// ─── Capacity route role gate ───────────────────────────────────────────────
import capacityRoutes from '../../../src/routes/capacity';
import { Helpers } from '../../../src/utils/helpers';
import { UserRole } from '../../../src/types';

describe('M14: capacity route is mover-gated', () => {
  const app = () => { const a = express(); a.use(express.json()); a.use('/api/capacity', capacityRoutes); return a; };

  it('403 for a SHIPPER (not a mover)', async () => {
    const token = Helpers.generateToken({ userId: 's1', email: 's@x.test', role: UserRole.SHIPPER });
    const r = await request(app()).get('/api/capacity/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('401 unauthenticated', async () => {
    const r = await request(app()).get('/api/capacity/me');
    expect(r.status).toBe(401);
  });
});
