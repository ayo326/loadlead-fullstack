import { Driver, Load, CapacityCheck, CapacityZone, BufferAuditLog } from '../types';
import { EquipmentService } from './equipmentService';
import { Database } from '../config/database';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

const DEFAULT_BUFFER_PCT = 10;
const MIN_BUFFER_PCT = 5;
const MAX_BUFFER_PCT = 25;

// ─── Pure math helpers ────────────────────────────────────────────────────────

export function calcMaxOperationalWeight(maxCapacityLbs: number, bufferPct: number): number {
  return maxCapacityLbs * (1 - bufferPct / 100);
}

export function calcMaxOperationalVolume(usableVolumeCuIn: number, bufferPct: number): number {
  return usableVolumeCuIn * (1 - bufferPct / 100);
}

export function calcUsableVolume(
  lengthIn?: number,
  widthIn?: number,
  heightIn?: number,
): number {
  if (!lengthIn || !widthIn || !heightIn) return 0;
  return lengthIn * widthIn * heightIn;
}

function weightZone(projectedTotal: number, maxOperational: number): CapacityZone {
  if (projectedTotal > maxOperational) return 'DANGER';
  if (projectedTotal === maxOperational) return 'BUFFER';
  return 'SAFE';
}

function volumeZone(projectedTotal: number, maxOperational: number): CapacityZone {
  if (!maxOperational) return 'SAFE'; // no volume configured → skip check
  if (projectedTotal > maxOperational) return 'DANGER';
  if (projectedTotal === maxOperational) return 'BUFFER';
  return 'SAFE';
}

function worstZone(a: CapacityZone, b: CapacityZone): CapacityZone {
  const rank = { SAFE: 0, BUFFER: 1, DANGER: 2 };
  return rank[a] >= rank[b] ? a : b;
}

// ─── Geometric fit guard (V1 per-dimension check) ─────────────────────────────

function geometricFits(driver: Driver, load: Load): { fits: boolean; reason?: string } {
  if (load.dimLengthIn && driver.interiorLengthIn && load.dimLengthIn > driver.interiorLengthIn) {
    return { fits: false, reason: `Load length ${load.dimLengthIn}" exceeds trailer interior ${driver.interiorLengthIn}"` };
  }
  if (load.dimWidthIn && driver.interiorWidthIn && load.dimWidthIn > driver.interiorWidthIn) {
    return { fits: false, reason: `Load width ${load.dimWidthIn}" exceeds trailer interior ${driver.interiorWidthIn}"` };
  }
  if (load.dimHeightIn && driver.interiorHeightIn && load.dimHeightIn > driver.interiorHeightIn) {
    return { fits: false, reason: `Load height ${load.dimHeightIn}" exceeds trailer interior ${driver.interiorHeightIn}"` };
  }
  return { fits: true };
}

// ─── Main service ─────────────────────────────────────────────────────────────

export class CapacityService {

  // ── Three-zone check (weight + volume) ────────────────────────────────────

  static evaluateLoad(driver: Driver, load: Load): CapacityCheck {
    const bufferPct = driver.safetyBufferPct ?? DEFAULT_BUFFER_PCT;

    // Weight
    const maxOpWeight = calcMaxOperationalWeight(driver.maxCapacityLbs, bufferPct);
    const currentWeight = driver.currentLoadLbs ?? 0;
    const projectedWeight = currentWeight + load.totalWeightLbs;
    const remainingWeightLbs = maxOpWeight - projectedWeight;
    const wZone = weightZone(projectedWeight, maxOpWeight);

    // Volume
    const usableVol = driver.usableVolumeCuIn ?? calcUsableVolume(
      driver.interiorLengthIn, driver.interiorWidthIn, driver.interiorHeightIn
    );
    const maxOpVol = usableVol ? calcMaxOperationalVolume(usableVol, bufferPct) : 0;
    const loadVol = load.loadVolumeCuIn ?? calcUsableVolume(load.dimLengthIn, load.dimWidthIn, load.dimHeightIn);
    const currentVol = driver.currentVolumeCuIn ?? 0;
    const projectedVol = currentVol + loadVol;
    const remainingVolumeCuIn = maxOpVol ? maxOpVol - projectedVol : Infinity;
    const vZone = volumeZone(projectedVol, maxOpVol);

    // Geometric fit check
    const geo = geometricFits(driver, load);
    if (!geo.fits) {
      return {
        zone: 'DANGER',
        remainingWeightLbs,
        remainingVolumeCuIn: remainingVolumeCuIn === Infinity ? 0 : remainingVolumeCuIn,
        blockMessage: `Action Denied: ${geo.reason}`,
      };
    }

    const zone = worstZone(wZone, vZone);
    const remainingBookable = Math.max(0, maxOpWeight - currentWeight);

    if (zone === 'DANGER') {
      const exceedDim = wZone === 'DANGER' ? 'weight' : 'volume';
      return {
        zone: 'DANGER',
        remainingWeightLbs,
        remainingVolumeCuIn: remainingVolumeCuIn === Infinity ? 0 : remainingVolumeCuIn,
        blockMessage:
          `Action Denied: This load exceeds the remaining operational ${exceedDim} capacity of ` +
          `${remainingBookable.toLocaleString()} lbs required to maintain the ${bufferPct}% safety buffer.`,
      };
    }

    if (zone === 'BUFFER') {
      return {
        zone: 'BUFFER',
        remainingWeightLbs: 0,
        remainingVolumeCuIn: 0,
        warningMessage: 'Alert: Maximum operational capacity reached. Only the safety buffer remains.',
      };
    }

    return {
      zone: 'SAFE',
      remainingWeightLbs,
      remainingVolumeCuIn: remainingVolumeCuIn === Infinity ? 0 : remainingVolumeCuIn,
    };
  }

