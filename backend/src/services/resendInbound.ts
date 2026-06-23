// Resend Inbound signature verification.
//
// Resend signs webhooks using the Svix scheme: the receiver computes
// HMAC-SHA256 over `<svix-id>.<svix-timestamp>.<rawBody>` with the
// webhook signing secret (RESEND_WEBHOOK_SECRET, format: 'whsec_xxx...').
// The expected value sits in svix-signature alongside one or more
// 'v1,<base64(sig)>' tokens. We accept any match.
//
// We reject:
//   - missing signing secret in prod (HARD fail; you can't accept
//     unsigned mail and call it auth-checked)
//   - timestamp outside ±5 minutes (replay defence)
//
// This is intentionally a small helper -- no Svix library dependency
// pulled in. svix supports rotation but Resend doesn't expose rotation
// at the dashboard yet, so one secret is enough.

import crypto from 'node:crypto';

const TOLERANCE_SECONDS = 60 * 5;

export interface VerifyResult {
  ok:    boolean;
  reason?: 'missing-secret' | 'missing-headers' | 'stale-timestamp' | 'bad-signature';
}

export function verifyResendSignature(params: {
  rawBody:   string;
  headers:   Record<string, string | string[] | undefined>;
  secret:    string | undefined;
  now?:      number;
}): VerifyResult {
  const secret = params.secret;
  if (!secret) return { ok: false, reason: 'missing-secret' };

  const id        = pickHeader(params.headers, 'svix-id') || pickHeader(params.headers, 'webhook-id');
  const timestamp = pickHeader(params.headers, 'svix-timestamp') || pickHeader(params.headers, 'webhook-timestamp');
  const sigHeader = pickHeader(params.headers, 'svix-signature') || pickHeader(params.headers, 'webhook-signature');
  if (!id || !timestamp || !sigHeader) return { ok: false, reason: 'missing-headers' };

  const now    = Math.floor((params.now ?? Date.now()) / 1000);
  const ts     = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  // Strip 'whsec_' prefix and base64-decode to get the raw HMAC key.
  const rawKey = secret.replace(/^whsec_/, '');
  const key    = Buffer.from(rawKey, 'base64');

  const signed = `${id}.${timestamp}.${params.rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signed).digest('base64');

  // sigHeader may carry multiple 'v1,<sig>' tokens space-separated.
  const tokens = sigHeader.split(/\s+/).map((t) => t.split(',')[1]).filter(Boolean);
  for (const t of tokens) {
    if (constantTimeEq(t, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad-signature' };
}

function pickHeader(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ba, bb);
}
