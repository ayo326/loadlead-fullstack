// Password change + 2FA (TOTP) for the Settings page.
//
// Login flow with 2FA:
//   POST /auth/login → { user, token } if 2FA off
//                    → { needsTwoFactor: true, twoFactorTicket } if 2FA on
//   POST /auth/2fa/login → exchange ticket + 6-digit code for final token

import { TOTP, generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';

// ±30s window handles clock drift; otplib v13 defaults are reasonable.

const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes
const pendingTickets = new Map<string, { userId: string; expiresAt: number }>();
function gcTickets() { const now = Date.now(); for (const [k, v] of pendingTickets) if (v.expiresAt < now) pendingTickets.delete(k); }

interface StoredUser {
  userId: string;
  email: string;
  password?: string;
  passwordHash?: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
}

function getHash(u: StoredUser): string | undefined {
  return u.password ?? u.passwordHash;
}

export class SecurityService {
  // ── Password change ───────────────────────────────────────────────────────
  static async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new AppError('New password must be at least 8 characters', 400);

    const user = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId });
    if (!user) throw new AppError('User not found', 404);

    const hash = getHash(user);
    if (!hash) throw new AppError('Password change unavailable for this account', 400);

    const ok = await Helpers.comparePassword(currentPassword, hash);
    if (!ok) throw new AppError('Current password is incorrect', 401);

    const newHash = await Helpers.hashPassword(newPassword);
    await Database.updateItem(config.dynamodb.usersTable, { userId }, {
      password: newHash,
      passwordChangedAt: Helpers.getCurrentTimestamp(),
    });
    Logger.info(`Password changed for user ${userId}`);
  }

  // ── 2FA setup ─────────────────────────────────────────────────────────────
  /**
   * Start 2FA enrollment. Generates a secret, stores it as "pending" until
   * the user confirms with a valid TOTP code in verify().
   */
  static async setupTwoFactor(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({ label: email, issuer: 'LoadLead', secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Stash secret without enabling yet - only verify() flips the enabled flag.
    await Database.updateItem(config.dynamodb.usersTable, { userId }, {
      twoFactorSecret: secret,
      twoFactorEnabled: false,
    });

    return { secret, otpauthUrl, qrDataUrl };
  }

  /**
   * Confirm enrollment: user enters the first TOTP code from their app.
   * Flips twoFactorEnabled to true if it verifies.
   */
  static async verifyAndEnableTwoFactor(userId: string, token: string): Promise<void> {
    const user = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId });
    if (!user?.twoFactorSecret) throw new AppError('Start 2FA setup first', 400);

    const ok = verify({ token, secret: user.twoFactorSecret });
    if (!ok) throw new AppError('Invalid 2FA code', 400);

    await Database.updateItem(config.dynamodb.usersTable, { userId }, {
      twoFactorEnabled: true,
    });
    Logger.info(`2FA enabled for user ${userId}`);
  }

  static async disableTwoFactor(userId: string, password: string): Promise<void> {
    const user = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId });
    if (!user) throw new AppError('User not found', 404);

    const hash = getHash(user);
    const ok = hash ? await Helpers.comparePassword(password, hash) : false;
    if (!ok) throw new AppError('Password is incorrect', 401);

    await Database.updateItem(config.dynamodb.usersTable, { userId }, {
      twoFactorEnabled: false,
      twoFactorSecret: '',
    });
    Logger.info(`2FA disabled for user ${userId}`);
  }

  // ── 2FA login flow ────────────────────────────────────────────────────────
  /** Returns true if a user has 2FA enabled. */
  static async hasTwoFactor(userId: string): Promise<boolean> {
    const user = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId });
    return !!user?.twoFactorEnabled;
  }

  /** Mint a short-lived ticket the client trades for a real token after 2FA. */
  static mintTwoFactorTicket(userId: string): string {
    gcTickets();
    const ticket = crypto.randomBytes(24).toString('hex');
    pendingTickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
    return ticket;
  }

  /** Exchange a ticket + valid TOTP code for the userId (caller mints the JWT). */
  static async exchangeTwoFactorTicket(ticket: string, code: string): Promise<string> {
    gcTickets();
    const entry = pendingTickets.get(ticket);
    if (!entry) throw new AppError('Invalid or expired ticket', 401);
    pendingTickets.delete(ticket);

    const user = await Database.getItem<StoredUser>(config.dynamodb.usersTable, { userId: entry.userId });
    if (!user?.twoFactorSecret) throw new AppError('2FA not configured', 400);

    const ok = verify({ token: code, secret: user.twoFactorSecret });
    if (!ok) throw new AppError('Invalid 2FA code', 401);

    return entry.userId;
  }
}
