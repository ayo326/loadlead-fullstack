import { v4 as uuidv4 } from 'uuid';
import { Offer, OfferStatus } from '../types';
import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';
import { LoadService } from './loadService';

/**
 * OfferService — all DynamoDB calls use the correct key schema.
 *
 * LoadLead_Offers table layout
 *   PK:   offerId  (hash)
 *   GSIs: loadId-index               → query by loadId
 *         driverId-index             → query by driverId
 *         driverId-status-index      → query by driverId + status
 *         loadId-driverId-index      → query by loadId + driverId (unique lookup)
 *
 * Every getOffer / updateItem / deleteItem goes through an offerId lookup first.
 */

export class OfferService {
  // ── CREATE ─────────────────────────────────────────────────────────────────

  static async createOffer(
    loadId: string,
    driverId: string,
    driverDistanceMiles: number,
    ttlMinutes: number,
  ): Promise<Offer> {
    try {
      const now = Helpers.getCurrentTimestamp();
      const offer: Offer = {
        offerId: uuidv4(),      // PK — must be present on every PutItem
        loadId,
        driverId,
        status: OfferStatus.OFFERED,
        createdAt: now,
        expiresAt: Helpers.getFutureTimestamp(ttlMinutes),
        driverDistanceMiles,
      };

      await Database.putItem(config.dynamodb.offersTable, offer);
      Logger.info(`Offer created: ${offer.offerId} | Load ${loadId} → Driver ${driverId}`);
      return offer;
    } catch (error) {
      Logger.error('Create offer error', error);
      throw error;
    }
  }

  // ── LOOKUP HELPERS ─────────────────────────────────────────────────────────

  /**
   * Fetch a single offer by loadId + driverId using the loadId-driverId-index GSI.
   * Returns null if no offer exists for this pair.
   */
  static async getOffer(loadId: string, driverId: string): Promise<Offer | null> {
    try {
      const results = await Database.query<Offer>(
        config.dynamodb.offersTable,
        'loadId-driverId-index',
        '#loadId = :loadId AND #driverId = :driverId',
        { '#loadId': 'loadId', '#driverId': 'driverId' },
        { ':loadId': loadId, ':driverId': driverId },
      );
      return results[0] ?? null;
    } catch (error) {
      Logger.error('Get offer error', error);
      throw error;
    }
  }

  /**
   * Get all offers for a driver (active + historical).
   */
  static async getOffersByDriver(driverId: string): Promise<Offer[]> {
    try {
      return await Database.query<Offer>(
        config.dynamodb.offersTable,
        'driverId-status-index',
        '#driverId = :driverId',
        { '#driverId': 'driverId' },
        { ':driverId': driverId },
      );
    } catch (error) {
      Logger.error('Get offers by driver error', error);
      throw error;
    }
  }

  /**
   * Get only OFFERED (not yet decided) and non-expired offers for a driver.
   */
  static async getActiveOffersByDriver(driverId: string): Promise<Offer[]> {
    try {
      const offers = await this.getOffersByDriver(driverId);
      const now = Helpers.getCurrentTimestamp();
      return offers.filter(
        o => o.status === OfferStatus.OFFERED && o.expiresAt > now,
      );
    } catch (error) {
      Logger.error('Get active offers by driver error', error);
      throw error;
    }
  }

  /**
   * Get all offers for a load using the loadId-index GSI (no scan).
   */
  static async getOffersByLoad(loadId: string): Promise<Offer[]> {
    try {
      return await Database.query<Offer>(
        config.dynamodb.offersTable,
        'loadId-index',
        '#loadId = :loadId',
        { '#loadId': 'loadId' },
        { ':loadId': loadId },
      );
    } catch (error) {
      Logger.error('Get offers by load error', error);
      throw error;
    }
  }

  // ── ACCEPT ────────────────────────────────────────────────────────────────

  static async acceptOffer(loadId: string, driverId: string): Promise<void> {
    try {
      const offer = await this.getOffer(loadId, driverId);

      if (!offer) throw new AppError('Offer not found', 404);
      if (offer.status !== OfferStatus.OFFERED) throw new AppError('Offer is no longer available', 400);
      if (Helpers.isExpired(offer.expiresAt)) throw new AppError('Offer has expired', 400);

      const load = await LoadService.getLoadById(loadId);
      if (!load) throw new AppError('Load not found', 404);
      if (load.assignedDriverId) throw new AppError('Load has already been assigned to another driver', 409);

      // A load under an active negotiation belongs to the engaged hauler only.
      const { NegotiationService } = await import('./negotiationService');
      const lock = await NegotiationService.lockFor(loadId);
      if (lock && lock.haulerDriverId !== driverId) {
        throw new AppError('Load is no longer available', 409);
      }

      const now = Helpers.getCurrentTimestamp();

      // Update by offerId (the real PK)
      await Database.updateItem(
        config.dynamodb.offersTable,
        { offerId: offer.offerId },
        { status: OfferStatus.ACCEPTED, acceptedAt: now },
      );

      // Assign load to driver
      await LoadService.assignDriver(loadId, driverId);

      // Expire all other open offers for this load
      const allOffers = await this.getOffersByLoad(loadId);
      for (const other of allOffers) {
        if (other.driverId !== driverId && other.status === OfferStatus.OFFERED) {
          await Database.updateItem(
            config.dynamodb.offersTable,
            { offerId: other.offerId },
            { status: OfferStatus.EXPIRED },
          );
        }
      }

      Logger.info(`Offer accepted: Load ${loadId} by Driver ${driverId}`);
    } catch (error) {
      Logger.error('Accept offer error', error);
      throw error;
    }
  }

  // ── DECLINE ───────────────────────────────────────────────────────────────

  static async declineOffer(loadId: string, driverId: string): Promise<void> {
    try {
      const offer = await this.getOffer(loadId, driverId);
      if (!offer) throw new AppError('Offer not found', 404);

      await Database.updateItem(
        config.dynamodb.offersTable,
        { offerId: offer.offerId },
        { status: OfferStatus.DECLINED, declinedAt: Helpers.getCurrentTimestamp() },
      );

      Logger.info(`Offer declined: Load ${loadId} by Driver ${driverId}`);
    } catch (error) {
      Logger.error('Decline offer error', error);
      throw error;
    }
  }

  // ── EXPIRE ────────────────────────────────────────────────────────────────

  static async expireOffer(loadId: string, driverId: string): Promise<void> {
    try {
      const offer = await this.getOffer(loadId, driverId);
      if (!offer) return; // already gone — no-op

      await Database.updateItem(
        config.dynamodb.offersTable,
        { offerId: offer.offerId },
        { status: OfferStatus.EXPIRED },
      );

      Logger.info(`Offer expired: Load ${loadId} → Driver ${driverId}`);
    } catch (error) {
      Logger.error('Expire offer error', error);
      throw error;
    }
  }
}
