/**
 * Saved factor contact (per carrier or owner-operator).
 *
 * An optional, reusable factor name + email saved on the mover's account so the
 * export-and-send flow can pre-fill the recipient. Stored in a dedicated table
 * keyed by carrierId; the Load model is never touched. The recipient is only ever
 * the mover's own saved contact or a value they type at send time, never derived
 * from anywhere else.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';

export interface FactorContact {
  carrierId: string; // PK (the mover)
  factorName: string;
  factorEmail: string;
  createdAt: number;
  updatedAt: number;
}

// Conservative email check: one @, a dot in the domain, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

export class FactorContactService {
  static async get(carrierId: string): Promise<FactorContact | null> {
    try {
      return await Database.getItem<FactorContact>(config.dynamodb.factorContactsTable, { carrierId });
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`FactorContacts table missing; treating carrier ${carrierId} as having no saved contact.`);
        return null;
      }
      throw err;
    }
  }

  /** Save or update the saved factor contact. Validates the email. */
  static async save(carrierId: string, input: { factorName: string; factorEmail: string }): Promise<FactorContact> {
    if (!carrierId) throw new Error('factorContact: carrierId is required');
    if (!input.factorName?.trim()) throw new Error('factorContact: factorName is required');
    if (!isValidEmail(input.factorEmail)) throw new Error('factorContact: a valid factorEmail is required');

    const existing = await this.get(carrierId);
    const now = Helpers.getCurrentTimestamp();
    const contact: FactorContact = {
      carrierId,
      factorName: input.factorName.trim(),
      factorEmail: input.factorEmail.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await Database.putItem(config.dynamodb.factorContactsTable, contact);
    return contact;
  }
}
