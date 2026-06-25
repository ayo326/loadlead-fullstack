// Signature service — record + chain reads.
//
// IMMUTABILITY — defense in depth:
//   1. IAM (runtime) Deny on UpdateItem/DeleteItem/BatchWriteItem on
//      LoadLead_Signatures (see infra/terraform/modules/iam_signatures/).
//   2. PutItem ALWAYS carries ConditionExpression `attribute_not_exists(signatureId)`
//      so a duplicate Put is rejected at the DDB API even with full Put rights.
//   3. ESLint rule denies imports of UpdateCommand / DeleteCommand /
//      BatchWriteCommand in this folder — guarded at authoring time.
//
// Corrections are NEW rows with `correctsSignatureId`. There is no
// "update" code path. There is no "delete" code path.

import { randomUUID, createHash } from 'node:crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../config/aws';
import config from '../../config/environment';
import { AppError } from '../../middleware/errorHandler';
import type { Load } from '../../types';
import type {
  AttestationAction,
  ExceptionsRecord,
  ProofPhoto,
  Signature,
  SignatureType,
  SignerRole,
} from '../../types/signatures';
import { canonicalize } from './canonicalize';
import { latestStatement } from './attestationStatements';
import type { ProjectionInput, ResolvedCoR } from './projections/v1';

export interface RecordSignatureInput {
  load:           Load;
  bolId?:         string;
  action:         AttestationAction;

  signerUserId:   string;
  signerRole:     SignerRole;

  signatureType:  SignatureType;
  signatureData:  string;
  consentGiven:   boolean;     // must be true

  ipAddress?:     string;
  userAgent?:     string;

  // Projection inputs (the parts the projector consumes beyond `load`).
  shipperOrgId?:  string | null;
  shipperUserId?: string | null;
  carrierOfRecord?: ResolvedCoR | null;
  assignedDriverId?: string | null;
  photos?:        ProofPhoto[];
  exceptions?:    ExceptionsRecord;
  actualAt?:      string;
  geo?:           { lat: number; lng: number } | null;

  // Optional pointer to the signature this row corrects. Per the append-
  // only contract there are no UPDATE rows — a correction is a NEW row
  // that names the row it's superseding. The selector in requireSignature
  // (newest matching signature wins) lets the corrected row remain in
  // the chain for audit purposes while the new row takes effect.
  correctsSignatureId?: string;
}

/**
 * Record a signature. Pure append: throws if the row already exists
 * (attribute_not_exists guard). Never updates. Never deletes.
 */
export async function recordSignature(input: RecordSignatureInput): Promise<Signature> {
  if (input.consentGiven !== true) {
    throw new AppError('CONSENT_REQUIRED: consent must be explicitly granted', 400);
  }

  const statement = latestStatement(input.action);

  // Build the projection input and compute the documentHash. A photo
  // that isn't finalized causes canonicalize() to throw a structured
  // error — that's the proof of the synchronous finalize ordering.
  const projInput: ProjectionInput = {
    load:               input.load,
    bol:                input.bolId ? { bolId: input.bolId } : null,
    shipperOrgId:       input.shipperOrgId ?? null,
    shipperUserId:      input.shipperUserId ?? null,
    carrierOfRecord:    input.carrierOfRecord ?? null,
    assignedDriverId:   input.assignedDriverId ?? null,
    photos:             input.photos,
    exceptions:         input.exceptions ? { code: input.exceptions.code, description: input.exceptions.description } : null,
    actualAt:           input.actualAt,
    geo:                input.geo ?? null,
  };
  const { documentHash, canonicalSchemaVersion } = canonicalize(input.action, projInput);

  const signatureId = randomUUID();
  const signedAt = new Date().toISOString();
  const proofPhotoIds = (input.photos ?? []).map((p) => p.photoId);

  const sig: Signature = {
    signatureId,
    loadId:                 input.load.loadId,
    bolId:                  input.bolId,
    signerUserId:           input.signerUserId,
    signerRole:             input.signerRole,
    action:                 input.action,
    attestationText:        statement.text,
    attestationVersion:     statement.version,
    canonicalSchemaVersion,
    signatureType:          input.signatureType,
    signatureData:          input.signatureData,
    consentGiven:           true,
    signedAt,
    ipAddress:              input.ipAddress,
    userAgent:              input.userAgent,
    documentHash,
    proofPhotoIds,
    exceptions:             input.exceptions,
    // CARRIER_ACCEPT carries the assigned driver. Stored top-level for
    // queryability by the dispatch endpoint. The projection input has
    // the same value; the recordSignature contract guarantees both agree.
    assignedDriverId:       input.assignedDriverId ?? undefined,
    // Correction pointer. Persisted on the new row so the chain READ can
    // surface that this signature corrects an earlier one without a
    // separate join. requireSignature treats the latest row as
    // authoritative; the older row stays in the chain for audit.
    correctsSignatureId:    input.correctsSignatureId,
    createdAt:              Date.now(),
  };

  try {
    await docClient.send(new PutCommand({
      TableName: config.dynamodb.signaturesTable,
      Item: sig as unknown as Record<string, unknown>,
      // Defense-in-depth layer 2: even with full PutItem permission, a
      // duplicate signatureId is rejected by DDB. App code never reuses
      // ids; this guards against id collisions and PutItem-as-update.
      ConditionExpression: 'attribute_not_exists(signatureId)',
    }));
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') {
      throw new AppError('SIGNATURE_DUPLICATE: signatureId collision', 409);
    }
    throw e;
  }

  return sig;
}

/** Ordered attestation chain for a load (oldest first). Read-only. */
export async function getChain(loadId: string): Promise<Signature[]> {
  const res = await docClient.send(new QueryCommand({
    TableName: config.dynamodb.signaturesTable,
    IndexName: 'loadId-signedAt-index',
    KeyConditionExpression: 'loadId = :l',
    ExpressionAttributeValues: { ':l': loadId },
    ScanIndexForward: true, // oldest first
  }));
  return (res.Items ?? []) as Signature[];
}

/** Helper for callers that need a stable fingerprint of the signature. */
export function fingerprint(sig: Signature): string {
  return createHash('sha256')
    .update(`${sig.signatureId}|${sig.documentHash}|${sig.signedAt}`)
    .digest('hex')
    .slice(0, 16);
}
