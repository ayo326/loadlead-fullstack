/**
 * Carrier compliance documents store (W9, COI, Letter of Authority).
 *
 * These are the trust artifacts a hauler (owner-operator entity) provides and a
 * shipper reviews: the W9, the Certificate of Insurance, and the FMCSA Letter of
 * Authority. Each document lives on the hauler entity (or, optionally, a fleet
 * driver) and references its owner by id only; the Load model is never touched.
 *
 * Append-only and versioned. A re-upload is a NEW row that supersedes the prior
 * version: the old row is never deleted, only its isCurrentVersion flag flips to
 * false so the current one resolves in a single read (mirroring the factoring
 * assignment "a change is a new row, the active resolves" pattern). Verification
 * events and W9 access rows are strictly append-only, never updated or deleted.
 *
 * The W9 TIN is never stored in this table in plaintext. The rendered PDF is the
 * source of truth (private S3 object); the encrypted TIN and the masked last-4
 * live on the document row (see w9Service in Phase 3), and every full-W9 open is
 * written to the append-only w9_access_log.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';

// ── Enumerations ──────────────────────────────────────────────────────────────

export type ComplianceOwnerType = 'HAULER' | 'DRIVER';

export type ComplianceDocumentType = 'W9' | 'COI' | 'LETTER_OF_AUTHORITY';

/** The existing five-state verification machine, mirrored as a union (see idvStatus). */
export type ComplianceVerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type ComplianceVerificationEventType =
  | 'SUBMITTED'
  | 'AUTO_CHECK_PASSED'
  | 'AUTO_CHECK_FAILED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'REFRESH_REQUIRED';

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface ComplianceDocument {
  documentId: string; // 'cdoc_...'
  ownerType: ComplianceOwnerType;
  ownerId: string; // hauler operatorId or driverId, by id only
  documentType: ComplianceDocumentType;
  /** Private S3 object reference (key). Never a public URL. */
  s3Key: string;
  originalFilename: string;
  /** sha256 of the stored PDF object, so a preview can be matched to storage. */
  contentHash: string;
  uploadedBy: string; // account id
  uploadedAt: number; // epoch ms
  verificationStatus: ComplianceVerificationStatus;
  /** Expiry where applicable (COI). epoch ms. */
  expiresAt?: number;
  /** True for the newest version of this (ownerType, ownerId, documentType). */
  isCurrentVersion: boolean;
  /** For the W9: the official form revision, e.g. "Rev. 3-2024". */
  formRevision?: string;
  /**
   * W9 only: the TIN is never stored in plaintext. This holds the KMS-envelope
   * ciphertext (see fieldCrypto); the UI shows tinLast4 everywhere except the
   * gated full-document view. Populated by w9Service in Phase 3.
   */
  encryptedTin?: string;
  tinLast4?: string;
  tinType?: 'SSN' | 'EIN';
  /** W9 only: set when the hauler entered an "Applied For" TIN (held at PENDING). */
  tinAppliedFor?: boolean;
  /** Free-form structured payload per document type (COI fields, LOA numbers). */
  meta?: Record<string, unknown>;
  /** Set when a name/TIN change or a newer upload supersedes this row. */
  supersededAt?: number;
  supersededByDocumentId?: string;
  createdAt: number;
}

export interface ComplianceVerificationEvent {
  eventId: string; // 'cvevt_...'
  documentId: string;
  event: ComplianceVerificationEventType;
  /** Who or what produced the event: an account id, or a system source string. */
  actorOrSource: string;
  detail?: string;
  createdAt: number;
}

