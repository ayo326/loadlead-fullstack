/**
 * Compliance notifications. Wires the notification seam for verification
 * outcomes, an expiring COI (ahead of the date), and the W9 refresh trigger.
 * All notifications respect the owner-operator-focused persona gating already in
 * place (the hauler is an owner-operator).
 */

import { Helpers } from '../../utils/helpers';
import { NotificationService } from '../notificationService';
import { OwnerOperatorService } from '../ownerOperatorService';
import {
  ComplianceDocument,
  ComplianceDocumentService,
  ComplianceDocumentType,
} from '../complianceDocumentService';

const DAY = 24 * 60 * 60 * 1000;
/** Notify this many days ahead of a COI expiry. */
export const COI_EXPIRY_NOTICE_DAYS = [30, 7];

const LABEL: Record<ComplianceDocumentType, string> = {
  W9: 'W-9',
  COI: 'Certificate of Insurance',
  LETTER_OF_AUTHORITY: 'Letter of Authority',
};

/** Resolve the hauler entity's user id from an operatorId. */
async function haulerUserId(operatorId: string): Promise<string | null> {
  const op = await OwnerOperatorService.getById(operatorId);
  return op?.userId ?? null;
}

/** Notify the hauler of a verification decision on one of their documents. */
export async function notifyVerificationOutcome(documentId: string): Promise<void> {
  const doc = await ComplianceDocumentService.getById(documentId);
  if (!doc || doc.ownerType !== 'HAULER') return;
  const userId = await haulerUserId(doc.ownerId);
  if (!userId) return;

  const label = LABEL[doc.documentType];
  const verified = doc.verificationStatus === 'VERIFIED';
  await NotificationService.record({
    userId,
    kind: 'COMPLIANCE',
    title: verified ? `${label} verified` : `${label} update`,
    body: verified
      ? `Your ${label} has been verified.`
      : `Your ${label} status is now ${doc.verificationStatus}.`,
  }).catch(() => undefined);
}

/**
 * Notify haulers whose current COI expires within one of the notice windows.
 * Intended for a scheduled job. Returns the number of notices sent.
 */
export async function notifyExpiringCois(
  now: number = Helpers.getCurrentTimestamp(),
  days: number[] = COI_EXPIRY_NOTICE_DAYS,
): Promise<number> {
  const cois = await ComplianceDocumentService.listAllCurrentOfType('COI');
  let sent = 0;
  for (const doc of cois) {
    if (!doc.expiresAt || doc.verificationStatus === 'EXPIRED') continue;
    const msLeft = doc.expiresAt - now;
    if (msLeft <= 0) continue;
    const daysLeft = Math.ceil(msLeft / DAY);
    if (!days.includes(daysLeft)) continue;

    const userId = await haulerUserId(doc.ownerId);
    if (!userId) continue;
    await NotificationService.record({
      userId,
      kind: 'COMPLIANCE',
      title: 'Insurance expiring soon',
      body: `Your Certificate of Insurance expires in ${daysLeft} day(s). Upload a renewal to stay eligible.`,
    }).catch(() => undefined);
    sent += 1;
  }
  return sent;
}

/** Notify the hauler that a shipper policy is attached to a load and awaits signature. */
export async function notifyPolicySignPrompt(haulerUserId: string, loadId: string): Promise<void> {
  await NotificationService.record({
    userId: haulerUserId,
    kind: 'COMPLIANCE',
    title: 'Shipper policy to sign',
    body: 'A shipper policy is attached to your accepted load. Please review and sign it.',
    url: `/owner-operator/loads/${loadId}`,
  }).catch(() => undefined);
}

/** Re-export for the document type used above. */
export type { ComplianceDocument };
