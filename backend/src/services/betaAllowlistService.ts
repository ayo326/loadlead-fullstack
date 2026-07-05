/**
 * BetaAllowlistService - the runtime-editable list of who can sign up
 * under BETA_MODE without an explicit Invitation token.
 *
 * Two row shapes share the table:
 *   - EMAIL:  value = the lowercased email address. Matches one user.
 *   - DOMAIN: value = the lowercased domain (e.g. "acme.com", no leading @).
 *             Anyone at @acme.com can self-sign-up.
 *
 * Lookups are by the `value-index` GSI for O(1) reads - no Scans.
 *
 * Soft-delete only: `active=false` retains the audit trail. The lookup
 * helpers filter to active rows; the admin list endpoint shows both.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { BetaAllowlistEntry } from '../types';

export class BetaAllowlistService {

  /** Normalize an email: lowercase + trim. Returns the value the table uses. */
  private static normEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Normalize a domain: lowercase + strip leading "@" if present + trim. */
  private static normDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/^@/, '');
  }

  /** Domain part of an email (the bit after the @), normalised. Returns
   *  empty string for malformed input (caller decides whether to treat
   *  that as "no match"). */
  private static domainOf(email: string): string {
    const at = email.lastIndexOf('@');
    return at >= 0 ? this.normDomain(email.slice(at + 1)) : '';
  }

  /**
   * Lookup helper used by the beta gate. Returns the matching ACTIVE entry
   * (preferring EMAIL match over DOMAIN match if both exist) or null.
   *
   * O(2) DDB reads via the value-index GSI - one for the email and one
   * for the domain. No Scan.
   */
  static async findActiveMatchForEmail(email: string): Promise<BetaAllowlistEntry | null> {
    const normEmail  = this.normEmail(email);
    const normDomain = this.domainOf(normEmail);
    if (!normDomain) return null;

    // Look for an EMAIL-typed entry first (more specific wins).
    const emailHits = await Database.query<BetaAllowlistEntry>(
      config.dynamodb.betaAllowlistTable,
      'value-index',
      '#v = :v',
      { '#v': 'value' },
      { ':v': normEmail },
    );
    const emailMatch = emailHits.find(e => e.active && e.type === 'EMAIL');
    if (emailMatch) return emailMatch;

    // Fall back to a DOMAIN-typed entry for the email's domain.
    const domainHits = await Database.query<BetaAllowlistEntry>(
      config.dynamodb.betaAllowlistTable,
      'value-index',
      '#v = :v',
      { '#v': 'value' },
      { ':v': normDomain },
    );
    const domainMatch = domainHits.find(e => e.active && e.type === 'DOMAIN');
    return domainMatch ?? null;
  }

  /** Add an entry. Idempotent: if a matching active EMAIL+value or
   *  DOMAIN+value entry already exists, returns it instead of duplicating. */
  static async add(params: {
    type: 'EMAIL' | 'DOMAIN';
    value: string;
    addedByStaffId: string;
    reason?: string;
  }): Promise<BetaAllowlistEntry> {
    const value = params.type === 'EMAIL'
      ? this.normEmail(params.value)
      : this.normDomain(params.value);
    if (!value) throw new AppError('value is required', 400);

    // Idempotency check via the GSI.
    const hits = await Database.query<BetaAllowlistEntry>(
      config.dynamodb.betaAllowlistTable,
      'value-index',
      '#v = :v',
      { '#v': 'value' },
      { ':v': value },
    );
    const existing = hits.find(e => e.active && e.type === params.type);
    if (existing) return existing;

    const entry: BetaAllowlistEntry = {
      allowlistId: Helpers.generateId('allow'),
      type: params.type,
      value,
      addedByStaffId: params.addedByStaffId,
      reason: params.reason,
      active: true,
      createdAt: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.betaAllowlistTable, entry);
    Logger.info(`Beta allowlist: ${params.type} ${value} added by ${params.addedByStaffId}`);
    return entry;
  }

  /** Soft-delete (active=false). Hard-delete would lose the audit trail. */
  static async deactivate(allowlistId: string, staffId: string): Promise<void> {
    const now = Helpers.getCurrentTimestamp();
    await Database.updateItem(
      config.dynamodb.betaAllowlistTable,
      { allowlistId },
      { active: false, deactivatedAt: now, deactivatedBy: staffId },
    );
    Logger.info(`Beta allowlist: ${allowlistId} deactivated by ${staffId}`);
  }

  /** Listing for the admin console. Returns ALL entries (both active and
   *  deactivated) so staff can see history. The route layer paginates. */
  static async list(): Promise<BetaAllowlistEntry[]> {
    return Database.scan<BetaAllowlistEntry>(config.dynamodb.betaAllowlistTable);
  }
}
