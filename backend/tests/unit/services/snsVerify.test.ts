/**
 * H12 (audit v6): the SNS webhook signature verifier had zero coverage. It is a trust
 * boundary (an inbound-email/SNS path), so both the fail-closed guards (bad version,
 * non-Amazon cert host) and the real signature check must be pinned.
 *
 * The only I/O is https.get inside fetchCert; we mock node:https and feed it an in-test
 * RSA public key so the real crypto.verify runs against a signature we produced.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

// Mutable cert body the mocked https.get streams back.
let CERT_PEM = '';
vi.mock('node:https', () => ({
  default: {
    get: (_url: string, cb: (res: any) => void) => {
      const res = new EventEmitter();
      cb(res);
      queueMicrotask(() => { res.emit('data', Buffer.from(CERT_PEM, 'utf8')); res.emit('end'); });
      return new EventEmitter(); // supports .on('error', …)
    },
  },
}));

import { verifySnsMessage } from '../../../src/services/snsVerify';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const NOTIFICATION_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
function canonical(msg: Record<string, any>): string {
  let s = '';
  for (const f of NOTIFICATION_FIELDS) if (msg[f] !== undefined && msg[f] !== null) s += `${f}\n${msg[f]}\n`;
  return s;
}
let certSeq = 0; // unique cert URL per test so the module-level CERT_CACHE doesn't bleed
function signedMessage(overrides: Record<string, any> = {}) {
  const msg: Record<string, any> = {
    Type: 'Notification', SignatureVersion: '2',
    SigningCertURL: `https://sns.us-east-1.amazonaws.com/cert-${certSeq++}.pem`,
    Message: 'hello', MessageId: 'mid-1', Timestamp: '2026-07-15T00:00:00.000Z',
    TopicArn: 'arn:aws:sns:us-east-1:1:topic', ...overrides,
  };
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonical(msg), 'utf8');
  msg.Signature = signer.sign(privateKey, 'base64');
  return msg;
}

describe('verifySnsMessage - fail-closed guards (no network)', () => {
  it('rejects an unknown SignatureVersion', async () => {
    expect(await verifySnsMessage({ SignatureVersion: '9', SigningCertURL: 'https://sns.amazonaws.com/c.pem' })).toBe(false);
  });
  it('rejects a non-Amazon SigningCertURL (cert-host allowlist)', async () => {
    expect(await verifySnsMessage({ SignatureVersion: '2', SigningCertURL: 'https://evil.example.com/c.pem', Signature: 'x' })).toBe(false);
  });
  it('rejects a non-https (http) cert URL', async () => {
    expect(await verifySnsMessage({ SignatureVersion: '2', SigningCertURL: 'http://sns.amazonaws.com/c.pem', Signature: 'x' })).toBe(false);
  });
  it('rejects a missing/short SigningCertURL', async () => {
    expect(await verifySnsMessage({ SignatureVersion: '1', SigningCertURL: 12345 as any })).toBe(false);
  });
});

describe('verifySnsMessage - real signature check', () => {
  it('accepts a correctly-signed message (cert fetched from an Amazon host)', async () => {
    CERT_PEM = publicKey;
    expect(await verifySnsMessage(signedMessage())).toBe(true);
  });
  it('rejects a message whose body was tampered after signing', async () => {
    CERT_PEM = publicKey;
    const msg = signedMessage();
    msg.Message = 'tampered'; // signature no longer matches the canonical string
    expect(await verifySnsMessage(msg)).toBe(false);
  });
});
