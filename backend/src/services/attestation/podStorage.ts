// POD (proof-of-delivery) document serving - the private, signed-GET seam.
//
// Mirrors services/compliance/complianceStorage.ts (signedGetUrl) and the W9
// access-log pattern (ComplianceDocumentService.recordW9Access): the bytes live
// in a private S3 bucket and are handed out only as short-lived signed GET URLs,
// and every open is written to an append-only access log BEFORE the URL is
// issued (fail-closed - if the log write throws, no URL is returned).
//
// We never store a signed URL; callers pass the S3 key and we sign at serve time.

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Database } from '../../config/database';
import config from '../../config/environment';
import { Helpers } from '../../utils/helpers';
import { Logger } from '../../utils/logger';

// Region is read defensively so partial config mocks (test suites that stub
// config/environment without the pod block) don't crash at import time.
const s3 = new S3Client({ region: config.pod?.region ?? process.env.AWS_REGION ?? 'us-east-1' });

/**
 * Short-lived signed GET URL for a POD (or headshot) object in the POD bucket.
 * Default TTL is config.pod.signedGetTtlSeconds; headshot reads pass the longer
 * headshot TTL. The URL is ephemeral and must never be persisted.
 */
export async function signedPodGetUrl(
  key: string,
  ttlSeconds: number = config.pod?.signedGetTtlSeconds ?? 300,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: config.pod?.bucket ?? 'loadlead-pod-uploads', Key: key });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(s3 as any, cmd as any, { expiresIn: ttlSeconds });
}

export interface PodAccessLogEntry {
  accessId: string; // 'podacc_...'
  photoId: string;
  loadId: string;
  viewerAccountId: string;
  basis: string; // machine-readable authorization basis (ADMIN | CHAIN_PARTY)
  createdAt: number;
}

/**
 * Append-only record of a POD document open. Mirrors recordW9Access: called in
 * the serving path BEFORE the signed URL is generated, so a log-write failure
 * denies the read. Never mutated or deleted.
 */
export async function recordPodAccess(
  photoId: string,
  loadId: string,
  viewerAccountId: string,
  basis: string,
): Promise<PodAccessLogEntry> {
  const row: PodAccessLogEntry = {
    accessId: Helpers.generateId('podacc'),
    photoId,
    loadId,
    viewerAccountId,
    basis,
    createdAt: Helpers.getCurrentTimestamp(),
  };
  await Database.putItem(config.dynamodb.podAccessLogTable, row);
  Logger.info(`[pod] photo ${photoId} (load ${loadId}) opened by ${viewerAccountId} (${basis})`);
  return row;
}

/** Read-back for audits: every open of a given POD photo, newest first. */
export async function listPodAccess(photoId: string): Promise<PodAccessLogEntry[]> {
  const rows = await Database.scan<PodAccessLogEntry>(config.dynamodb.podAccessLogTable);
  return rows.filter((r) => r.photoId === photoId).sort((a, b) => b.createdAt - a.createdAt);
}