export interface W9AccessLogEntry {
  accessId: string; // 'w9acc_...'
  documentId: string;
  viewerAccountId: string;
  /** Why the viewer was allowed: the relationship basis resolved at open time. */
  relationshipBasis: string;
  createdAt: number;
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface CreateComplianceDocumentInput {
  ownerType: ComplianceOwnerType;
  ownerId: string;
  documentType: ComplianceDocumentType;
  s3Key: string;
  originalFilename: string;
  contentHash: string;
  uploadedBy: string;
  expiresAt?: number;
  formRevision?: string;
  encryptedTin?: string;
  tinLast4?: string;
  tinType?: 'SSN' | 'EIN';
  tinAppliedFor?: boolean;
  meta?: Record<string, unknown>;
  /** Initial status; defaults to PENDING (submitted, awaiting verification). */
  initialStatus?: ComplianceVerificationStatus;
  /** Optional detail recorded on the initial SUBMITTED event. */
  submitDetail?: string;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class ComplianceDocumentService {
  private static get docsTable() {
    return config.dynamodb.complianceDocumentsTable;
  }
  private static get eventsTable() {
    return config.dynamodb.complianceVerificationEventsTable;
  }
  private static get accessTable() {
    return config.dynamodb.w9AccessLogTable;
  }

  /**
   * Create a new document version. Supersedes the prior current version of the
   * same (ownerType, ownerId, documentType) by flipping its isCurrentVersion to
   * false (the old row stays for audit), then writes an append-only SUBMITTED
   * event. Returns the new row.
   */
  static async createDocument(input: CreateComplianceDocumentInput): Promise<ComplianceDocument> {
    if (!input.ownerId || !input.s3Key || !input.contentHash) {
      throw new Error('complianceDocument: ownerId, s3Key, and contentHash are required');
    }
    const now = Helpers.getCurrentTimestamp();
    const documentId = Helpers.generateId('cdoc');

    // Supersede the prior current version, if any.
    const prior = await this.getCurrent(input.ownerType, input.ownerId, input.documentType);

    const doc: ComplianceDocument = {
      documentId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      documentType: input.documentType,
      s3Key: input.s3Key,
      originalFilename: input.originalFilename,
      contentHash: input.contentHash,
      uploadedBy: input.uploadedBy,
      uploadedAt: now,
      verificationStatus: input.initialStatus ?? 'PENDING',
      expiresAt: input.expiresAt,
      isCurrentVersion: true,
      formRevision: input.formRevision,
      encryptedTin: input.encryptedTin,
      tinLast4: input.tinLast4,
      tinType: input.tinType,
      tinAppliedFor: input.tinAppliedFor,
      meta: input.meta,
      createdAt: now,
    };

    await Database.putItem(this.docsTable, doc);

    if (prior) {
      // Flip the old current row off and stamp the supersession. This is a
      // single-attribute update, not a delete; the row is retained for audit.
      await Database.updateItem(this.docsTable, { documentId: prior.documentId }, {
        isCurrentVersion: false,
        supersededAt: now,
        supersededByDocumentId: documentId,
      });
      await this.recordVerificationEvent(prior.documentId, 'SUPERSEDED', 'system', `Superseded by ${documentId}`);
    }

    // Self-heal the single-current invariant (audit v4 H2). The read-then-flip
    // above is not atomic: two concurrent submits can both read the same prior
    // (or null) and both land with isCurrentVersion=true. Rather than a
    // conditional-write dance, converge after the write: every submit sweeps
    // its (ownerType, ownerId, documentType) group and flips everything except
    // the deterministic winner. Both racers run the same sweep and agree on
    // the winner, so the terminal state is always exactly one current row.
    await this.healCurrentVersions(input.ownerType, input.ownerId, input.documentType);

    await this.recordVerificationEvent(documentId, 'SUBMITTED', input.uploadedBy, input.submitDetail);
    Logger.info(`[compliance] ${input.documentType} submitted for ${input.ownerType}:${input.ownerId} (${documentId})`);
    return doc;
  }

  /**
   * Deterministic winner ordering: newest createdAt, tiebroken by documentId
   * so two rows created in the same millisecond still order stably (both
   * concurrent healers must agree on the winner, or they would flip each
   * other's rows back and forth).
   */
  private static newestFirst(a: ComplianceDocument, b: ComplianceDocument): number {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return b.documentId.localeCompare(a.documentId);
  }

  /**
   * Enforce exactly one isCurrentVersion=true row per (ownerType, ownerId,
   * documentType). Idempotent and safe to run concurrently: the winner is
   * deterministic, losers get flipped with a supersession stamp and an
   * append-only SUPERSEDED event. A duplicate SUPERSEDED event from two
   * simultaneous healers is acceptable noise; a corrupted current set is not.
   */
  static async healCurrentVersions(
    ownerType: ComplianceOwnerType,
    ownerId: string,
    documentType: ComplianceDocumentType,
  ): Promise<number> {
    const all = await Database.scan<ComplianceDocument>(this.docsTable);
    const currents = all
      .filter(
        (d) =>
          d.ownerType === ownerType &&
          d.ownerId === ownerId &&
          d.documentType === documentType &&
          d.isCurrentVersion,
      )
      .sort((a, b) => this.newestFirst(a, b));
    if (currents.length <= 1) return 0;

    const winner = currents[0];
    const healedAt = Helpers.getCurrentTimestamp();
    let flipped = 0;
    for (const loser of currents.slice(1)) {
      await Database.updateItem(this.docsTable, { documentId: loser.documentId }, {
        isCurrentVersion: false,
        supersededAt: healedAt,
        supersededByDocumentId: winner.documentId,
      });
      await this.recordVerificationEvent(
        loser.documentId,
        'SUPERSEDED',
        'system',
        `Superseded by ${winner.documentId} (concurrent-submit heal)`,
      );
      flipped++;
    }
    Logger.warn(
      `[compliance] healed ${flipped} duplicate current version(s) of ${documentType} for ${ownerType}:${ownerId} (winner ${winner.documentId})`,
    );
    return flipped;
  }

  static async getById(documentId: string): Promise<ComplianceDocument | null> {
    return Database.getItem<ComplianceDocument>(this.docsTable, { documentId });
  }

  /** All versions for an owner (newest first), across document types. */
  static async listByOwner(ownerType: ComplianceOwnerType, ownerId: string): Promise<ComplianceDocument[]> {
    const all = await Database.scan<ComplianceDocument>(this.docsTable);
    return all
      .filter((d) => d.ownerType === ownerType && d.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The current version of one document type for an owner, or null. */
  static async getCurrent(
    ownerType: ComplianceOwnerType,
    ownerId: string,
    documentType: ComplianceDocumentType,
  ): Promise<ComplianceDocument | null> {
    const all = await Database.scan<ComplianceDocument>(this.docsTable);
    return (
      all
        .filter(
          (d) =>
            d.ownerType === ownerType &&
            d.ownerId === ownerId &&
            d.documentType === documentType &&
            d.isCurrentVersion,
        )
        // Defensive: if more than one is flagged current (concurrent-submit race,
        // healed by healCurrentVersions), the same deterministic winner is chosen
        // here so reads and the heal always agree.
        .sort((a, b) => this.newestFirst(a, b))[0] ?? null
    );
  }

  /** The current version of each document type for an owner. */
  static async listCurrentByOwner(
    ownerType: ComplianceOwnerType,
    ownerId: string,
  ): Promise<ComplianceDocument[]> {
    const all = await Database.scan<ComplianceDocument>(this.docsTable);
    return all.filter((d) => d.ownerType === ownerType && d.ownerId === ownerId && d.isCurrentVersion);
  }

  /** Every current-version document of a type across all owners (for jobs like COI expiry). */
  static async listAllCurrentOfType(documentType: ComplianceDocumentType): Promise<ComplianceDocument[]> {
    const all = await Database.scan<ComplianceDocument>(this.docsTable);
    return all.filter((d) => d.documentType === documentType && d.isCurrentVersion);
  }

  /**
   * Set the live verification status on a document and append the matching
   * event. The status field is the current state; the event table is the
   * immutable trail (mirrors the accessorial charge live-status + history split).
   */
  static async setVerificationStatus(
    documentId: string,
    status: ComplianceVerificationStatus,
    event: ComplianceVerificationEventType,
    actorOrSource: string,
    detail?: string,
  ): Promise<void> {
    await Database.updateItem(this.docsTable, { documentId }, { verificationStatus: status });
    await this.recordVerificationEvent(documentId, event, actorOrSource, detail);
  }

  static async recordVerificationEvent(
    documentId: string,
    event: ComplianceVerificationEventType,
    actorOrSource: string,
    detail?: string,
  ): Promise<ComplianceVerificationEvent> {
    const row: ComplianceVerificationEvent = {
      eventId: Helpers.generateId('cvevt'),
      documentId,
      event,
      actorOrSource,
      detail,
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(this.eventsTable, row);
    return row;
  }

  static async listEvents(documentId: string): Promise<ComplianceVerificationEvent[]> {
    const all = await Database.scan<ComplianceVerificationEvent>(this.eventsTable);
    return all.filter((e) => e.documentId === documentId).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Append a W9 full-document access record. Never updated or deleted. */
  static async recordW9Access(
    documentId: string,
    viewerAccountId: string,
    relationshipBasis: string,
  ): Promise<W9AccessLogEntry> {
    const row: W9AccessLogEntry = {
      accessId: Helpers.generateId('w9acc'),
      documentId,
      viewerAccountId,
      relationshipBasis,
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(this.accessTable, row);
    Logger.info(`[compliance] W9 ${documentId} opened by ${viewerAccountId} (${relationshipBasis})`);
    return row;
  }

  static async listW9Access(documentId: string): Promise<W9AccessLogEntry[]> {
    const all = await Database.scan<W9AccessLogEntry>(this.accessTable);
    return all.filter((a) => a.documentId === documentId).sort((a, b) => b.createdAt - a.createdAt);
  }
}
