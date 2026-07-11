/**
 * fieldCrypto: local-mode envelope round-trip (dev/CI path, no AWS), the
 * serialized version prefix, tamper detection, and TIN masking. Production KMS
 * mode is not exercised here (it needs a live KMS key); resolveMode('kms') is
 * 'local' outside production, which is what this suite asserts against.
 */
import { describe, it, expect } from 'vitest';
import { encryptField, decryptField, tinLast4 } from '../../../src/utils/fieldCrypto';

describe('fieldCrypto (local envelope mode)', () => {
  it('round-trips a TIN and never stores it in the clear', async () => {
    const tin = '12-3456789';
    const sealed = await encryptField(tin);
    expect(sealed.startsWith('l1:')).toBe(true);
    expect(sealed).not.toContain(tin);
    expect(sealed).not.toContain('3456789');
    expect(await decryptField(sealed)).toBe(tin);
  });

  it('produces a different ciphertext each time (random IV) but decrypts the same', async () => {
    const a = await encryptField('123-45-6789');
    const b = await encryptField('123-45-6789');
    expect(a).not.toBe(b);
    expect(await decryptField(a)).toBe('123-45-6789');
    expect(await decryptField(b)).toBe('123-45-6789');
  });

  it('fails to decrypt tampered ciphertext (GCM auth tag)', async () => {
    const sealed = await encryptField('123-45-6789');
    const parts = sealed.split(':');
    // Deterministically corrupt the ciphertext: decode, XOR a middle byte,
    // re-encode. (The old version flipped the LAST base64url char, which can
    // land entirely in padding bits and leave the decoded bytes unchanged -
    // the GCM tag then still verified and the test flaked ~audit v4 L3.)
    const buf = Buffer.from(parts[3], 'base64url');
    buf[Math.floor(buf.length / 2)] ^= 0xff;
    parts[3] = buf.toString('base64url');
    await expect(decryptField(parts.join(':'))).rejects.toThrow();
  });

  it('refuses to encrypt an empty value', async () => {
    await expect(encryptField('')).rejects.toThrow();
  });

  it('masks a TIN to its last 4 digits', () => {
    expect(tinLast4('123-45-6789')).toBe('6789');
    expect(tinLast4('12-3456789')).toBe('6789');
  });
});
