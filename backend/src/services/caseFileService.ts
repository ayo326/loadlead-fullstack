/**
 * Legal case-file assembler + integrity verification.
 *
 * Assembles the complete record set for a subject (load, invoice, carrier, or
 * shipper) into a structured export with a manifest and a content hash per item,
 * so the package is provably complete and untampered. verifyIntegrity recomputes
 * every hash and checks the manifest against the items, reporting any gap. The
 * assembler is read-only over the pipeline; it never mutates a record.
 *
 * Assembling a case file is a sensitive read and is audited by the caller.
 */

import { createHash } from 'node:crypto';

export interface CaseFileItem {
  kind: string; // CONSENT | ESIGN_ACCEPTANCE | STOP_EVENT | CHARGE | CHARGE_HISTORY | NOTICE | ADVANCE | RECONCILIATION | ADJUDICATION | ADMIN_AUDIT
  id: string;
  content: unknown;
  contentHash: string; // sha256 of the canonical content
}

export interface CaseFileManifestEntry {
  kind: string;
  id: string;
  contentHash: string;
}

export interface CaseFile {
  subjectType: string;
  subjectId: string;
  assembledAt: number;
  manifest: CaseFileManifestEntry[];
  items: CaseFileItem[];
}

export interface IntegrityResult {
  ok: boolean;
  gaps: string[];
}

/** Stable key-sorted JSON so the same content always hashes the same. */
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
}

export function contentHashOf(content: unknown): string {
  return createHash('sha256').update(canonicalJSON(content), 'utf8').digest('hex');
}

export class CaseFileService {
  /** Build a case file from gathered records. Each source record supplies its kind + id + content. */
  static assemble(subjectType: string, subjectId: string, records: { kind: string; id: string; content: unknown }[]): CaseFile {
    const items: CaseFileItem[] = records.map((r) => ({
      kind: r.kind,
      id: r.id,
      content: r.content,
      contentHash: contentHashOf(r.content),
    }));
    const manifest: CaseFileManifestEntry[] = items.map((i) => ({ kind: i.kind, id: i.id, contentHash: i.contentHash }));
    return { subjectType, subjectId, assembledAt: Date.now(), manifest, items };
  }

  /**
   * Recompute and verify the hashes and the manifest-to-items correspondence.
   * Returns ok=false with a list of gaps when any item was altered, any manifest
   * entry is missing, or the counts do not match.
   */
  static verifyIntegrity(caseFile: CaseFile): IntegrityResult {
    const gaps: string[] = [];
    const manifestById = new Map(caseFile.manifest.map((m) => [`${m.kind}:${m.id}`, m]));

    if (caseFile.manifest.length !== caseFile.items.length) {
      gaps.push(`manifest count ${caseFile.manifest.length} != items count ${caseFile.items.length}`);
    }

    for (const item of caseFile.items) {
      const key = `${item.kind}:${item.id}`;
      const recomputed = contentHashOf(item.content);
      if (recomputed !== item.contentHash) {
        gaps.push(`altered item ${key}: content hash mismatch`);
      }
      const m = manifestById.get(key);
      if (!m) {
        gaps.push(`item ${key} missing from manifest`);
      } else if (m.contentHash !== recomputed) {
        gaps.push(`manifest hash for ${key} does not match the item`);
      }
    }

    // Every manifest entry must have a matching item.
    const itemKeys = new Set(caseFile.items.map((i) => `${i.kind}:${i.id}`));
    for (const m of caseFile.manifest) {
      if (!itemKeys.has(`${m.kind}:${m.id}`)) gaps.push(`manifest entry ${m.kind}:${m.id} has no item`);
    }

    return { ok: gaps.length === 0, gaps };
  }
}