  /**
   * Full 4-step eligibility check (spec §11.4 matching order):
   *   1. Equipment type
   *   2. Loading requirements
   *   3+4. Capacity + geometric fit
   * Used by BroadcastService and any route that needs a single pass/fail.
   */
  static canDriverHandleLoad(driver: Driver, load: Load): { canHandle: boolean; reason?: string } {
    try {
      // Steps 1 & 2 - equipment type + loading requirements
      const equipCheck = EquipmentService.checkEquipmentMatch(driver, load);
      if (!equipCheck.eligible) return { canHandle: false, reason: equipCheck.reason };

      // Steps 3 & 4 - capacity (weight + volume) + geometric fit
      const result = CapacityService.evaluateLoad(driver, load);
      if (result.zone === 'DANGER') {
        return { canHandle: false, reason: result.blockMessage };
      }
      return { canHandle: true };
    } catch (error) {
      Logger.error('Check driver capacity error', error);
      return { canHandle: false, reason: 'Error checking capacity' };
    }
  }

  static calculateAvailableCapacity(driver: Driver): number {
    const bufferPct = driver.safetyBufferPct ?? DEFAULT_BUFFER_PCT;
    const maxOp = calcMaxOperationalWeight(driver.maxCapacityLbs, bufferPct);
    return Math.max(0, maxOp - (driver.currentLoadLbs ?? 0));
  }

  static wouldOverload(driver: Driver, additionalWeightLbs: number): boolean {
    const bufferPct = driver.safetyBufferPct ?? DEFAULT_BUFFER_PCT;
    const maxOp = calcMaxOperationalWeight(driver.maxCapacityLbs, bufferPct);
    return (driver.currentLoadLbs + additionalWeightLbs) > maxOp;
  }

  // ── Buffer management ─────────────────────────────────────────────────────

  static validateBufferPct(pct: number): { valid: boolean; error?: string } {
    if (pct < MIN_BUFFER_PCT || pct > MAX_BUFFER_PCT) {
      return { valid: false, error: `Buffer must be between ${MIN_BUFFER_PCT}% and ${MAX_BUFFER_PCT}%.` };
    }
    return { valid: true };
  }

  /**
   * Update a driver's safety buffer, write an audit log entry, and
   * retroactively flag overBuffer if the new buffer is tighter.
   */
  static async updateDriverBuffer(
    driverId: string,
    newBufferPct: number,
    changedBy: string,
    changedByRole: string,
    driverService: any,
  ): Promise<{ overBuffer: boolean }> {
    const validation = CapacityService.validateBufferPct(newBufferPct);
    if (!validation.valid) throw new Error(validation.error);

    const driver = await driverService.getProfileById(driverId);
    if (!driver) throw new Error('Driver not found');

    const oldBufferPct = driver.safetyBufferPct ?? DEFAULT_BUFFER_PCT;

    // Audit log
    const log: BufferAuditLog = {
      logId: Helpers.generateId('buflog'),
      driverId,
      changedBy,
      changedByRole,
      oldBufferPct,
      newBufferPct,
      timestamp: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem('LoadLead_BufferAuditLog', log).catch(() => {
      // Table may not exist in early deploys; log and continue
      Logger.warn('LoadLead_BufferAuditLog table not yet created - audit entry skipped');
    });

    // Retroactive re-evaluation: tighter buffer → check for overBuffer
    let overBuffer = false;
    if (newBufferPct > oldBufferPct) {
      const newMaxOp = calcMaxOperationalWeight(driver.maxCapacityLbs, newBufferPct);
      if ((driver.currentLoadLbs ?? 0) > newMaxOp) {
        overBuffer = true;
      }
    }

    await driverService.updateProfile(driverId, {
      safetyBufferPct: newBufferPct,
      overBufferFlag: overBuffer,
      bufferSetBy: changedBy,
      bufferSetByRole: changedByRole,
    });

    return { overBuffer };
  }
}
