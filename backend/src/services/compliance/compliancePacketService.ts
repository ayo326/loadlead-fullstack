/**
 * Compliance packet assembler.
 *
 * Mirrors the factoring packet: a hauler's packet composes the current W9, COI
 * (with verification state + expiry), and Letter of Authority, with a manifest
 * and content hashes. Badges (presence, verification state, expiry) are public;
 * the full packet and the documents behind it open only through the relationship
 * resolver, and the W9 opens under its own access-log rule.
 */

import { createHash } from 'node:crypto';
import {
  ComplianceDocument,
  ComplianceDocumentService,
  ComplianceDocumentType,
  ComplianceVerificationStatus,
} from '../complianceDocumentService';

const DOC_TYPES: ComplianceDocumentType[] = ['W9', 'COI', 'LETTER_OF_AUTHORITY'];

/** A public badge for one document type: never includes the file or the TIN. */
export interface ComplianceBadge {
  documentType: ComplianceDocumentType;
  present: boolean;
  status: ComplianceVerificationStatus | 'MISSING';
  expiresAt?: number;
  /** True when a COI/LOA has expired or a W9 was flagged for refresh. */
  actionRequired: boolean;
}

export interface CompliancePacketManifestEntry {
  documentType: ComplianceDocumentType;
  documentId: string;
  status: ComplianceVerificationStatus;
  contentHash: string;
  expiresAt?: number;
  formRevision?: string;
}

export interface CompliancePacket {
  operatorId: string;
  assembledAt: number;
  entries: CompliancePacketManifestEntry[];
  /** sha256 over the canonical manifest, pinning the exact packet contents. */
  packetHash: string;
}

function badgeFor(documentType: ComplianceDocumentType, doc: ComplianceDocument | null): ComplianceBadge {
  if (!doc) {
    return { documentType, present: false, status: 'MISSING', actionRequired: true };
  }
  const expired = doc.expiresAt != null && doc.expiresAt <= Date.now();
  return {
    documentType,
    present: true,
    status: doc.verificationStatus,
    expiresAt: doc.expiresAt,
    actionRequired:
      doc.verificationStatus === 'EXPIRED' ||
      doc.verificationStatus === 'REJECTED' ||
      expired,
  };
}

/** Public badges for a hauler: presence, verification state, expiry. No gating. */
export async function complianceBadges(operatorId: string): Promise<ComplianceBadge[]> {
  const current = await ComplianceDocumentService.listCurrentByOwner('HAULER', operatorId);
  const byType = new Map(current.map((d) => [d.documentType, d]));
  return DOC_TYPES.map((t) => badgeFor(t, byType.get(t) ?? null));
}

/**
 * Assemble the full packet manifest for a hauler. Callers must have already
 * passed the relationship resolver. The manifest carries content hashes and an
 * overall packet hash; it never carries the TIN or the file bytes.
 */
export async function assemblePacket(operatorId: string): Promise<CompliancePacket> {
  const current = await ComplianceDocumentService.listCurrentByOwner('HAULER', operatorId);
  const byType = new Map(current.map((d) => [d.documentType, d]));

  const entries: CompliancePacketManifestEntry[] = [];
  for (const t of DOC_TYPES) {
    const doc = byType.get(t);
    if (!doc) continue;
    entries.push({
      documentType: t,
      documentId: doc.documentId,
      status: doc.verificationStatus,
      contentHash: doc.contentHash,
      expiresAt: doc.expiresAt,
      formRevision: doc.formRevision,
    });
  }

  const assembledAt = Date.now();
  const canonical = JSON.stringify({ operatorId, entries });
  const packetHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return { operatorId, assembledAt, entries, packetHash };
}
