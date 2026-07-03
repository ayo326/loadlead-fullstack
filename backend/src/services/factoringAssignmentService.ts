/**
 * Factoring assignment log (append-only) and the active-assignment resolver.
 *
 * An assignment redirects an invoice's payment to a factor without LoadLead
 * becoming a lender. The log is append-only: a release or a factor change is a
 * NEW row, never an update or delete. The "active" assignment for an invoice is
 * resolved with invoice-level precedence over account-level.
 *
 * This is the substrate the payee routing primitive (Phase 6) reads. The Notice
 * of Assignment (Phase 7) is layered on top via noticeOfAssignmentService.
 *
 * References the carrier (mover: fleet carrier or owner-operator) and the invoice
 * by id only.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';

export type RecourseType = 'RECOURSE' | 'NON_RECOURSE';
export type AssignmentScope = 'FULL_INVOICE' | 'LINEHAUL_ONLY';
export type AssignmentStatus = 'ACTIVE' | 'RELEASED';

export interface FactoringAssignment {
  assignmentId: string; // 'assign_...'
  carrierId: string; // the mover, by id
  invoiceId?: string; // invoice-level; absent => account-level
  accountLevel: boolean; // true when there is no invoiceId
  factorName: string;
  factorContact?: string; // factor remittance email/reference
  recourseType: RecourseType;
  scope: AssignmentScope; // FULL_INVOICE by default
  payoutDestination: string; // where the factor wants funds sent
  effectiveAt: number; // epoch ms
  status: AssignmentStatus; // ACTIVE on create; a RELEASED row supersedes it
  /** A release/change names the row it supersedes; both rows are retained. */
  supersedesAssignmentId?: string;
  actorId: string;
  createdAt: number;
}

export interface CreateAssignmentInput {
  carrierId: string;
  invoiceId?: string;
  factorName: string;
  factorContact?: string;
  recourseType: RecourseType;
  scope?: AssignmentScope;
  payoutDestination: string;
  actorId: string;
  effectiveAt?: number;
}

export class FactoringAssignmentService {
  /** Create an ACTIVE assignment. Append-only. */
  static async create(input: CreateAssignmentInput): Promise<FactoringAssignment> {
    if (!input.carrierId) throw new Error('assignment: carrierId is required');
    if (!input.factorName) throw new Error('assignment: factorName is required');
    if (!input.payoutDestination) throw new Error('assignment: payoutDestination is required');
    if (input.recourseType !== 'RECOURSE' && input.recourseType !== 'NON_RECOURSE') {
      throw new Error('assignment: recourseType must be RECOURSE or NON_RECOURSE');
    }
    const now = Helpers.getCurrentTimestamp();
    const assignment: FactoringAssignment = {
      assignmentId: Helpers.generateId('assign'),
      carrierId: input.carrierId,
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      accountLevel: !input.invoiceId,
      factorName: input.factorName,
      ...(input.factorContact ? { factorContact: input.factorContact } : {}),
      recourseType: input.recourseType,
      scope: input.scope ?? 'FULL_INVOICE',
      payoutDestination: input.payoutDestination,
      effectiveAt: input.effectiveAt ?? now,
      status: 'ACTIVE',
      actorId: input.actorId,
      createdAt: now,
    };
    await Database.putItem(config.dynamodb.factoringAssignmentsTable, assignment);
    return assignment;
  }

  /**
   * Release an assignment by appending a RELEASED row that supersedes it (same
   * target). The original ACTIVE row is retained for audit. Idempotent: releasing
   * an already-released target is a no-op that returns the latest row.
   */
  static async release(assignmentId: string, actorId: string): Promise<FactoringAssignment> {
    const all = await this.scanAll();
    const target = all.find((a) => a.assignmentId === assignmentId);
    if (!target) throw new Error(`assignment not found: ${assignmentId}`);

    // Find the current effective row for this target; if already released, no-op.
    const active = await this.getActiveAssignment(target.carrierId, target.invoiceId);
    if (!active) return target;

    const now = Helpers.getCurrentTimestamp();
    const released: FactoringAssignment = {
      ...active,
      assignmentId: Helpers.generateId('assign'),
      status: 'RELEASED',
      supersedesAssignmentId: active.assignmentId,
      actorId,
      effectiveAt: now,
      createdAt: now,
    };
    await Database.putItem(config.dynamodb.factoringAssignmentsTable, released);
    return released;
  }

  /** Every assignment row for a carrier, newest first. Append-only history. */
  static async listForCarrier(carrierId: string): Promise<FactoringAssignment[]> {
    const all = await this.scanAll();
    return all.filter((a) => a.carrierId === carrierId).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * The active assignment for an invoice, with invoice-level precedence over
   * account-level.
   *
   * Effectiveness is resolved through the supersession chain, not by timestamp:
   * a release/change row names the row it supersedes, and any superseded row is
   * dropped. This is robust even when a create and its release land in the same
   * millisecond. If a live invoice-level row exists it decides (ACTIVE => that
   * factor; RELEASED => no factor, overriding any account-level assignment);
   * otherwise the live account-level row decides.
   */
  static async getActiveAssignment(carrierId: string, invoiceId?: string): Promise<FactoringAssignment | null> {
    const rows = (await this.scanAll()).filter((a) => a.carrierId === carrierId);
    const superseded = new Set(rows.map((a) => a.supersedesAssignmentId).filter(Boolean) as string[]);
    const live = rows.filter((a) => !superseded.has(a.assignmentId));

    const newest = (subset: FactoringAssignment[]): FactoringAssignment | null =>
      subset.length === 0 ? null : subset.slice().sort((a, b) => b.createdAt - a.createdAt)[0];

    if (invoiceId) {
      const invoiceDecision = newest(live.filter((a) => a.invoiceId === invoiceId));
      if (invoiceDecision) {
        return invoiceDecision.status === 'ACTIVE' ? invoiceDecision : null;
      }
    }

    const accountDecision = newest(live.filter((a) => a.accountLevel));
    if (accountDecision) {
      return accountDecision.status === 'ACTIVE' ? accountDecision : null;
    }
    return null;
  }

  private static async scanAll(): Promise<FactoringAssignment[]> {
    try {
      return await Database.scan<FactoringAssignment>(config.dynamodb.factoringAssignmentsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`FactoringAssignments table ${config.dynamodb.factoringAssignmentsTable} not found; returning empty.`);
        return [];
      }
      throw err;
    }
  }
}
