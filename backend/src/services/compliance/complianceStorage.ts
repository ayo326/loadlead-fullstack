/**
 * Private S3 object storage for compliance documents (W9, COI, Letter of
 * Authority). Objects are never public; reads are served by short-lived signed
 * URLs. Mirrors the POD photo storage seam. Kept as a thin, mockable module so
 * services depend on putObject/signedGetUrl rather than the AWS SDK directly.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET = process.env.COMPLIANCE_S3_BUCKET || 'loadlead-compliance-docs';

/** Signed-URL lifetime for a compliance-document read (seconds). */
export const SIGNED_URL_TTL = 300;

/** Store a private object and return its key. */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<string> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

/** Short-lived signed GET URL for a stored object. */
export async function signedGetUrl(key: string, expiresIn: number = SIGNED_URL_TTL): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3 as any, cmd as any, { expiresIn });
}
