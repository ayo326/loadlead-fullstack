/**
 * Notice of Assignment (NoA), append-only.
 *
 * When a mover assigns an invoice's receivable to a factor (Phase 6 assignment),
 * the debtor (the shipper) must be told to remit payment to the factor. The NoA
 * captures that legal redirection: it references the assignment, names the factor
 * and the debtor, and snapshots the exact notice text and timestamp so the notice
 * is reproducible. Rows are never updated or deleted; a re-issue is a new row.
 *
 * References the assignment, carrier, invoice, and debtor by id only.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import type { FactoringAssignment } from './factoringAssignmentService';
import { formatCentsUsd } from '../utils/money';

export const NOTICE_OF_ASSIGNMENT_TEMPLATE_VERSION = '1.0.0';

export interface NoticeOfAssignment {
  noaId: string; // 'noa_...'
  assignmentId: string;
  carrierId: string;
  invoiceId?: string;
  debtorId: string; // the shipper, by id
  debtorName?: string;
  factorName: string;
  payoutDestination: string;
  noticeText: string; // immutable snapshot of the notice served
  templateVersion: string;
  actorId: string;
  createdAt: number;
}

export interface DebtorRef {
  debtorId: string;
  debtorName?: string;
}

export interface GenerateNoticeInput {
  assignment: FactoringAssignment;
  debtor: DebtorRef;
  actorId: string;
  /** Optional invoice amount in cents, included in the notice when present. */
  invoiceAmountCents?: number;
}

/** Build the legal notice text. Pure and deterministic given its inputs. */
export function buildNoticeText(input: GenerateNoticeInput): string {
  const { assignment, debtor, invoiceAmountCents } = input;
  const who = debtor.debtorName ? `${debtor.debtorName} (debtor id ${debtor.debtorId})` : `debtor id ${debtor.debtorId}`;
  const subject = assignment.invoiceId
    ? `invoice ${assignment.invoiceId}`
    : `all current and future receivables under the parties' account-level assignment`;
  const amount = invoiceAmountCents != null ? ` in the amount of ${formatCentsUsd(invoiceAmountCents)}` : '';
  const effective = new Date(assignment.effectiveAt).toISOString().slice(0, 10);
  return [
    `NOTICE OF ASSIGNMENT`,
    ``,
    `To: ${who}`,
    ``,
    `Please be advised that the right to payment of ${subject}${amount} has been assigned by the ` +
      `carrier of record (carrier id ${assignment.carrierId}) to ${assignment.factorName}. Effective ${effective}, ` +
      `all payments due must be remitted solely to ${assignment.factorName} at ${assignment.payoutDestination}, ` +
      `and payment to any other party does not discharge the obligation. This notice remains in effect until you ` +
      `receive a written release from ${assignment.factorName}.`,
  ].join('\n');
}

export class NoticeOfAssignmentService {
  /** Generate and record a Notice of Assignment (append-only). */
  static async generate(input: GenerateNoticeInput): Promise<NoticeOfAssignment> {
    if (!input.debtor?.debtorId) throw new Error('noa: debtorId is required');
    if (!input.actorId) throw new Error('noa: actorId is required');

    const noticeText = buildNoticeText(input);
    const noa: NoticeOfAssignment = {
      noaId: Helpers.generateId('noa'),
      assignmentId: input.assignment.assignmentId,
      carrierId: input.assignment.carrierId,
      ...(input.assignment.invoiceId ? { invoiceId: input.assignment.invoiceId } : {}),
      debtorId: input.debtor.debtorId,
      ...(input.debtor.debtorName ? { debtorName: input.debtor.debtorName } : {}),
      factorName: input.assignment.factorName,
      payoutDestination: input.assignment.payoutDestination,
      noticeText,
      templateVersion: NOTICE_OF_ASSIGNMENT_TEMPLATE_VERSION,
      actorId: input.actorId,
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.noticesOfAssignmentTable, noa);
    return noa;
  }

  /** The most recent NoA for an assignment, or null. */
  static async getForAssignment(assignmentId: string): Promise<NoticeOfAssignment | null> {
    const all = await this.scanAll();
    const rows = all.filter((n) => n.assignmentId === assignmentId).sort((a, b) => b.createdAt - a.createdAt);
    return rows[0] ?? null;
  }

  /** All notices for a carrier, newest first. */
  static async listForCarrier(carrierId: string): Promise<NoticeOfAssignment[]> {
    const all = await this.scanAll();
    return all.filter((n) => n.carrierId === carrierId).sort((a, b) => b.createdAt - a.createdAt);
  }

  private static async scanAll(): Promise<NoticeOfAssignment[]> {
    try {
      return await Database.scan<NoticeOfAssignment>(config.dynamodb.noticesOfAssignmentTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`NoticesOfAssignment table ${config.dynamodb.noticesOfAssignmentTable} not found; returning empty.`);
        return [];
      }
      throw err;
    }
  }
}
