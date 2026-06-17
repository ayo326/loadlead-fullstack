import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/environment';
import { UserRole, OrgCapability } from '../types';
import { OrgService, OrgMembershipService } from '../services/orgService';

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
 * Gate by org capability — e.g. only a CARRIER-capability org may onboard
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
