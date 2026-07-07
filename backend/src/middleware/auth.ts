import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/environment';
import { UserRole, OrgCapability } from '../types';
import { PlatformRole, resolvePlatformRole } from '../types/platformRole';
import { ComplianceRole } from '../types/complianceRole';
import { OrgService, OrgMembershipService } from '../services/orgService';
import { ComplianceRoleService } from '../services/complianceRoleService';
import { Database } from '../config/database';
import { isFleetCarrierPersonaEnabled } from '../config/featureFlags';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: UserRole;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // httpOnly cookie takes precedence; fall back to Authorization header
    // for API clients (Postman, curl, mobile) that send Bearer tokens.
    const cookieToken = (req as any).cookies?.ll_token as string | undefined;
    const headerToken = req.headers.authorization?.split(' ')[1];
    const token = cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      role: UserRole;
    };

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    
    next();
  };
};

export const requireAdmin         = requireRole(UserRole.ADMIN);
export const requireShipper       = requireRole(UserRole.SHIPPER, UserRole.ADMIN);
export const requireDriver        = requireRole(UserRole.DRIVER, UserRole.ADMIN);
export const requireReceiver      = requireRole(UserRole.RECEIVER, UserRole.ADMIN);
export const requireOwnerOperator = requireRole(UserRole.OWNER_OPERATOR, UserRole.ADMIN);

/**
 * Platform-staff tier gate. Caller must (a) be an ADMIN-role user and
 * (b) resolve to a platformRole that is in the allowlist passed here.
 *
 * Use after `authenticate + requireAdmin` so the surface gate runs first
 * (a non-ADMIN never reaches this). The platformRole comes from a fresh
 * DB read of the user record - we DO NOT trust the JWT payload, which
 * may have been minted before the tier was changed. Pre-Phase-1 admins
 * with no platformRole resolve to STAFF_ADMIN for back-compat.
 */
export const requireStaffTier = (...allowed: PlatformRole[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user)                       return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    try {
      const user = await Database.getItem<any>(
        config.dynamodb.usersTable,
        { userId: req.user.userId },
      );
      const tier = resolvePlatformRole(user?.platformRole);
      if (!tier)                  return res.status(403).json({ error: 'Forbidden: invalid platform tier' });
      if (!allowed.includes(tier)) return res.status(403).json({ error: 'Forbidden: insufficient platform tier' });
      (req as any).platformRole = tier;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Tier check failed' });
    }
  };
};

/**
 * Compliance-role gate for the platform-admin oversight layer. Caller must be an
 * ADMIN-role user AND hold the specific compliance-role grant (checked against a
 * fresh read of the grants store, not the JWT). Enforces least privilege and
 * separation: a DISPUTE_ADMIN cannot reach a LAW_ENFORCEMENT_LIAISON surface.
 * Use after `authenticate`.
 */
export const requireComplianceRole = (role: ComplianceRole) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });
    try {
      const has = await ComplianceRoleService.hasRole(req.user.userId, role);
      if (!has) return res.status(403).json({ error: `Forbidden: requires ${role} compliance role` });
      (req as any).complianceRole = role;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Compliance role check failed' });
    }
  };
};

/**
 * Gate by org capability - e.g. only a CARRIER-capability org may onboard
 * drivers. Reads req.params.orgId, requires the caller be an active member
 * (Platform Admin bypasses) of an org whose capabilities include `cap`.
 */
export const requireOrgCapability = (cap: OrgCapability) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { orgId } = req.params;
    if (!orgId) return res.status(400).json({ error: 'orgId is required' });

    try {
      if (req.user.role === UserRole.ADMIN) return next();

      const membership = await OrgMembershipService.getMembership(orgId, req.user.userId);
      if (!membership || membership.status === 'SUSPENDED') {
        return res.status(403).json({ error: 'Forbidden: not an active member of this organisation' });
      }

      const org = await OrgService.getOrgById(orgId);
      if (!org?.capabilities?.includes(cap)) {
        return res.status(403).json({ error: `Forbidden: organisation lacks ${cap} capability` });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Fleet-carrier PERSONA gate. While the persona is muted
 * (FLEET_CARRIER_PERSONA_ENABLED=false), routes that exist ONLY to serve the
 * fleet-carrier persona return 403 with a machine-readable code so the FE can
 * render the friendly interstitial rather than a raw error. Nothing is
 * deleted - the handler is preserved and re-enables with the single flag.
 *
 * IMPORTANT scoping:
 *  - Apply ONLY to fleet-carrier-persona concerns (carrier org creation,
 *    fleet driver onboarding/invites, carrier console endpoints). Do NOT
 *    apply to owner-operator flows or to any shared carrier-entity code an
 *    OO runs through (accessorials, factoring, negotiation, e-sign,
 *    settlement) - those are NOT muted.
 *  - Platform Admin (UserRole.ADMIN) bypasses the gate so oversight over
 *    existing fleet accounts and data is never blocked.
 */
export const requireFleetCarrierPersona = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === UserRole.ADMIN) return next();
  if (!isFleetCarrierPersonaEnabled()) {
    return res.status(403).json({
      code: 'PERSONA_DISABLED',
      error: 'The fleet-carrier persona is not currently available.',
    });
  }
  return next();
};
