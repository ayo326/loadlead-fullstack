/**
 * Compliance-role grants.
 *
 * A platform staffer may be granted one or more compliance roles (a separate axis
 * from their PlatformRole tier). Grants are the source of truth for least-
 * privilege checks in the middleware. Every grant and revoke is a super-admin
 * action recorded to the admin audit log by the caller; the current grant set is
 * stored per user (keyed by userId).
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { ComplianceRole, ALL_COMPLIANCE_ROLES, isComplianceRole } from '../types/complianceRole';

export interface ComplianceGrant {
  userId: string; // PK
  roles: ComplianceRole[];
  updatedAt: number;
  updatedByUserId: string;
}

export class ComplianceRoleService {
  static async getGrant(userId: string): Promise<ComplianceGrant | null> {
    try {
      return await Database.getItem<ComplianceGrant>(config.dynamodb.complianceGrantsTable, { userId });
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return null;
      throw err;
    }
  }

  static async getRoles(userId: string): Promise<ComplianceRole[]> {
    const g = await this.getGrant(userId);
    return g?.roles ?? [];
  }

  static async hasRole(userId: string, role: ComplianceRole): Promise<boolean> {
    return (await this.getRoles(userId)).includes(role);
  }

  /** Grant a compliance role. Idempotent (a role already held is a no-op). */
  static async grant(actorId: string, userId: string, role: ComplianceRole): Promise<ComplianceGrant> {
    if (!isComplianceRole(role)) throw new Error(`invalid compliance role: ${role}`);
    const current = await this.getRoles(userId);
    const roles = current.includes(role) ? current : [...current, role];
    return this.put(userId, roles, actorId);
  }

  /** Revoke a compliance role. Idempotent. */
  static async revoke(actorId: string, userId: string, role: ComplianceRole): Promise<ComplianceGrant> {
    const roles = (await this.getRoles(userId)).filter((r) => r !== role);
    return this.put(userId, roles, actorId);
  }

  private static async put(userId: string, roles: ComplianceRole[], actorId: string): Promise<ComplianceGrant> {
    const grant: ComplianceGrant = {
      userId,
      roles: roles.filter((r) => ALL_COMPLIANCE_ROLES.includes(r)),
      updatedAt: Helpers.getCurrentTimestamp(),
      updatedByUserId: actorId,
    };
    await Database.putItem(config.dynamodb.complianceGrantsTable, grant);
    return grant;
  }
}
