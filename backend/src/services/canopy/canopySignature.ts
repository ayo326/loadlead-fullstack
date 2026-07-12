/**
 * Canopy webhook signature verification (SCRUM-60).
 *
 * Canopy's exact signature scheme is not published (recon question A7), so this
 * verifier is defensive and CONFIG-DRIVEN: it tries the common header names and
 * both HMAC-SHA256 encodings (hex and base64), over the raw body and, when a
 * timestamp header is present, over `${timestamp}.${rawBody}`. The moment the
 * Canopy contact confirms the real scheme, this collapses to that one recipe
 * with zero change anywhere else in the pipeline.
 *
 * The comparison is constant-time. The secret and the raw body are never logged.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

type Headers = Record<string, string | string[] | undefined>;

const SIGNATURE_HEADERS = [
  'x-canopy-signature',
  'x-canopy-signature-256',
  'x-canopy-webhook-signature',
  'x-webhook-signature',
  'x-hub-signature-256',
  'x-signature',
];

const TIMESTAMP_HEADERS = ['x-canopy-timestamp', 'x-timestamp', 'x-canopy-request-timestamp'];

/** Replays older than this (when a timestamp header is present) are rejected. */
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

function header(headers: Headers, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

function stripPrefix(sig: string): string {
  // Accept "sha256=<hex>" as well as a bare signature.
  const eq = sig.indexOf('=');
  if (eq > 0 && /^sha\d+$/i.test(sig.slice(0, eq))) return sig.slice(eq + 1);
  return sig;
}

function equalStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
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
  /** Which header + encoding matched, for observability (never a secret). */
  verifiedBy?: string;
}

export function verifyCanopySignature(input: CanopyVerifyInput): CanopyVerifyResult {
  const { rawBody, headers, secret } = input;
  if (!secret) return { ok: false, reason: 'no_secret' };

  // Find the presented signature header.
  let presented: string | undefined;
  let presentedHeader = '';
  for (const h of SIGNATURE_HEADERS) {
    const v = header(headers, h);
    if (v) {
      presented = stripPrefix(v);
      presentedHeader = h;
      break;
    }
  }
  if (!presented) return { ok: false, reason: 'no_signature_header' };

  // Optional timestamp (replay protection when Canopy sends one).
  const tsRaw = TIMESTAMP_HEADERS.map((h) => header(headers, h)).find(Boolean);
  if (tsRaw) {
    const ts = Number(tsRaw);
    if (Number.isFinite(ts)) {
      const now = input.nowMs ?? Date.now();
      // Accept both seconds and milliseconds epochs.
      const tsMs = ts < 1e12 ? ts * 1000 : ts;
      if (Math.abs(now - tsMs) > REPLAY_WINDOW_MS) {
        return { ok: false, reason: 'timestamp_out_of_window' };
      }
    }
  }

  // Candidate signed payloads: raw body, and (if a timestamp is present)
  // `${ts}.${rawBody}` - the two common recipes.
  const payloads = tsRaw ? [rawBody, `${tsRaw}.${rawBody}`] : [rawBody];
  for (const payload of payloads) {
    const hmac = createHmac('sha256', secret).update(payload, 'utf8');
    const hex = hmac.digest('hex');
    const b64 = createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
    if (equalStr(presented, hex)) return { ok: true, verifiedBy: `${presentedHeader}:hex` };
    if (equalStr(presented, b64)) return { ok: true, verifiedBy: `${presentedHeader}:base64` };
  }
  return { ok: false, reason: 'signature_mismatch' };
}
