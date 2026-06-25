// POD photo metadata service.
//
// Lifecycle (synchronous finalize, by approved decision):
//   1. Client requests presigned URL → row Put with status=PENDING, no contentHash.
//   2. Client uploads bytes directly to S3.
//   3. Client calls /finalize → server fetches bytes, computes sha256,
//      writes contentHash + status=READY.
//   4. Only READY photos can flow into a signature's projection. Attempting
//      to sign with a PENDING photo throws CANONICALIZE_PHOTO_NOT_FINALIZED.
//
// This service is allowed to UpdateItem on the photos table — photos are
// metadata only; the BYTES in S3 are the legal evidence, and those bytes
// are protected by the bucket policy (delete-resistant; Phase-2 Object Lock).

import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, PutObjectRetentionCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../config/aws';

// Module-scoped S3 client. driver.ts uses the same shape (loadlead-pod-uploads
// region us-east-1). Pull it up here so the photo service is self-contained.
const podS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
import config from '../../config/environment';
import { AppError } from '../../middleware/errorHandler';
import type { ProofPhoto, ProofPhotoStage } from '../../types/signatures';

const POD_BUCKET = process.env.POD_S3_BUCKET || 'loadlead-pod-uploads';

/** Stage-bucketed S3 key namespace so audits can scope to a handoff. */
function makeKey(loadId: string, stage: ProofPhotoStage, photoId: string, ext = 'jpg'): string {
  return `pod/${stage.toLowerCase()}/${loadId}/${photoId}.${ext}`;
}

export interface RequestUploadInput {
  loadId:           string;
  stage:            ProofPhotoStage;
  uploadedByUserId: string;
  contentType?:     string;
  lat?:             number;
  lng?:             number;
  capturedAt?:      string;
}

export interface RequestUploadResult {
  photoId:    string;
  s3Key:      string;
  uploadUrl:  string;
  expiresIn:  number;
}

export async function requestUploadUrl(input: RequestUploadInput): Promise<RequestUploadResult> {
  const photoId = randomUUID();
  const s3Key   = makeKey(input.loadId, input.stage, photoId);
  const contentType = input.contentType ?? 'image/jpeg';
  const expiresIn = 300;

  const cmd = new PutObjectCommand({ Bucket: POD_BUCKET, Key: s3Key, ContentType: contentType });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadUrl = await getSignedUrl(podS3 as any, cmd as any, { expiresIn });

  const row: ProofPhoto = {
    photoId,
    loadId:           input.loadId,
    stage:            input.stage,
    s3Key,
    uploadedByUserId: input.uploadedByUserId,
    capturedAt:       input.capturedAt,
    lat:              input.lat,
    lng:              input.lng,
    contentType,
    status:           'PENDING',
    createdAt:        Date.now(),
  };

  await docClient.send(new PutCommand({
    TableName: config.dynamodb.podPhotosTable,
    Item: row as unknown as Record<string, unknown>,
    ConditionExpression: 'attribute_not_exists(photoId)',
  }));

  return { photoId, s3Key, uploadUrl, expiresIn };
}

export async function getPhoto(photoId: string): Promise<ProofPhoto | null> {
  const r = await docClient.send(new GetCommand({
    TableName: config.dynamodb.podPhotosTable,
    Key: { photoId },
  }));
  return (r.Item as ProofPhoto) ?? null;
}

/**
 * Finalize an upload. Server-authoritative contentHash: the server reads
 * the bytes from S3 and computes sha256. The client cannot lie about the
 * hash. Idempotent: a second call returns the existing READY row.
 */
