/**
 * Connect nonce (SCRUM-60).
 *
 * A stateless, signed idempotency nonce we hand the frontend when it starts a
 * connect. The frontend attaches it (with the carrier id) as pull metadata; on
 * ingestion we validate it. Because it is HMAC-signed over the carrier id, a
 * forged pull carrying an arbitrary carrierId in its metadata cannot pass
 * validation, and no server-side session store is needed. The nonce also
 * doubles as a human-visible idempotency token, but true replay protection comes
 * from keying ingestion on the Canopy pull id.
 *
 * Never logged. The secret is the Canopy webhook secret if set, else the JWT
 * secret (both are server-side only).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import config from '../../config/environment';
import canopyConfig from '../../config/canopyConfig';

/** Nonces are accepted for this long after issue (the connect flow is minutes). */
const NONCE_TTL_MS = 60 * 60 * 1000; // 1 hour

function secret(): string {
  return canopyConfig.webhookSecret || config.jwt.secret || 'dev-canopy-nonce-secret';
}

function sign(carrierId: string, issuedAtMs: number): string {
  return createHmac('sha256', secret()).update(`${carrierId}.${issuedAtMs}`).digest('hex');
}

/** Issue a nonce bound to a carrier. Format: base64url("issuedAtMs.sigHex"). */
export function issueNonce(carrierId: string, issuedAtMs: number = Date.now()): string {
  const sig = sign(carrierId, issuedAtMs);
  return Buffer.from(`${issuedAtMs}.${sig}`, 'utf8').toString('base64url');
}

/**
 * Validate a nonce against the carrier it claims to belong to. Returns false on
 * any malformed, mismatched, or expired nonce. Constant-time signature compare.
 */
export function verifyNonce(nonce: string, carrierId: string, nowMs: number = Date.now()): boolean {
  if (!nonce || !carrierId) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(nonce, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const dot = decoded.indexOf('.');
  if (dot <= 0) return false;
  const issuedAtMs = Number(decoded.slice(0, dot));
  const sig = decoded.slice(dot + 1);
  if (!Number.isFinite(issuedAtMs) || !sig) return false;
  if (nowMs - issuedAtMs > NONCE_TTL_MS || issuedAtMs - nowMs > 5 * 60 * 1000) return false;

  const expected = sign(carrierId, issuedAtMs);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
