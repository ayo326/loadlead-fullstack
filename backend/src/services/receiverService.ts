import { Receiver } from '../types';
import { Database } from '../config/database';
import { queryIndexOrScan } from '../utils/indexQuery';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

export class ReceiverService {
  static async createProfile(userId: string, data: Partial<Receiver>): Promise<Receiver> {
    try {
      const receiverId = Helpers.generateId('receiver');
      const now = Helpers.getCurrentTimestamp();

      const receiver: Receiver = {
        receiverId,
        userId,

        // ReceiverProfiles schema integration
        orgId: data.orgId,
        appointmentRequired: data.appointmentRequired ?? false,
        dockType: data.dockType || '',

        facilityName: data.facilityName!,
        facilityAddress: data.facilityAddress!,
        contactName: data.contactName!,
        contactPhone: data.contactPhone!,
        contactEmail: data.contactEmail!,
        receivingHours: data.receivingHours || {},
        specialInstructions: data.specialInstructions,
        createdAt: now,
        updatedAt: now,
      };

      await Database.putItem(config.dynamodb.receiversTable, receiver);
      Logger.info(`Receiver profile created: ${receiverId}`);
      return receiver;
    } catch (error) {
      Logger.error('Create receiver profile error', error);
      throw error;
    }
  }

  static async getProfileByUserId(userId: string): Promise<Receiver | null> {
    try {
      // COA-3 / audit v6 H8: query the existing userId-index instead of a
      // full-table scan on this hot auth path. Guarded fallback to the scan.
      const receivers = await queryIndexOrScan<Receiver>(
        config.dynamodb.receiversTable,
        'userId-index',
        'userId',
        userId,
        () => Database.scan<Receiver>(config.dynamodb.receiversTable, 'userId = :userId', { ':userId': userId }),
        'ReceiverService.getProfileByUserId',
      );

      return receivers.length > 0 ? receivers[0] : null;
    } catch (error) {
      Logger.error('Get receiver profile error', error);
      throw error;
    }
  }

  static async getProfileById(receiverId: string): Promise<Receiver | null> {
    try {
      return await Database.getItem<Receiver>(config.dynamodb.receiversTable, { receiverId });
    } catch (error) {
      Logger.error('Get receiver by ID error', error);
      throw error;
    }
  }

  static async updateProfile(receiverId: string, updates: Partial<Receiver>): Promise<void> {
    try {
      const updateData = {
        ...updates,
        updatedAt: Helpers.getCurrentTimestamp(),
      };

      await Database.updateItem(config.dynamodb.receiversTable, { receiverId }, updateData);
      Logger.info(`Receiver profile updated: ${receiverId}`);
    } catch (error) {
      Logger.error('Update receiver profile error', error);
      throw error;
    }
  }
}
