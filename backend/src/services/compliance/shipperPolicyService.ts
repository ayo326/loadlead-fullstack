/**
 * Shipper compliance policy: authored by the shipper, versioned, snapshotted
 * onto a load at acceptance, signed by the hauler, and viewable/printable.
 *
 * Versioning: editing a policy creates a NEW version; prior versions are never
 * mutated (append-only), mirroring the accessorial policy-snapshot pattern. At
 * load acceptance the shipper's current version is pinned onto the load as an
 * append-only attachment with a content hash. The hauler signs through an
 * attestation record (version + hash + consent); the shipper's authorship is
 * their agreement. A later edit never alters an existing snapshot.
 *
 * The Load model is never touched: attachments reference the load by id only.
 */

import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Database } from '../../config/database';
import config from '../../config/environment';
import { Helpers } from '../../utils/helpers';
import { AppError } from '../../middleware/errorHandler';
import { putObject, signedGetUrl } from './complianceStorage';

export type PolicySourceType = 'FILE' | 'TEXT';

export interface ShipperPolicyVersion {
  policyVersionId: string; // 'spol_...'
  shipperId: string;
  version: number;
  sourceType: PolicySourceType;
  /** For TEXT policies, the authored rich text (also rendered to the PDF). */
  richText?: string;
  s3Key: string; // the rendered/uploaded PDF
  contentHash: string;
  createdBy: string;
  createdAt: number;
  isCurrent: boolean;
}

export interface ShipperPolicyAttachment {
  attachmentId: string; // 'spatt_...'
  loadId: string;
  shipperId: string;
  policyVersionId: string;
  version: number;
  /** Hash of the pinned policy at snapshot time; never changes if the policy is edited. */
  snapshotHash: string;
  snappedAt: number;
  // Hauler signature (attestation shape).
  signedByUserId?: string;
  signatureName?: string;
  signedAt?: number;
  signatureHash?: string;
  consentGiven?: boolean;
}

const POLICIES = () => config.dynamodb.shipperCompliancePoliciesTable;
const ATTACHMENTS = () => config.dynamodb.shipperPolicyAttachmentsTable;

async function renderTextToPdf(richText: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = richText.replace(/\r/g, '').split('\n');
  let y = 740;
  for (const raw of lines) {
    // Naive wrap at ~90 chars so long lines do not overflow the page.
    const chunks = raw.match(/.{1,90}/g) ?? [''];
    for (const c of chunks) {
      if (y < 48) {
        y = 740;
        pdf.addPage([612, 792]);
      }
      page.drawText(c, { x: 48, y, size: 11, font });
      y -= 16;
    }
  }
  return pdf.save({ useObjectStreams: false });
}

/** Create a new policy version for a shipper (edit = new version; old is immutable). */
export async function upsertPolicy(input: {
  shipperId: string;
  sourceType: PolicySourceType;
  richText?: string;
  fileBytes?: Uint8Array;
  createdBy: string;
}): Promise<ShipperPolicyVersion> {
  const prior = await getCurrentPolicy(input.shipperId);
  const version = (prior?.version ?? 0) + 1;

  let bytes: Uint8Array;
  if (input.sourceType === 'TEXT') {
    if (!input.richText || !input.richText.trim()) throw new AppError('richText is required for a TEXT policy', 400);
    bytes = await renderTextToPdf(input.richText);
  } else {
    if (!input.fileBytes || input.fileBytes.length === 0) throw new AppError('fileBytes is required for a FILE policy', 400);
    bytes = input.fileBytes;
  }

  const policyVersionId = Helpers.generateId('spol');
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const s3Key = `compliance/shipper/${input.shipperId}/policy/${policyVersionId}.pdf`;
  await putObject(s3Key, bytes, 'application/pdf');

  const row: ShipperPolicyVersion = {
    policyVersionId,
    shipperId: input.shipperId,
    version,
    sourceType: input.sourceType,
    richText: input.richText,
    s3Key,
    contentHash,
    createdBy: input.createdBy,
    createdAt: Helpers.getCurrentTimestamp(),
    isCurrent: true,
  };
  await Database.putItem(POLICIES(), row);
  if (prior) {
    await Database.updateItem(POLICIES(), { policyVersionId: prior.policyVersionId }, { isCurrent: false });
  }
  return row;
}

export async function getCurrentPolicy(shipperId: string): Promise<ShipperPolicyVersion | null> {
  const all = await Database.scan<ShipperPolicyVersion>(POLICIES());
  return (
    all
      .filter((p) => p.shipperId === shipperId && p.isCurrent)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export async function getPolicyVersion(policyVersionId: string): Promise<ShipperPolicyVersion | null> {
  return Database.getItem<ShipperPolicyVersion>(POLICIES(), { policyVersionId });
}

/**
 * Snapshot the shipper's current policy onto a load at acceptance. Append-only:
 * pins the version + hash. If the shipper has no policy, returns null (the load
 * proceeds without one unless the require flag is on). Idempotent per load.
 */
export async function snapshotPolicyOntoLoad(loadId: string, shipperId: string): Promise<ShipperPolicyAttachment | null> {
  const existing = await getAttachment(loadId);
  if (existing) return existing;

  const current = await getCurrentPolicy(shipperId);
  if (!current) {
    if ((process.env.REQUIRE_SHIPPER_POLICY || 'false') === 'true') {
      throw new AppError('Shipper policy required but none exists', 409);
    }
    return null;
  }

  const row: ShipperPolicyAttachment = {
    attachmentId: Helpers.generateId('spatt'),
    loadId,
    shipperId,
    policyVersionId: current.policyVersionId,
    version: current.version,
    snapshotHash: current.contentHash,
    snappedAt: Helpers.getCurrentTimestamp(),
  };
  await Database.putItem(ATTACHMENTS(), row);
  return row;
}

export async function getAttachment(loadId: string): Promise<ShipperPolicyAttachment | null> {
  const all = await Database.scan<ShipperPolicyAttachment>(ATTACHMENTS());
  return all.filter((a) => a.loadId === loadId).sort((a, b) => b.snappedAt - a.snappedAt)[0] ?? null;
}

/** The hauler signs the attached policy (attestation: pins version + hash + consent). */
export async function signAttachedPolicy(input: {
  loadId: string;
  signerUserId: string;
  signatureName: string;
  consentGiven: boolean;
}): Promise<ShipperPolicyAttachment> {
  if (input.consentGiven !== true) throw new AppError('CONSENT_REQUIRED', 400);
  const att = await getAttachment(input.loadId);
  if (!att) throw new AppError('No shipper policy attached to this load', 404);

  const signedAt = Helpers.getCurrentTimestamp();
  const signatureHash = createHash('sha256')
    .update(`${att.policyVersionId}|${att.snapshotHash}|${input.signerUserId}|${signedAt}`, 'utf8')
    .digest('hex');

  const patch = {
    signedByUserId: input.signerUserId,
    signatureName: input.signatureName,
    signedAt,
    signatureHash,
    consentGiven: true,
  };
  await Database.updateItem(ATTACHMENTS(), { attachmentId: att.attachmentId }, patch);
  return { ...att, ...patch };
}

/** Short-lived signed URL to a policy version's PDF (for view/print). */
export async function policyDocumentUrl(policyVersionId: string): Promise<string> {
  const p = await getPolicyVersion(policyVersionId);
  if (!p) throw new AppError('Policy version not found', 404);
  return signedGetUrl(p.s3Key);
}
