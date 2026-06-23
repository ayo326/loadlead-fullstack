// SNS HTTPS subscription signature verification.
//
// SNS signs each notification with an X.509 cert. The receiver:
//   1. Pulls the cert from SigningCertURL (must be amazonaws.com)
//   2. Reconstructs the canonical signing string per AWS docs
//   3. Verifies the base64 SHA-1 (or SHA-256) signature with the cert's pubkey
//
// We restrict SigningCertURL to amazonaws.com hosts so an attacker can't
// trick us into trusting a cert hosted elsewhere.

import https from 'node:https';
import crypto from 'node:crypto';

const CERT_CACHE = new Map<string, string>();

const SIGN_FIELDS_NOTIFICATION = [
  'Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type',
];
const SIGN_FIELDS_SUBSCRIPTION = [
  'Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type',
];

function isAmazonHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:'
      && (u.hostname.endsWith('.amazonaws.com') || u.hostname === 'sns.amazonaws.com');
  } catch { return false; }
}

async function fetchCert(certUrl: string): Promise<string> {
  if (!isAmazonHost(certUrl)) {
    throw new Error(`refusing non-Amazon cert host: ${certUrl}`);
  }
  const cached = CERT_CACHE.get(certUrl);
  if (cached) return cached;
  const cert = await new Promise<string>((resolve, reject) => {
    https.get(certUrl, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
  CERT_CACHE.set(certUrl, cert);
  return cert;
}

export async function verifySnsMessage(msg: Record<string, any>): Promise<boolean> {
  const sigVersion = msg.SignatureVersion;
  if (sigVersion !== '1' && sigVersion !== '2') return false;
  const algo = sigVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256';

  const certUrl = msg.SigningCertURL;
  if (typeof certUrl !== 'string' || !isAmazonHost(certUrl)) return false;

  const cert = await fetchCert(certUrl);
  const sig  = msg.Signature;
  if (typeof sig !== 'string') return false;

  const fields = msg.Type === 'Notification' ? SIGN_FIELDS_NOTIFICATION : SIGN_FIELDS_SUBSCRIPTION;
  // Canonical string: for each field in order, if msg[field] is defined,
  // append "field\n<value>\n"
  let canonical = '';
  for (const f of fields) {
    if (msg[f] !== undefined && msg[f] !== null) {
      canonical += `${f}\n${msg[f]}\n`;
    }
  }
  const verifier = crypto.createVerify(algo);
  verifier.update(canonical, 'utf8');
  return verifier.verify(cert, sig, 'base64');
}

/** Hit the SubscribeURL once to confirm a new SNS subscription. */
export async function confirmSnsSubscription(subscribeUrl: string): Promise<boolean> {
  if (!isAmazonHost(subscribeUrl)) return false;
  await new Promise<void>((resolve, reject) => {
    https.get(subscribeUrl, (res) => {
      // 200 means SNS accepted the confirmation
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`SNS confirm returned ${res.statusCode}`));
    }).on('error', reject);
  });
  return true;
}
