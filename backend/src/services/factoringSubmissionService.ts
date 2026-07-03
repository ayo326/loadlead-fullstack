/**
 * Export-and-send: confirmed send of a factoring packet, with an append-only
 * submission record.
 *
 * Guardrails (the export-and-send feature emails sensitive financial documents):
 *  - The recipient comes only from the carrier or owner-operator: a value they
 *    type at send time, or their saved factor contact. It is never auto-filled
 *    from anywhere else. resolveRecipient enforces this.
 *  - Nothing is sent until the mover explicitly confirms (confirmed === true).
 *  - The email goes out only on the existing authenticated sending domain, from a
 *    LoadLead address (so DKIM/SPF/DMARC apply), reply-to the mover, to the
 *    confirmed recipient only, with the combined PDF attached.
 *  - On a send failure the failure is recorded and surfaced; we never retry
 *    silently to a different address.
 *  - Every submission is recorded append-only: the disclosure trail of what
 *    financial documents left the platform, to whom, and when. A resend is a new
 *    record.
 *
 * Applies equally to carriers and owner-operators (a carrierId is either).
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { sendRawEmail } from './integrations/email';
import { FactorContactService, isValidEmail } from './factorContactService';
import type { PacketManifest } from './factoringPacketService';

const LOADLEAD_FROM = 'LoadLead <noreply@loadleadapp.com>';

export type SubmissionStatus = 'SENT' | 'FAILED';

export interface FactoringSubmission {
  submissionId: string; // 'fsub_...'
  carrierId: string;
  invoiceIds: string[];
  recipientEmail: string;
  manifest: PacketManifest;
  actorId: string;
  status: SubmissionStatus;
  error?: string;
  sentAt: number;
}

export interface SubmitPacketInput {
  carrierId: string;
  invoiceIds: string[];
  recipientEmail: string; // the confirmed recipient (typed or saved)
  confirmed: boolean;
  manifest: PacketManifest;
  pdf: Buffer;
  actorId: string;
  moverReplyTo?: string; // reply-to set to the mover
  moverName?: string;
  saveContact?: { factorName: string }; // optionally save/update the factor contact
}

export class FactoringSubmissionService {
  /**
   * Resolve the recipient strictly from mover-provided sources: the address typed
   * at send time, or the mover's saved factor contact. Never derived elsewhere.
   * Returns null when neither yields a valid address.
   */
  static async resolveRecipient(carrierId: string, typed?: string): Promise<string | null> {
    if (typed && isValidEmail(typed)) return typed.trim();
    if (typed) return null; // a typed-but-invalid address is not silently replaced
    const saved = await FactorContactService.get(carrierId);
    return saved && isValidEmail(saved.factorEmail) ? saved.factorEmail : null;
  }

  /** Send the packet to the confirmed recipient and record the submission append-only. */
  static async submit(input: SubmitPacketInput): Promise<FactoringSubmission> {
    if (input.confirmed !== true) {
      throw new Error('SEND_NOT_CONFIRMED: the mover must explicitly confirm before sending');
    }
    if (!isValidEmail(input.recipientEmail)) {
      throw new Error('INVALID_RECIPIENT: a valid recipient email is required');
    }
    if (!input.invoiceIds?.length) throw new Error('invoiceIds are required');
    if (!input.actorId) throw new Error('actorId is required');

    const subject = `LoadLead factoring packet for invoice ${input.invoiceIds.join(', ')} - ${input.moverName ?? input.carrierId}`;
    const bodyHtml =
      `<p>Please find attached the factoring submission packet from ${input.moverName ?? 'the carrier'} ` +
      `(carrier id ${input.carrierId}) for invoice ${input.invoiceIds.join(', ')}.</p>` +
      `<p>Reply to this message to reach the carrier directly.</p>`;

    let status: SubmissionStatus = 'SENT';
    let error: string | undefined;
    try {
      await sendRawEmail({
        to: input.recipientEmail, // the confirmed recipient only
        from: LOADLEAD_FROM, // authenticated sending domain
        ...(input.moverReplyTo ? { replyTo: input.moverReplyTo } : {}),
        subject,
        bodyHtml,
        attachments: [
          {
            filename: `factoring-packet-${input.invoiceIds.join('-')}.pdf`,
            content: input.pdf,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (err: any) {
      status = 'FAILED';
      error = err?.message ?? String(err);
      Logger.error(`[factoringSubmission] send failed to ${input.recipientEmail}: ${error}`);
      // Do not retry to a different address. The failure is recorded and surfaced.
    }

    const submission: FactoringSubmission = {
      submissionId: Helpers.generateId('fsub'),
      carrierId: input.carrierId,
      invoiceIds: input.invoiceIds,
      recipientEmail: input.recipientEmail,
      manifest: input.manifest,
      actorId: input.actorId,
      status,
      ...(error ? { error } : {}),
      sentAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.factoringSubmissionsTable, submission);

    // Offer to save/update the factor contact with the address used (only on success).
    if (status === 'SENT' && input.saveContact?.factorName) {
      try {
        await FactorContactService.save(input.carrierId, {
          factorName: input.saveContact.factorName,
          factorEmail: input.recipientEmail,
        });
      } catch (err) {
        Logger.warn(`[factoringSubmission] could not save factor contact: ${(err as any)?.message}`);
      }
    }

    return submission;
  }

  /** Submissions for a carrier, newest first (the disclosure surface). */
  static async listForCarrier(carrierId: string): Promise<FactoringSubmission[]> {
    return (await this.scanAll()).filter((s) => s.carrierId === carrierId).sort((a, b) => b.sentAt - a.sentAt);
  }

  /** Submissions that reference an invoice, newest first (resends show as extra records). */
  static async listForInvoice(invoiceId: string): Promise<FactoringSubmission[]> {
    return (await this.scanAll()).filter((s) => s.invoiceIds.includes(invoiceId)).sort((a, b) => b.sentAt - a.sentAt);
  }

  private static async scanAll(): Promise<FactoringSubmission[]> {
    try {
      return await Database.scan<FactoringSubmission>(config.dynamodb.factoringSubmissionsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`FactoringSubmissions table ${config.dynamodb.factoringSubmissionsTable} not found; returning empty.`);
        return [];
      }
      throw err;
    }
  }
}
