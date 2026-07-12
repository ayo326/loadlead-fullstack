/**
 * Canopy webhook signature verification (SCRUM-60).
 *
 * Scheme confirmed from Canopy's docs (recon A7 answered), a Stripe-style HMAC:
 *   header:         canopy-signature: t=<unix-seconds>,s=<hex-hmac-sha256>
 *   signed_payload: `${t}.${rawBody}`  (timestamp as string, a literal ".", the raw body)
 *   signature:      HMAC-SHA256(signingSecret, signed_payload), hex-encoded, compared to s
 *   replay:         reject if |now - t| exceeds the tolerance window
 * See https://docs.usecanopy.com/reference/verifying-webhook-signatures
 *
 * The comparison is constant-time. The secret and raw body are never logged.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

type Headers = Record<string, string | string[] | undefined>;

// Primary header is `canopy-signature`; accept an `x-` prefixed variant too in
// case a proxy rewrites it. Both carry the same `t=,s=` structure.
const HEADER_CANDIDATES = ['canopy-signature', 'x-canopy-signature'];

/** Reject events whose timestamp is more than this far from now (replay guard). */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

function header(headers: Headers, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

/** Parse `t=1645638136,s=abcd...` into its t (timestamp) and s (signature) parts. */
export function parseCanopySignatureHeader(raw: string): { t?: string; s?: string } {
  const out: { t?: string; s?: string } = {};
  for (const element of raw.split(',')) {
    const eq = element.indexOf('=');
    if (eq <= 0) continue;
    const key = element.slice(0, eq).trim();
    const value = element.slice(eq + 1).trim();
    if (key === 't') out.t = value;
    else if (key === 's') out.s = value;
  }
  return out;
}

export interface CanopyVerifyInput {
  rawBody: string;
  headers: Headers;
  secret: string | undefined;
  nowMs?: number;
}

export interface CanopyVerifyResult {
  ok: boolean;
  reason?: string;
  /** For observability (never a secret). */
  verifiedBy?: string;
}

export function verifyCanopySignature(input: CanopyVerifyInput): CanopyVerifyResult {
  const { rawBody, headers, secret } = input;
  if (!secret) return { ok: false, reason: 'no_secret' };

  let rawHeader: string | undefined;
  let headerName = '';
  for (const h of HEADER_CANDIDATES) {
    const v = header(headers, h);
    if (v) {
      rawHeader = v;
      headerName = h;
      break;
    }
  }
  if (!rawHeader) return { ok: false, reason: 'no_signature_header' };

  const { t, s } = parseCanopySignatureHeader(rawHeader);
  if (!t || !s) return { ok: false, reason: 'malformed_signature_header' };

  // Replay guard: t is unix seconds. Tolerate a seconds/millis mixup defensively.
  const tsNum = Number(t);
  if (Number.isFinite(tsNum)) {
    const now = input.nowMs ?? Date.now();
    const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
    if (Math.abs(now - tsMs) > REPLAY_WINDOW_MS) {
      return { ok: false, reason: 'timestamp_out_of_window' };
    }
  }

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  const provided = s.toLowerCase();
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' };
  return timingSafeEqual(a, b)
    ? { ok: true, verifiedBy: `${headerName}:t.s` }
    : { ok: false, reason: 'signature_mismatch' };
}
