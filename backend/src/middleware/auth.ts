import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/environment';
import { UserRole } from '../types';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: UserRole;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
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

export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireShipper = requireRole(UserRole.SHIPPER, UserRole.ADMIN);
export const requireDriver = requireRole(UserRole.DRIVER, UserRole.ADMIN);
export const requireReceiver = requireRole(UserRole.RECEIVER, UserRole.ADMIN);
