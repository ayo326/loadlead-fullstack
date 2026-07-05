// Attestation signatures + proof photos.
//
// Designed for ESIGN/UETA + non-repudiation. The Signature record is
// append-only at the data layer (IAM deny UpdateItem/DeleteItem, PutItem
// uses `attribute_not_exists(signatureId)`, app code never imports
// UpdateCommand/DeleteCommand - enforced by an ESLint rule scoped to
// services/attestation/*). Corrections are NEW records that carry
// `correctsSignatureId`.
//
// Each Signature is bound to:
//   - `documentHash` - sha256 of the action-specific canonical projection
//     of the load+bol state at signing time. Per-action allowlist; sorted
//     keys; normalized types; photos referenced by contentHash, never URL.
//   - `proofPhotoIds[]` - ids of the photos taken FOR this handoff. Each
//     photo carries its own `contentHash` so the signature transitively
//     binds the bytes.
//
// Two version axes travel with every record:
//   - `attestationVersion` - version of the legal text the human signed.
//   - `canonicalSchemaVersion` - version of the projection used to compute
//     documentHash. Lets the projection evolve without orphaning records.

export type AttestationAction =
  | 'BOL_SUBMIT'        // shipper certifying BOL accuracy → unlocks broadcast
  | 'CARRIER_ACCEPT'    // carrier/OO accepting + assigning a driver
  | 'DRIVER_PICKUP'     // assigned driver certifying pickup
  | 'DRIVER_DELIVER'    // assigned driver certifying delivery
  | 'RECEIVER_CONFIRM'; // receiver certifying receipt (with optional OS&D)

export type SignerRole =
  | 'SHIPPER'           // shipper user OR org-side OWNER/MANAGER
  | 'CARRIER_ADMIN'     // CARRIER_ADMIN role OR org OWNER/MANAGER
  | 'OWNER_OPERATOR'
  | 'DRIVER'
  | 'RECEIVER';

export type SignatureType = 'typed' | 'drawn' | 'click';

export type ProofPhotoStage = 'ORIGIN' | 'PICKUP' | 'DELIVERY' | 'RECEIPT';

export interface ExceptionsRecord {
  /** OS&D code per industry convention */
  code: 'OSD' | 'DAMAGE' | 'SHORT' | 'REFUSED' | 'OTHER';
  description: string;
}

/**
 * Append-only. Never updated. Never deleted. A correction is a new row
 * that points back via `correctsSignatureId`.
 *
 * Keys: PK = signatureId. GSI = loadId-signedAt-index for chain reads.
 */
export interface Signature {
  signatureId:           string;
  loadId:                string;
  bolId?:                string;

  signerUserId:          string;    // The exact User who clicked sign.
  signerRole:            SignerRole; // Role at signing time (org or user role).

  action:                AttestationAction;

  attestationText:       string;
  attestationVersion:    string;    // legal text version
  canonicalSchemaVersion:string;    // projection version

  signatureType:         SignatureType;
  signatureData:         string;    // base64 PNG (drawn) | typed name | "I AGREE"
  consentGiven:          true;      // must be true; non-true rejected at the API

  signedAt:              string;    // ISO 8601 server clock
  ipAddress?:            string;
  userAgent?:            string;

  /** sha256 hex of the canonical projection (action-specific) */
  documentHash:          string;
  /** Photos taken for this handoff. Order is preserved; contentHashes also fold into documentHash. */
  proofPhotoIds:         string[];

  exceptions?:           ExceptionsRecord;

  /**
   * CARRIER_ACCEPT only: the driver the carrier is assigning. Stored as a
   * top-level field (not just inside the canonical projection input) so
   * the dispatch endpoint can query it without re-computing the hash.
   * Present in the projection too; the two MUST agree at write time.
   */
  assignedDriverId?:     string;

  correctsSignatureId?:  string;    // points to the row this corrects (audit chain)

  createdAt:             number;    // epoch ms; never updated
}

/**
 * Per-photo metadata. Bytes live in S3 (loadlead-pod-uploads). This row
 * is the application's view of "ready to be referenced by a Signature."
 *
 * Lifecycle:
 *   1. Client requests presigned URL → row is created with status='PENDING'
 *      and no contentHash.
 *   2. Client PUTs to S3.
 *   3. Client calls /pod/finalize → server reads the bytes, computes
 *      sha256, sets contentHash, transitions status='READY'.
 *   4. Only READY photos can be referenced by a Signature. A signing
 *      attempt that references a PENDING photo is rejected.
 *
 * This sequencing is the whole point of the synchronous finalize-upload
 * approach - there is never a window where a signature could bind a
 * photo whose contentHash isn't known to the server.
 */
export interface ProofPhoto {
  photoId:           string;
  loadId:            string;
  stage:             ProofPhotoStage;
  s3Key:             string;
  uploadedByUserId:  string;
  capturedAt?:       string;        // ISO 8601 client-supplied; not load-bearing
  lat?:              number;
  lng?:              number;
  contentType:       string;
  byteSize?:         number;
  contentHash?:      string;        // sha256 hex of the S3 object bytes; populated by finalize
  status:            'PENDING' | 'READY';
  createdAt:         number;
  finalizedAt?:      number;
}

/**
 * Frozen attestation statement. Versioned in attestationStatements.ts.
 * Loaded into the Signature at recording time so the exact text the human
 * signed is reproducible forever.
 */
export interface AttestationStatement {
  action:  AttestationAction;
  version: string;
  text:    string;
}
