/**
 * Tally webhook signature verification.
 *
 * Tally signs each webhook POST with a `Tally-Signature` header containing
 * the base64 of HMAC-SHA256(rawBody, signingSecret). This mirrors the
 * Resend/Svix pattern in resendInbound.ts but Tally's scheme is simpler:
 * the HMAC is over the raw body alone (no id.timestamp prefix), and the
 * key is the signing secret string as-is (no whsec_ prefix, no base64
 * decode of the key).
 *
 * Reference: Tally docs - "Signing secret" under form → Integrations →
 * Webhooks. The header name is `Tally-Signature`.
 *
 * We reject:
 *   - missing secret (caller should treat this as "form not connected"
 *     and 503 rather than calling verify at all, but we fail closed here
 *     too)
 *   - missing header
 *   - signature mismatch (constant-time compare)
 */

import crypto from 'node:crypto';

export interface TallyVerifyResult {
  ok: boolean;
  reason?: 'missing-secret' | 'missing-header' | 'bad-signature';
}

export function verifyTallySignature(params: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  secret: string | undefined;
}): TallyVerifyResult {
  const secret = params.secret;
  if (!secret) return { ok: false, reason: 'missing-secret' };

  const sigHeader =
    pickHeader(params.headers, 'tally-signature') ||
    pickHeader(params.headers, 'Tally-Signature');
  if (!sigHeader) return { ok: false, reason: 'missing-header' };

  const expected = crypto
    .createHmac('sha256', secret)
    .update(params.rawBody, 'utf8')
    .digest('base64');

  if (constantTimeEq(sigHeader.trim(), expected)) return { ok: true };
  return { ok: false, reason: 'bad-signature' };
}

function pickHeader(
  h: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