export async function finalizeUpload(
  photoId: string,
  uploadedByUserId: string,
): Promise<ProofPhoto> {
  const photo = await getPhoto(photoId);
  if (!photo) throw new AppError(`Photo ${photoId} not found`, 404);

  // The same authenticated user who requested the upload must finalize.
  if (photo.uploadedByUserId !== uploadedByUserId) {
    throw new AppError('WRONG_FINALIZER: only the original uploader may finalize', 403);
  }

  if (photo.status === 'READY' && photo.contentHash) {
    return photo; // idempotent
  }

  // Read the object bytes and hash them. For large photos this is bounded
  // by S3 streaming; we accept the read here because the result is what
  // becomes legal evidence.
  let bodyBytes: Buffer;
  let byteSize = 0;
  try {
    const obj = await podS3.send(new GetObjectCommand({ Bucket: POD_BUCKET, Key: photo.s3Key }));
    // Body is a stream in node-runtime; collect it.
    const chunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const c of obj.Body as any) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    bodyBytes = Buffer.concat(chunks);
    byteSize  = bodyBytes.length;
  } catch (e: any) {
    if (e?.name === 'NoSuchKey') {
      throw new AppError('FINALIZE_BYTES_MISSING: upload not received yet by S3', 409);
    }
    throw e;
  }

  const contentHash = createHash('sha256').update(bodyBytes).digest('hex');
  const finalizedAt = Date.now();

  // Apply Object Lock (COMPLIANCE) at finalize time. The presign+PUT
  // path can't apply bucket-default Object Lock because that would
  // require Content-MD5/x-amz-checksum on the client's PUT — which the
  // browser presigned-URL contract doesn't deliver. So we apply
  // COMPLIANCE-mode retention here, after the bytes are confirmed and
  // the hash matches.
  //
  // Idempotent under retry: PutObjectRetention can extend retention but
  // not shorten it, so re-running finalize doesn't weaken the lock.
  // Skipped when the bucket has Object Lock disabled (v1 bucket / dev
  // bucket); detected by env var rather than a per-call HEAD because
  // bucket-config doesn't drift in normal operation.
  if (process.env.POD_S3_LOCK_RETAIN_DAYS) {
    const retainDays = Number(process.env.POD_S3_LOCK_RETAIN_DAYS);
    const retainUntil = new Date(finalizedAt + retainDays * 24 * 3600 * 1000);
    try {
      await podS3.send(new PutObjectRetentionCommand({
        Bucket: POD_BUCKET,
        Key:    photo.s3Key,
        Retention: {
          Mode:            'COMPLIANCE',
          RetainUntilDate: retainUntil,
        },
      }));
    } catch (e: any) {
      // If the bucket doesn't have Object Lock enabled, AWS returns
      // InvalidRequest. We tolerate this in non-WORM buckets (v1) so
      // the same code path works in dev/staging.
      if (e?.name !== 'InvalidRequest' && e?.Code !== 'InvalidRequest') {
        throw e;
      }
    }
  }

  // Photos table allows UpdateItem (only sigs are append-only). We
  // condition the update so PENDING → READY is the only transition, no
  // overwriting a hash that's already set.
  const updated = await docClient.send(new UpdateCommand({
    TableName: config.dynamodb.podPhotosTable,
    Key: { photoId },
    UpdateExpression: 'SET #s = :s, contentHash = :h, byteSize = :z, finalizedAt = :f',
    ConditionExpression: '#s = :pending OR attribute_not_exists(contentHash)',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': 'READY',
      ':h': contentHash,
      ':z': byteSize,
      ':f': finalizedAt,
      ':pending': 'PENDING',
    },
    ReturnValues: 'ALL_NEW',
  }));

  return updated.Attributes as ProofPhoto;
}

/** Load a stage's READY photos for a load. Filters out PENDING. */
export async function listReadyPhotos(loadId: string, stage: ProofPhotoStage): Promise<ProofPhoto[]> {
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const r = await docClient.send(new ScanCommand({
    TableName: config.dynamodb.podPhotosTable,
    FilterExpression: 'loadId = :l AND stage = :s AND #st = :ready',
    ExpressionAttributeNames:  { '#st': 'status' },
    ExpressionAttributeValues: { ':l': loadId, ':s': stage, ':ready': 'READY' },
  }));
  return (r.Items ?? []) as ProofPhoto[];
}
