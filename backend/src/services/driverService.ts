import { Driver, DriverStatus } from '../types';
import { Database } from '../config/database';
import { queryIndexOrScan } from '../utils/indexQuery';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { CAPACITY_POLICY, isValidRatedCapacity } from '../config/capacityPolicy';
import { signedPodGetUrl } from './attestation/podStorage';

export class DriverService {
  private static toTimestamp(value?: number | string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  static async createProfile(userId: string, data: Partial<Driver>): Promise<Driver> {
    try {
      const driverId = Helpers.generateId('driver');
      const now = Helpers.getCurrentTimestamp();

      const driver: Driver = {
        driverId,
        userId,
        status: DriverStatus.PENDING_VERIFICATION,

        // DriverProfiles schema integration
        carrierId: data.carrierId,
        driverType: data.driverType || 'OWNER_OPERATOR',
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        fullName: data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ') || data.legalName!,
        dob: this.toTimestamp(data.dob),
        medicalCertExpiration: this.toTimestamp(data.medicalCertExpiration),
        mcIssueDate: this.toTimestamp(data.mcIssueDate),

        // Identity
        legalName: data.legalName!,
        phone: data.phone!,
        licenseNumber: data.licenseNumber!,
        licenseState: data.licenseState!,
        cdlClass: data.cdlClass!,
        endorsements: data.endorsements || [],
        experienceYears: data.experienceYears || 0,

        // Equipment
        truckMake: data.truckMake!,
        truckModel: data.truckModel!,
        truckYear: data.truckYear!,
        truckVIN: data.truckVIN!,
        trailerType: data.trailerType!,
        trailerLength: data.trailerLength || 0,
        trailerWidth: data.trailerWidth || 0,
        trailerHeight: data.trailerHeight || 0,
        maxCapacityLbs: data.maxCapacityLbs!,
        currentLoadLbs: data.currentLoadLbs || 0,
        specialEquipment: data.specialEquipment || [],

        // ── Equipment spec §11.1 loading capability attributes ──
        dockHeightCompatible: data.dockHeightCompatible ?? false,
        liftgateEquipped: data.liftgateEquipped ?? false,
        palletJackOnboard: data.palletJackOnboard ?? false,
        // Use explicit null-check so negative temps (-10°F) aren't treated as falsy
        tempRangeMin: data.tempRangeMin !== undefined ? Number(data.tempRangeMin) : undefined,
        tempRangeMax: data.tempRangeMax !== undefined ? Number(data.tempRangeMax) : undefined,
        securementGear: data.securementGear || [],
        // Interior dimensions for volume matching
        interiorLengthIn: data.interiorLengthIn !== undefined ? Number(data.interiorLengthIn) : undefined,
        interiorWidthIn:  data.interiorWidthIn  !== undefined ? Number(data.interiorWidthIn)  : undefined,
        interiorHeightIn: data.interiorHeightIn !== undefined ? Number(data.interiorHeightIn) : undefined,
        safetyBufferPct: data.safetyBufferPct || 10,

        // Authority & Insurance
        mcNumber: data.mcNumber!,
        dotNumber: data.dotNumber!,
        authorityStartDate: this.toTimestamp(data.authorityStartDate) || now,
        // Canonical insurance fields used by broadcast matching
        cargoInsuranceAmount: data.cargoInsuranceAmount || data.cargoCoverageAmount || 0,
        liabilityInsuranceAmount: data.liabilityInsuranceAmount || data.autoLiabilityAmount || 0,
        insuranceCertificate: data.insuranceCertificate,
        w9Form: data.w9Form,

        // InsurancePolicies schema integration (alias fields)
        insurancePolicyId: data.insurancePolicyId,
        insuranceProvider: data.insuranceProvider,
        policyNumber: data.policyNumber,
        autoLiabilityAmount: data.autoLiabilityAmount || data.liabilityInsuranceAmount || 0,
        cargoCoverageAmount: data.cargoCoverageAmount || data.cargoInsuranceAmount || 0,
        policyExpirationDate: this.toTimestamp(data.policyExpirationDate),

        // Compliance
        vehicleRegistration: data.vehicleRegistration,
        inspectionCertificate: data.inspectionCertificate,
        eldCompliant: data.eldCompliant || false,
        hosAvailableHours: data.hosAvailableHours || 0,

        // Location
        currentCity: data.currentCity || '',
        currentState: data.currentState || '',
        currentLat: data.currentLat || 0,
        currentLng: data.currentLng || 0,
        geohash: data.currentLat && data.currentLng ? Helpers.encodeGeohash(data.currentLat, data.currentLng) : '',
        lastLocationUpdate: now,

        ownedByOperatorId: data.ownedByOperatorId,
        isSelf: data.isSelf ?? false,

        createdAt: now,
        updatedAt: now,
      };

      await Database.putItem(config.dynamodb.driversTable, driver);
      Logger.info(`Driver profile created: ${driverId}`);
      return driver;
    } catch (error) {
      Logger.error('Create driver profile error', error);
      throw error;
    }
  }

  static async getProfileByUserId(userId: string): Promise<Driver | null> {
    try {
      // COA-3 / audit v6 H8: query the existing userId-index instead of a
      // full-table scan on this hot auth path (first call in ~60 handlers).
      // queryIndexOrScan falls back to the scan (loudly) if the index is ever
      // unavailable, so this is safe regardless of backfill state.
      const drivers = await queryIndexOrScan<Driver>(
        config.dynamodb.driversTable,
        'userId-index',
        'userId',
        userId,
        () => Database.scan<Driver>(config.dynamodb.driversTable, 'userId = :userId', { ':userId': userId }),
        'DriverService.getProfileByUserId',
      );

      return this.withSignedHeadshot(drivers.length > 0 ? drivers[0] : null);
    } catch (error) {
      Logger.error('Get driver profile error', error);
      throw error;
    }
  }

  static async getProfileById(driverId: string): Promise<Driver | null> {
    try {
      const driver = await Database.getItem<Driver>(config.dynamodb.driversTable, { driverId });
      return this.withSignedHeadshot(driver);
    } catch (error) {
      Logger.error('Get driver by ID error', error);
      throw error;
    }
  }

  /**
   * H9 residual (audit v6): the headshot object lives in the private POD bucket.
   * Sign it at serve time - replace the display `headshotUrl` with a short-lived
   * signed GET URL derived from the stored `headshotKey`. Legacy rows carry only
   * a public `headshotUrl`; for those we derive the deterministic key
   * (headshots/<userId>.jpg) so they keep working with no backfill. A driver with
   * no headshot is returned unchanged. The signed URL is never persisted.
   */
  private static async withSignedHeadshot(driver: Driver | null): Promise<Driver | null> {
    if (!driver) return driver;
    const key = driver.headshotKey || (driver.headshotUrl ? `headshots/${driver.userId}.jpg` : null);
    if (!key) return driver;
    try {
      const headshotUrl = await signedPodGetUrl(key, config.pod?.headshotSignedGetTtlSeconds);
      return { ...driver, headshotKey: key, headshotUrl };
    } catch (err) {
      // Signing must never break a profile read; fall back to the stored value.
      Logger.error('Headshot signing failed; returning driver without a fresh URL', err);
      return driver;
    }
  }

  static async updateProfile(driverId: string, updates: Partial<Driver>): Promise<void> {
    // Audit v6 M2: rated capacity is a whole number of pounds. Guard it here
    // (authoritative for every caller, including PUT /driver/profile which has no
    // request-schema validation) so a negative, fractional, or unbounded value
    // can never reach the equipment profile and break matching or hand a hauler
    // an unlimited board. Thrown before the try so a client 400 is not logged as
    // a server error.
    if (updates.maxCapacityLbs !== undefined && !isValidRatedCapacity(updates.maxCapacityLbs)) {
      throw new AppError(
        `maxCapacityLbs must be a whole number of pounds between 0 and ${CAPACITY_POLICY.maxRatedLbs}`,
        400,
      );
    }

    try {
      const updateData: any = {
        ...updates,
        updatedAt: Helpers.getCurrentTimestamp(),
      };

      // H9 phase 5 (audit v6): never persist a headshot URL. The object lives in
      // the private POD bucket; the read path signs a fresh short-lived URL from
      // `headshotKey` at serve time (withSignedHeadshot). Only the key is stored,
      // so drop any client-supplied `headshotUrl` before it can be written - PUT
      // /driver/profile spreads req.body straight in and has no request schema.
      if ('headshotUrl' in updateData) {
        delete updateData.headshotUrl;
      }

      // Keep canonical insurance fields in sync with alias fields
      if (updateData.cargoCoverageAmount != null && !updateData.cargoInsuranceAmount) {
        updateData.cargoInsuranceAmount = updateData.cargoCoverageAmount;
      }
      if (updateData.autoLiabilityAmount != null && !updateData.liabilityInsuranceAmount) {
        updateData.liabilityInsuranceAmount = updateData.autoLiabilityAmount;
      }

      // Normalize date-like fields if incoming values are ISO strings
      const dateFields = ['authorityStartDate', 'dob', 'medicalCertExpiration', 'mcIssueDate', 'policyExpirationDate'];
      for (const field of dateFields) {
        if (typeof updateData[field] === 'string') {
          const parsed = Date.parse(updateData[field]);
          if (!Number.isNaN(parsed)) {
            updateData[field] = parsed;
          }
        }
      }

      // Update geohash if location changed
      if (updates.currentLat && updates.currentLng) {
        updateData.geohash = Helpers.encodeGeohash(updates.currentLat, updates.currentLng);
        updateData.lastLocationUpdate = Helpers.getCurrentTimestamp();
      }

      await Database.updateItem(config.dynamodb.driversTable, { driverId }, updateData);
      Logger.info(`Driver profile updated: ${driverId}`);
    } catch (error) {
      Logger.error('Update driver profile error', error);
      throw error;
    }
  }

  static async updateLocation(driverId: string, lat: number, lng: number, city: string, state: string): Promise<void> {
    try {
      await this.updateProfile(driverId, {
        currentLat: lat,
        currentLng: lng,
        currentCity: city,
        currentState: state,
      });

      Logger.info(`Driver location updated: ${driverId}`);
    } catch (error) {
      Logger.error('Update driver location error', error);
      throw error;
    }
  }

  static async updateLoadStatus(driverId: string, currentLoadLbs: number): Promise<void> {
    try {
      await this.updateProfile(driverId, { currentLoadLbs });
      Logger.info(`Driver load status updated: ${driverId} - ${currentLoadLbs} lbs`);
    } catch (error) {
      Logger.error('Update driver load status error', error);
      throw error;
    }
  }

  static async updateStatus(driverId: string, status: DriverStatus): Promise<void> {
    try {
      await this.updateProfile(driverId, { status });
      Logger.info(`Driver status updated: ${driverId} - ${status}`);
    } catch (error) {
      Logger.error('Update driver status error', error);
      throw error;
    }
  }

  static async getDriversByStatus(status: DriverStatus): Promise<Driver[]> {
    try {
      // LoadLead_Drivers has no status GSI - use a Scan with FilterExpression.
      // For small driver tables this is acceptable; add a GSI if the table grows large.
      return await Database.scan<Driver>(
        config.dynamodb.driversTable,
        '#status = :status',
        { ':status': status },
        { '#status': 'status' }
      );
    } catch (error) {
      Logger.error('Get drivers by status error', error);
      throw error;
    }
  }

  static async verifyDriver(driverId: string): Promise<void> {
    try {
      await this.updateStatus(driverId, DriverStatus.VERIFIED);
      Logger.info(`Driver verified: ${driverId}`);
    } catch (error) {
      Logger.error('Verify driver error', error);
      throw error;
    }
  }

  static async suspendDriver(driverId: string): Promise<void> {
    try {
      await this.updateStatus(driverId, DriverStatus.SUSPENDED);
      Logger.info(`Driver suspended: ${driverId}`);
    } catch (error) {
      Logger.error('Suspend driver error', error);
      throw error;
    }
  }
}
