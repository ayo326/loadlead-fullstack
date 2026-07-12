/**
 * COI cross-reference results store (Canopy Connect, SCRUM-60).
 *
 * APPEND-ONLY. Each row is one comparison of an uploaded COI against the Canopy
 * insurer-sourced pull data: per-field outcomes plus an overall alignment. A
 * re-run (new COI version, or a monitoring pull that changes the insurer data)
 * writes a NEW row; a prior row is never mutated or deleted. Rows reference the
 * carrier, the COI compliance document, and the pull by id only; the Load model
 * is never touched.
 *
 * The row does not carry a "resolved" flag: admin resolution of a CRITICAL
 * discrepancy is recorded on the compliance document's append-only verification
 * events and the trust-events store, not by editing this immutable result.
 */

import { Database } from '../../config/database';
import config from '../../config/environment';
import { Helpers } from '../../utils/helpers';
import { Logger } from '../../utils/logger';
import { queryIndexOrScan } from '../../utils/indexQuery';

/** Overall alignment of a COI against the insurer-sourced data. */
export type CrossReferenceAlignment = 'ALIGNED' | 'MINOR_DISCREPANCY' | 'CRITICAL_DISCREPANCY';

/** Severity contributed by a single field comparison. */
export type CrossReferenceSeverity = 'NONE' | 'MINOR' | 'CRITICAL';

export interface CrossReferenceFieldComparison {
  /** e.g. 'insurerName' | 'policyNumber' | 'autoLiabilityCents' | 'cargoCents' | 'effectiveDate' | 'expiryDate' | 'coverageTypes' */
  field: string;
  /** The value from the uploaded COI (normalized form for display). */
  coiValue: string | number | null;
  /** The value from the Canopy insurer-sourced pull (normalized form). */
  insurerValue: string | number | null;
  match: boolean;
  severity: CrossReferenceSeverity;
  /** Short human-readable reason, e.g. "limit overstated on COI". Never a secret. */
  note?: string;
}

export interface CoiCrossReferenceResult {
  resultId: string; // 'cxref_...'
  carrierId: string; // by id only
  insuranceDocumentId: string; // the COI ComplianceDocument id
  pullId: string; // the Canopy pull the COI was compared against
  comparisons: CrossReferenceFieldComparison[];
  alignment: CrossReferenceAlignment;
  createdAt: number; // epoch ms
}

export interface RecordCrossReferenceInput {
  carrierId: string;
  insuranceDocumentId: string;
  pullId: string;
  comparisons: CrossReferenceFieldComparison[];
  alignment: CrossReferenceAlignment;
}

export class CoiCrossReferenceStore {
  private static get table() {
    return config.dynamodb.coiCrossReferenceResultsTable;
  }

  /** Append one immutable cross-reference result. */
  static async record(input: RecordCrossReferenceInput): Promise<CoiCrossReferenceResult> {
    if (!input.carrierId || !input.insuranceDocumentId || !input.pullId) {
      throw new Error('carrierId, insuranceDocumentId, and pullId are required');
    }
    const row: CoiCrossReferenceResult = {
      resultId: Helpers.generateId('cxref'),
      carrierId: input.carrierId,
      insuranceDocumentId: input.insuranceDocumentId,
      pullId: input.pullId,
      comparisons: input.comparisons,
      alignment: input.alignment,
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(this.table, row);
    return row;
  }

  /** All results for a carrier via carrierId-index, newest first. */
  static async listForCarrier(carrierId: string): Promise<CoiCrossReferenceResult[]> {
    const rows = await queryIndexOrScan<CoiCrossReferenceResult>(
      this.table,
      'carrierId-index',
      'carrierId',
      carrierId,
      () => this.scanAll(),
      'coiCrossReference.listForCarrier',
    );
    return rows.filter((r) => r.carrierId === carrierId).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** All results for one COI document, newest first. */
  static async listForDocument(insuranceDocumentId: string): Promise<CoiCrossReferenceResult[]> {
    return (await this.scanAll())
      .filter((r) => r.insuranceDocumentId === insuranceDocumentId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The newest result for one COI document, or null. */
  static async latestForDocument(insuranceDocumentId: string): Promise<CoiCrossReferenceResult | null> {
    return (await this.listForDocument(insuranceDocumentId))[0] ?? null;
  }

  /** The newest result for a carrier, or null. */
  static async latestForCarrier(carrierId: string): Promise<CoiCrossReferenceResult | null> {
    return (await this.listForCarrier(carrierId))[0] ?? null;
  }

  private static async scanAll(): Promise<CoiCrossReferenceResult[]> {
    try {
      return await Database.scan<CoiCrossReferenceResult>(this.table);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(
          `CoiCrossReferenceResults table ${this.table} not found; returning empty. Apply the Terraform that creates it.`,
        );
        return [];
      }
      throw err;
    }
  }
}

export default CoiCrossReferenceStore;
