/**
 * Tally webhook ROUTE proofs — the signature-against-RAW-body guarantee,
 * idempotency, the not-connected inert state, and the optional source
 * header. Calls the real tallyWebhookHandler with a Buffer body (exactly
 * what express.raw() hands it in production).
 *
 * The headline proof: the HMAC is verified against the RAW bytes, NOT a
 * re-serialized body. We sign a raw string that has non-canonical
 * whitespace + key order; the handler accepts it because it hashes those
 * exact bytes. A re-serialized body (JSON.parse → JSON.stringify) produces
 * a DIFFERENT byte string and a DIFFERENT HMAC, so verifying a
 * re-serialized body against the original signature FAILS — which is the
 * whole reason raw capture matters.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { Request, Response } from 'express';

// In-memory DDB fake so ingestFromTally completes.
const stores: Record<string, Map<string, any>> = {};
function store(t: string) { return (stores[t] ??= new Map()); }

vi.mock('../../../src/config/database', () => ({
  Database: {
    putItem: vi.fn(async (table: string, item: any) => {
      store(table).set(item.applicationId ?? item.responseId ?? JSON.stringify(item), { ...item });
      return item;
    }),
    getItem: vi.fn(async () => null),
    query: vi.fn(async (table: string, _idx: string, _expr: string, names: any, values: any) => {
      const attr = Object.values(names)[0] as string;
      const want = Object.values(values)[0];
      return [...store(table).values()].filter(it => it[attr] === want);
    }),
    updateItem: vi.fn(async () => ({})),
    scan: vi.fn(async (table: string) => [...store(table).values()]),
  },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { tallyWebhookHandler } from '../../../src/routes/tallyWebhook';
import { _resetBetaConfigForTests } from '../../../src/config/beta';

const SECRET = 'tly_sign_secret_xyz';

function sign(raw: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
}

/** Raw body with NON-canonical formatting: extra spaces, newlines, and a
 *  key order JSON.stringify would not reproduce. Proves we hash raw bytes. */
function rawShipperBody(responseId: string): string {
  return [
    '{',
    '  "eventType": "FORM_RESPONSE",',
    `  "data": { "responseId": "${responseId}", "formId": "form-abc",`,
    '    "fields": [',
    '      {"key":"q1","label":"Which best describes you?","value":"Shipper"},',
    '      {"key":"q2","label":"Full name","value":"Sandra Shipper"},',
    '      {"key":"q3","label":"Work email","value":"sandra@shipco.com"},',
    '      {"key":"q7","label":"Do you primarily operate in Texas?","value":"Yes, mostly Texas"},',
    '      {"key":"q8","label":"How many shipments per week?","value":"20-50"},',
    '      {"key":"q13","label":"Are you actively running freight right now?","value":"Yes"},',
    '      {"key":"q14","label":"Will you join a short feedback call + weekly check-in?","value":"Yes"}',
    '    ] }',
    '}',
  ].join('\n');
}

function makeReqRes(rawBody: string, headers: Record<string, string>) {
  const req = {
    body: Buffer.from(rawBody, 'utf8'),   // exactly what express.raw() gives
    headers,
  } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

beforeEach(() => {
  for (const k of Object.keys(stores)) delete stores[k];
  delete process.env.TALLY_SIGNING_SECRET;
  delete process.env.TALLY_WEBHOOK_SECRET;
  delete process.env.TALLY_REQUIRE_SOURCE_HEADER;
  delete process.env.TALLY_FORM_ID;
  _resetBetaConfigForTests();
  vi.clearAllMocks();
});

describe('Tally webhook — not connected', () => {
  it('503 form_not_connected when no signing secret is set', async () => {
    _resetBetaConfigForTests();   // no secret in env
    const { req, res, status, json } = makeReqRes('{}', {});
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'form_not_connected' }));
  });
});

describe('Tally webhook — signature verifies against the RAW body', () => {
  beforeEach(() => {
    process.env.TALLY_SIGNING_SECRET = SECRET;
    _resetBetaConfigForTests();
  });

  it('accepts a correctly-signed raw body (non-canonical whitespace) → 201', async () => {
    const raw = rawShipperBody('resp-raw-1');
    const { req, res, status } = makeReqRes(raw, { 'tally-signature': sign(raw) });
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(201);
  });

  it('a re-serialized body does NOT match the raw-body signature (this is WHY raw capture matters)', async () => {
    const raw = rawShipperBody('resp-raw-2');
    const signatureOverRaw = sign(raw);

    // Re-serialize: parse then stringify → canonical bytes, different from raw.
    const reSerialized = JSON.stringify(JSON.parse(raw));
    expect(reSerialized).not.toBe(raw);                  // bytes differ
    expect(sign(reSerialized)).not.toBe(signatureOverRaw); // HMAC differs

    // Sending the re-serialized body with the raw-body signature → 401.
    const { req, res, status } = makeReqRes(reSerialized, { 'tally-signature': signatureOverRaw });
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a tampered body → 401', async () => {
    const raw = rawShipperBody('resp-raw-3');
    const sig = sign(raw);
    const { req, res, status } = makeReqRes(raw + ' ', { 'tally-signature': sig });
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a missing signature header → 401', async () => {
    const raw = rawShipperBody('resp-raw-4');
    const { req, res, status } = makeReqRes(raw, {});
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });
});

describe('Tally webhook — optional X-Beta-Source header', () => {
  beforeEach(() => {
    process.env.TALLY_SIGNING_SECRET = SECRET;
    process.env.TALLY_REQUIRE_SOURCE_HEADER = 'true';
    _resetBetaConfigForTests();
  });

  it('401 bad_source when the header is required but absent', async () => {
    const raw = rawShipperBody('resp-src-1');
    const { req, res, status, json } = makeReqRes(raw, { 'tally-signature': sign(raw) });
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'bad_source' }));
  });

  it('passes when X-Beta-Source=tally is present', async () => {
    const raw = rawShipperBody('resp-src-2');
    const { req, res, status } = makeReqRes(raw, {
      'tally-signature': sign(raw),
      'x-beta-source': 'tally',
    });
    await tallyWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(201);
  });
});

describe('Tally webhook — idempotency by responseId', () => {
  beforeEach(() => {
    process.env.TALLY_SIGNING_SECRET = SECRET;
    _resetBetaConfigForTests();
  });

  it('a repeated responseId does not create a second application (created:false)', async () => {
    const raw = rawShipperBody('resp-dup-1');
    const sig = sign(raw);

    const first = makeReqRes(raw, { 'tally-signature': sig });
    await tallyWebhookHandler(first.req, first.res);
    expect(first.status).toHaveBeenCalledWith(201);

    // Second identical delivery — getByResponseId now returns the existing row
    // (the in-memory fake's query GSI emulation returns it), so created=false.
    const second = makeReqRes(raw, { 'tally-signature': sig });
    await tallyWebhookHandler(second.req, second.res);
    expect(second.status).toHaveBeenCalledWith(200);
    expect(second.json).toHaveBeenCalledWith(expect.objectContaining({ created: false }));
  });
});
