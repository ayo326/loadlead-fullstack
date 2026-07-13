import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/environment';
import { UserRole } from '../types';
import Geohash from 'latlon-geohash';

export class Helpers {
  static generateId(prefix: string = ''): string {
    return prefix ? `${prefix}_${uuidv4()}` : uuidv4();
  }
  
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
  
  static async comparePassword(password: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(password, hash);
  }
  
  static generateToken(payload: { userId: string; email: string; role: UserRole }): string {
    const secret: jwt.Secret = config.jwt.secret as jwt.Secret;
    return jwt.sign(payload, secret, {
      expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
      algorithm: 'HS256', // pin; verify side only accepts HS256 (Audit v5 SEC-12)
    });
  }
  
  static calculateMcMaturityDays(authorityStartDate: number): number {
    const now = Date.now();
    const diffMs = now - authorityStartDate;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  
  static encodeGeohash(lat: number, lng: number, precision: number = 7): string {
    return Geohash.encode(lat, lng, precision);
  }
  
  static getCurrentTimestamp(): number {
    return Date.now();
  }
  
  static getFutureTimestamp(minutes: number): number {
    return Date.now() + (minutes * 60 * 1000);
  }
  
  static isExpired(timestamp: number): boolean {
    return Date.now() > timestamp;
  }
}

export default Helpers;
