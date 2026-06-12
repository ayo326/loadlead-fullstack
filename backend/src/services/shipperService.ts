import { Shipper } from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

export class ShipperService {
  private static toTimestamp(value?: number | string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  static async createProfile(userId: string, data: Partial<Shipper>): Promise<Shipper> {
    try {
      const shipperId = Helpers.generateId('shipper');
      const now = Helpers.getCurrentTimestamp();

      const shipper: Shipper = {
        shipperId,
        userId,

        companyName: data.companyName!,
        companyAddress: data.companyAddress!,
        legalName: data.legalName,
        dba: data.dba,
        orgType: data.orgType,
        city: data.city,
        state: data.state,
        zip: data.zip,
        country: data.country,
        mcNumber: data.mcNumber,
        dotNumber: data.dotNumber,
        mcIssueDate: this.toTimestamp(data.mcIssueDate),

        contactName: data.contactName!,
        contactPhone: data.contactPhone!,
        contactEmail: data.contactEmail!,

        // ShipperProfiles schema integration
        orgId: data.orgId,
        freightTypes: data.freightTypes || [],
        avgMonthlyVolume: data.avgMonthlyVolume || 0,
        preferredEquipment: data.preferredEquipment || [],
        billingTerms: data.billingTerms || '',

        // CarrierProfiles schema integration
        carrierType: data.carrierType || '',
        operatingAuthorityStatus: data.operatingAuthorityStatus || '',
        safetyRating: data.safetyRating || '',
        operatingRegions: data.operatingRegions || [],

        isShipperAdmin: false,
        shipperAdminStatus: 'NONE',
        defaultBroadcastRadius: data.defaultBroadcastRadius || config.app.broadcastRadius,
        defaultMinMcMaturity: data.defaultMinMcMaturity || config.app.minMcMaturity,
        createdAt: now,
        updatedAt: now,
      };

      await Database.putItem(config.dynamodb.shippersTable, shipper);
      Logger.info(`Shipper profile created: ${shipperId}`);
      return shipper;
    } catch (error) {
      Logger.error('Create shipper profile error', error);
      throw error;
    }
  }

  static async getProfileByUserId(userId: string): Promise<Shipper | null> {
    try {
      const shippers = await Database.scan<Shipper>(
        config.dynamodb.shippersTable,
        'userId = :userId',
        { ':userId': userId }
      );

      return shippers.length > 0 ? shippers[0] : null;
    } catch (error) {
      Logger.error('Get shipper profile error', error);
      throw error;
    }
  }

  static async getProfileById(shipperId: string): Promise<Shipper | null> {
    try {
      return await Database.getItem<Shipper>(config.dynamodb.shippersTable, { shipperId });
    } catch (error) {
      Logger.error('Get shipper by ID error', error);
      throw error;
    }
  }

  static async updateProfile(shipperId: string, updates: Partial<Shipper>): Promise<void> {
    try {
      const updateData: any = {
        ...updates,
        updatedAt: Helpers.getCurrentTimestamp(),
      };

      if (typeof updateData.mcIssueDate === 'string') {
        const parsed = Date.parse(updateData.mcIssueDate);
        if (!Number.isNaN(parsed)) updateData.mcIssueDate = parsed;
      }

      await Database.updateItem(config.dynamodb.shippersTable, { shipperId }, updateData);
      Logger.info(`Shipper profile updated: ${shipperId}`);
    } catch (error) {
      Logger.error('Update shipper profile error', error);
      throw error;
    }
  }

  static async requestAdminPrivileges(shipperId: string): Promise<void> {
    try {
      await this.updateProfile(shipperId, { shipperAdminStatus: 'PENDING' });
      Logger.info(`Shipper requested admin privileges: ${shipperId}`);
    } catch (error) {
      Logger.error('Request admin privileges error', error);
      throw error;
    }
  }

  static async approveAdminPrivileges(shipperId: string): Promise<void> {
    try {
      await this.updateProfile(shipperId, {
        isShipperAdmin: true,
        shipperAdminStatus: 'APPROVED',
      });
      Logger.info(`Shipper admin privileges approved: ${shipperId}`);
    } catch (error) {
      Logger.error('Approve admin privileges error', error);
      throw error;
    }
  }

  static async revokeAdminPrivileges(shipperId: string): Promise<void> {
    try {
      await this.updateProfile(shipperId, {
        isShipperAdmin: false,
        shipperAdminStatus: 'NONE',
      });
      Logger.info(`Shipper admin privileges revoked: ${shipperId}`);
    } catch (error) {
      Logger.error('Revoke admin privileges error', error);
      throw error;
    }
  }

  static async getPendingAdminRequests(): Promise<Shipper[]> {
    try {
      const shippers = await Database.scan<Shipper>(config.dynamodb.shippersTable);
      return shippers.filter((s) => s.shipperAdminStatus === 'PENDING');
    } catch (error) {
      Logger.error('Get pending admin requests error', error);
      throw error;
    }
  }
}
