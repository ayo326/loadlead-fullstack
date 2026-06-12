import { Offer, OfferStatus } from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';
import { LoadService } from './loadService';

export class OfferService {
  static async createOffer(loadId: string, driverId: string, driverDistanceMiles: number, ttlMinutes: number): Promise<Offer> {
    try {
      const now = Helpers.getCurrentTimestamp();
      const expiresAt = Helpers.getFutureTimestamp(ttlMinutes);
      
      const offer: Offer = {
        loadId,
        driverId,
        status: OfferStatus.OFFERED,
        createdAt: now,
        expiresAt,
        driverDistanceMiles,
      };
      
      await Database.putItem(config.dynamodb.offersTable, offer);
      
      Logger.info(`Offer created: Load ${loadId} -> Driver ${driverId}`);
      
      return offer;
    } catch (error) {
      Logger.error('Create offer error', error);
      throw error;
    }
  }
  
  static async getOffer(loadId: string, driverId: string): Promise<Offer | null> {
    try {
      return await Database.getItem<Offer>(config.dynamodb.offersTable, { loadId, driverId });
    } catch (error) {
      Logger.error('Get offer error', error);
      throw error;
    }
  }
  
  static async getOffersByDriver(driverId: string): Promise<Offer[]> {
    try {
      return await Database.query<Offer>(
        config.dynamodb.offersTable,
        'driverId-status-index',
        '#driverId = :driverId',
        { '#driverId': 'driverId' },
        { ':driverId': driverId }
      );
    } catch (error) {
      Logger.error('Get offers by driver error', error);
      throw error;
    }
  }
  
  static async getActiveOffersByDriver(driverId: string): Promise<Offer[]> {
    try {
      const offers = await this.getOffersByDriver(driverId);
      const now = Helpers.getCurrentTimestamp();
      
      // Filter only OFFERED status and not expired
      return offers.filter(
        offer => offer.status === OfferStatus.OFFERED && offer.expiresAt > now
      );
    } catch (error) {
      Logger.error('Get active offers by driver error', error);
      throw error;
    }
  }
  
  static async getOffersByLoad(loadId: string): Promise<Offer[]> {
    try {
      const offers = await Database.scan<Offer>(
        config.dynamodb.offersTable,
        'loadId = :loadId',
        { ':loadId': loadId }
      );
      
      return offers;
    } catch (error) {
      Logger.error('Get offers by load error', error);
      throw error;
    }
  }
  
  static async acceptOffer(loadId: string, driverId: string): Promise<void> {
    try {
      // Check if offer exists and is valid
      const offer = await this.getOffer(loadId, driverId);
      
      if (!offer) {
        throw new AppError('Offer not found', 404);
      }
      
      if (offer.status !== OfferStatus.OFFERED) {
        throw new AppError('Offer is no longer available', 400);
      }
      
      if (Helpers.isExpired(offer.expiresAt)) {
        throw new AppError('Offer has expired', 400);
      }
      
      // Check if load is still available
      const load = await LoadService.getLoadById(loadId);
      
      if (!load) {
        throw new AppError('Load not found', 404);
      }
      
      if (load.assignedDriverId) {
        throw new AppError('Load has already been assigned', 400);
      }
      
      const now = Helpers.getCurrentTimestamp();
      
      // Update offer status to ACCEPTED
      await Database.updateItem(
        config.dynamodb.offersTable,
        { loadId, driverId },
        {
          status: OfferStatus.ACCEPTED,
          acceptedAt: now,
        }
      );
      
      // Assign load to driver
      await LoadService.assignDriver(loadId, driverId);
      
      // Mark all other offers for this load as EXPIRED
      const allOffers = await this.getOffersByLoad(loadId);
      for (const otherOffer of allOffers) {
        if (otherOffer.driverId !== driverId && otherOffer.status === OfferStatus.OFFERED) {
          await Database.updateItem(
            config.dynamodb.offersTable,
            { loadId: otherOffer.loadId, driverId: otherOffer.driverId },
            { status: OfferStatus.EXPIRED }
          );
        }
      }
      
      Logger.info(`Offer accepted: Load ${loadId} by Driver ${driverId}`);
    } catch (error) {
      Logger.error('Accept offer error', error);
      throw error;
    }
  }
  
  static async declineOffer(loadId: string, driverId: string): Promise<void> {
    try {
      const offer = await this.getOffer(loadId, driverId);
      
      if (!offer) {
        throw new AppError('Offer not found', 404);
      }
      
      const now = Helpers.getCurrentTimestamp();
      
      await Database.updateItem(
        config.dynamodb.offersTable,
        { loadId, driverId },
        {
          status: OfferStatus.DECLINED,
          declinedAt: now,
        }
      );
      
      Logger.info(`Offer declined: Load ${loadId} by Driver ${driverId}`);
    } catch (error) {
      Logger.error('Decline offer error', error);
      throw error;
    }
  }
  
  static async expireOffer(loadId: string, driverId: string): Promise<void> {
    try {
      await Database.updateItem(
        config.dynamodb.offersTable,
        { loadId, driverId },
        { status: OfferStatus.EXPIRED }
      );
      
      Logger.info(`Offer expired: Load ${loadId} -> Driver ${driverId}`);
    } catch (error) {
      Logger.error('Expire offer error', error);
      throw error;
    }
  }
}
