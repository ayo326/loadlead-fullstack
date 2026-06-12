import { Driver, DriverStatus } from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

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

        // Authority & Insurance
        mcNumber: data.mcNumber!,
        dotNumber: data.dotNumber!,
        authorityStartDate: this.toTimestamp(data.authorityStartDate) || now,
        cargoInsuranceAmount: data.cargoInsuranceAmount || 0,
        liabilityInsuranceAmount: data.liabilityInsuranceAmount || 0,
        insuranceCertificate: data.insuranceCertificate,
        w9Form: data.w9Form,

        // InsurancePolicies schema integration
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
      const drivers = await Database.scan<Driver>(
        config.dynamodb.driversTable,
        'userId = :userId',
        { ':userId': userId }
      );

      return drivers.length > 0 ? drivers[0] : null;
    } catch (error) {
      Logger.error('Get driver profile error', error);
      throw error;
    }
  }

  static async getProfileById(driverId: string): Promise<Driver | null> {
    try {
      return await Database.getItem<Driver>(config.dynamodb.driversTable, { driverId });
    } catch (error) {
      Logger.error('Get driver by ID error', error);
      throw error;
    }
  }

  static async updateProfile(driverId: string, updates: Partial<Driver>): Promise<void> {
    try {
      const updateData: any = {
        ...updates,
        updatedAt: Helpers.getCurrentTimestamp(),
      };

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
      return await Database.query<Driver>(
        config.dynamodb.driversTable,
        'status-index',
        '#status = :status',
        { '#status': 'status' },
        { ':status': status }
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
