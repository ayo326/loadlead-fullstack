// SEC-H7 (audit v6): the public POST /api/webhooks/didit handler wrote
// idvStatus/kybStatus/amlStatus keyed on the request body but, when
// DIDIT_WEBHOOK_SECRET was unset, only logged a warning and proceeded -
// an unsigned event could forge a VERIFIED entity. The fix fails closed in
// production (mirrors the Canopy webhook). This suite pins that behavior.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  Database: { getItem: vi.fn(async () => null), putItem: vi.fn(async () => undefined), query: vi.fn(async () => [] as any[]) },
}));
vi.mock('../../../src/config/aws', () => ({ docClient: { send: vi.fn(async () => undefined) } }));
vi.mock('../../../src/config/environment', () => ({ default: { dynamodb: {} } }));

import { diditWebhookHandler } from '../../../src/services/verification';

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('SEC-H7: Didit webhook fails closed without a secret', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; });

  it('returns 401 in production when DIDIT_WEBHOOK_SECRET is unset', async () => {
    process.env.APP_ENV = 'production';
    delete process.env.DIDIT_WEBHOOK_SECRET;
    const req: any = {
      body: { vendor_data: 'victim-entity', status: 'Approved', webhook_type: 'business.status.updated' },
      headers: {},
    };
    const res = mockRes();
    await diditWebhookHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'webhook_not_configured' }));
  });

  it('does not 401 a Didit test event (early bypass is unchanged)', async () => {
    process.env.APP_ENV = 'production';
    delete process.env.DIDIT_WEBHOOK_SECRET;
    const req: any = { body: { metadata: { test_webhook: true } }, headers: {} };
    const res = mockRes();
    await diditWebhookHandler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ test: true }));
  });
});
