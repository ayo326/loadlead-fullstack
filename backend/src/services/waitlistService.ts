/**
 * WaitlistService — captures emails from the private-beta landing page
 * (visitors who aren't on the allowlist and don't have an invite).
 *
 * Also used as the "WAITING" tier for the BetaApplication pipeline:
 * applications that are QUALIFIED but not admitted live in the Waitlist
 * concept; the dashboard shows landing-page entries + waitlisted-app
 * entries in the same view.
 *
 * Promotion to INVITED creates an Invitation via OrgInvitationService and
 * adds the email to BetaAllowlist — the regular Admit flow.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { UserRole, WaitlistEntry } from '../types';

export class WaitlistService {

  private static normEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Add an entry. Idempotent: if the email is already on the waitlist in
   * any status, returns the existing row. This means a visitor hitting
   * "join waitlist" twice doesn't create dupes.
   */
  static async add(params: {
    email: string;
    name?: string;
    personaInterest?: UserRole;
    source: 'landing' | 'application';
  }): Promise<WaitlistEntry> {
    const email = this.normEmail(params.email);
    if (!email || !email.includes('@')) {
      throw new AppError('Valid email is required', 400);
    }

    // Idempotency via email-index GSI.
    const hits = await Database.query<WaitlistEntry>(
      config.dynamodb.waitlistTable,
      'email-index',
      '#e = :e',
      { '#e': 'email' },
      { ':e': email },
    );
    if (hits.length > 0) return hits[0];

    const entry: WaitlistEntry = {
      waitlistId: Helpers.generateId('wait'),
      email,
      name: params.name?.trim(),
      personaInterest: params.personaInterest,
      source: params.source,
      status: 'WAITING',
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.waitlistTable, entry);
    Logger.info(`Waitlist: ${email} added from ${params.source}`);
    return entry;
  }

  static async listWaiting(): Promise<WaitlistEntry[]> {
    const all = await Database.scan<WaitlistEntry>(config.dynamodb.waitlistTable);
    return all.filter(e => e.status === 'WAITING');
  }

  static async listAll(): Promise<WaitlistEntry[]> {
    return Database.scan<WaitlistEntry>(config.dynamodb.waitlistTable);
  }

  static async markInvited(waitlistId: string, staffId: string): Promise<void> {
    await Database.updateItem(
      config.dynamodb.waitlistTable,
      { waitlistId },
      {
        status: 'INVITED',
        invitedAt: Helpers.getCurrentTimestamp(),
        invitedBy: staffId,
      },
    );
  }
}
