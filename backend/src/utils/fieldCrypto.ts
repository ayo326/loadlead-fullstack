/**
 * Field-level envelope encryption for the most sensitive value on the platform:
 * the W9 TIN. Never store a TIN in plaintext; never log it; show only the last 4
 * outside the gated full-document view.
 *
 * Envelope encryption, KMS-backed:
 *   - live mode: AWS KMS GenerateDataKey issues a one-time 256-bit data key; the
 *     plaintext is sealed with AES-256-GCM under that data key, and only the
 *     KMS-encrypted data key is persisted alongside the ciphertext. Decrypt asks
 *     KMS to unwrap the data key, then opens the GCM box. The root key never
 *     leaves KMS.
 *   - local mode (dev/CI, non-production only): a deterministic key derived from
 *     a local secret via scrypt, so tests encrypt/decrypt without calling AWS.
 *
 * The mode is resolved through the single production-locked resolver: in
 * production resolveMode('kms') returns 'live' unconditionally, so a non-prod
 * local key can never be used to seal a production TIN. If live mode is active
 * but no KMS key id is configured, encryption fails closed (throws) rather than
 * silently downgrading.
 *
 * Serialized form (colon-joined, base64url parts):
 *   live:  k1:<kmsEncryptedDataKey>:<iv>:<authTag>:<ciphertext>
 *   local: l1:<iv>:<authTag>:<ciphertext>
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import config from '../config/environment';
import { resolveMode } from '../services/integrations/modeResolver';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_BYTES = 16; // GCM authentication tag length, pinned explicitly
const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

function isLive(): boolean {
  return resolveMode('kms') === 'live';
}

/** Deterministic 32-byte local key (non-production only). */
function localKey(): Buffer {
  const secret =
    process.env.LOCAL_FIELD_CRYPTO_SECRET || process.env.JWT_SECRET || 'dev-field-crypto-secret';
  return scryptSync(secret, 'loadlead-field-crypto-v1', 32);
}

function sealWithKey(key: Buffer, plaintext: string): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ct };
}

function openWithKey(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// KMS client is loaded lazily and only in live mode, so dev/CI never need the
// dependency loaded or AWS reachable.
async function kmsClient() {
  const { KMSClient } = await import('@aws-sdk/client-kms');
  return new KMSClient({ region: config.aws.region });
}

/**
 * Encrypt a sensitive field value (the W9 TIN). Returns the serialized envelope.
 * Throws in live mode if no KMS key id is configured (fail closed).
 */
export async function encryptField(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('fieldCrypto: refusing to encrypt an empty value');

  if (!isLive()) {
    const { iv, tag, ct } = sealWithKey(localKey(), plaintext);
    return ['l1', b64(iv), b64(tag), b64(ct)].join(':');
  }

  const keyId = config.kms.w9TinKeyId;
  if (!keyId) {
    throw new Error('fieldCrypto: KMS mode is live but W9_TIN_KMS_KEY_ID is not set (fail closed)');
  }
  const { GenerateDataKeyCommand } = await import('@aws-sdk/client-kms');
  const client = await kmsClient();
  const dk = await client.send(new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }));
  const dataKey = Buffer.from(dk.Plaintext as Uint8Array);
  try {
    const { iv, tag, ct } = sealWithKey(dataKey, plaintext);
    return ['k1', b64(dk.CiphertextBlob as Uint8Array), b64(iv), b64(tag), b64(ct)].join(':');
  } finally {
    dataKey.fill(0); // scrub the plaintext data key from memory
  }
}

/** Decrypt a value produced by encryptField. */
export async function decryptField(serialized: string): Promise<string> {
  const parts = serialized.split(':');
  const version = parts[0];

  if (version === 'l1') {
    const [, iv, tag, ct] = parts;
    return openWithKey(localKey(), unb64(iv), unb64(tag), unb64(ct));
  }

  if (version === 'k1') {
    const [, encDek, iv, tag, ct] = parts;
    const { DecryptCommand } = await import('@aws-sdk/client-kms');
    const client = await kmsClient();
    const out = await client.send(
      new DecryptCommand({ CiphertextBlob: unb64(encDek), KeyId: config.kms.w9TinKeyId || undefined }),
    );
    const dataKey = Buffer.from(out.Plaintext as Uint8Array);
    try {
      return openWithKey(dataKey, unb64(iv), unb64(tag), unb64(ct));
    } finally {
      dataKey.fill(0);
    }
  }

  throw new Error(`fieldCrypto: unknown envelope version "${version}"`);
}

/** Last 4 digits of a TIN (SSN or EIN) for masked display. Digits only. */
export function tinLast4(tin: string): string {
  const digits = (tin || '').replace(/\D/g, '');
  return digits.slice(-4);
}
