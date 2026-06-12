import { Load, Driver, DriverStatus } from '../types';
import { LoadService } from './loadService';
import { DriverService } from './driverService';
import { OfferService } from './offerService';
import { CapacityService } from './capacityService';
import { GeolocationService } from './geolocationService';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

export class BroadcastService {
  static async broadcastLoad(loadId: string): Promise<void> {
    try {
      const load = await LoadService.getLoadById(loadId);
      
      if (!load) {
        throw new Error('Load not found');
      }
      
      // Get all VERIFIED and AVAILABLE drivers
      const verifiedDrivers = await DriverService.getDriversByStatus(DriverStatus.VERIFIED);
      const availableDrivers = await DriverService.getDriversByStatus(DriverStatus.AVAILABLE);
      const allEligibleDrivers = [...verifiedDrivers, ...availableDrivers];
      
      // Filter by radius
      const driversInRadius = GeolocationService.filterDriversByRadius(
        allEligibleDrivers,
        load.pickupLat,
        load.pickupLng,
        load.broadcastRadiusMiles
      );
      
      Logger.info(`Found ${driversInRadius.length} drivers within ${load.broadcastRadiusMiles} miles of load ${loadId}`);
      
      // Filter by capacity and requirements
      const eligibleDrivers: Array<Driver & { distanceMiles: number }> = [];
      
      for (const driver of driversInRadius) {
        // Check capacity
        const capacityCheck = CapacityService.canDriverHandleLoad(driver, load);
        if (!capacityCheck.canHandle) {
          Logger.debug(`Driver ${driver.driverId} excluded: ${capacityCheck.reason}`);
          continue;
        }
        
        // Check MC maturity
        const mcMaturityDays = Helpers.calculateMcMaturityDays(driver.authorityStartDate);
        if (mcMaturityDays < load.minMcMaturityDays) {
          Logger.debug(`Driver ${driver.driverId} excluded: MC maturity ${mcMaturityDays} < ${load.minMcMaturityDays} days`);
          continue;
        }
        
        // Check insurance
        if (driver.cargoInsuranceAmount < load.minCargoInsurance) {
          Logger.debug(`Driver ${driver.driverId} excluded: Cargo insurance $${driver.cargoInsuranceAmount} < $${load.minCargoInsurance}`);
          continue;
        }
        
        if (driver.liabilityInsuranceAmount < load.minLiabilityInsurance) {
          Logger.debug(`Driver ${driver.driverId} excluded: Liability insurance $${driver.liabilityInsuranceAmount} < $${load.minLiabilityInsurance}`);
          continue;
        }
        
        // Check endorsements
        const hasRequiredEndorsements = load.requiredEndorsements.every(
          endorsement => driver.endorsements.includes(endorsement)
        );
        
        if (!hasRequiredEndorsements) {
          Logger.debug(`Driver ${driver.driverId} excluded: Missing required endorsements`);
          continue;
        }
        
        // Check experience
        if (driver.experienceYears < load.experienceRequired) {
          Logger.debug(`Driver ${driver.driverId} excluded: Experience ${driver.experienceYears} < ${load.experienceRequired} years`);
          continue;
        }
        
        eligibleDrivers.push(driver);
      }
      
      Logger.info(`${eligibleDrivers.length} eligible drivers found for load ${loadId}`);
      
      // Create offers for eligible drivers
      let offersCreated = 0;
      for (const driver of eligibleDrivers) {
        try {
          await OfferService.createOffer(
            loadId,
            driver.driverId,
            driver.distanceMiles,
            load.offerTtlMinutes
          );
          offersCreated++;
        } catch (error) {
          Logger.error(`Failed to create offer for driver ${driver.driverId}`, error);
        }
      }
      
      // Update load with offer count
      await LoadService.updateLoad(loadId, {
        offeredDriverCount: offersCreated,
      });
      
      Logger.info(`Broadcast complete: ${offersCreated} offers created for load ${loadId}`);
    } catch (error) {
      Logger.error('Broadcast load error', error);
      throw error;
    }
  }
  
  static async rebroadcastExpiredLoads(): Promise<void> {
    try {
      // This function would be called by a scheduled job (e.g., EventBridge every minute)
      // to re-broadcast loads that have expired offers
      
      // Get all OPEN loads
      const openLoads = await LoadService.getLoadsByStatus('OPEN' as any);
      
      for (const load of openLoads) {
        // Check if load has any active offers
        const offers = await OfferService.getOffersByLoad(load.loadId);
        const hasActiveOffers = offers.some(
          offer => offer.status === 'OFFERED' && !Helpers.isExpired(offer.expiresAt)
        );
        
        if (!hasActiveOffers && !load.assignedDriverId) {
          // Re-broadcast
          Logger.info(`Re-broadcasting load ${load.loadId}`);
          await this.broadcastLoad(load.loadId);
        }
      }
    } catch (error) {
      Logger.error('Rebroadcast expired loads error', error);
      throw error;
    }
  }

/**
 * Called when ONE driver comes online / updates location / updates load status.
 * Finds OPEN loads and creates an offer ONLY if driver is eligible.
 * This is how "loads stay in queue until a matching truck comes online".
 */
static async tryMatchOpenLoadsForDriver(driverId: string): Promise<number> {
  const driver = await DriverService.getProfileById(driverId);
  if (!driver) return 0;

  // Only available/verified drivers should be considered "online"
  if (![DriverStatus.AVAILABLE, DriverStatus.VERIFIED].includes(driver.status as any)) return 0;

  const openLoads = await LoadService.getLoadsByStatus('OPEN' as any);
  let offersCreated = 0;

  for (const load of openLoads) {
    // Skip if already assigned
    if ((load as any).assignedDriverId) continue;

    // Radius check (driver vs pickup)
    const distMiles = GeolocationService.calculateDistance(load.pickupLat, load.pickupLng, driver.currentLat, driver.currentLng);
    if (distMiles > load.broadcastRadiusMiles) continue;

    // Capacity check
    const cap = CapacityService.canDriverHandleLoad(driver as any, load as any);
    if (!cap.canHandle) continue;

    // MC maturity check
    const mcDays = Helpers.calculateMcMaturityDays(driver.authorityStartDate);
    if (mcDays < load.minMcMaturityDays) continue;

    // Insurance checks
    if (driver.cargoInsuranceAmount < load.minCargoInsurance) continue;
    if (driver.liabilityInsuranceAmount < load.minLiabilityInsurance) continue;

    // Endorsements
    const okEndorse = load.requiredEndorsements.every((e: string) => (driver.endorsements || []).includes(e));
    if (!okEndorse) continue;

    // Experience
    if (driver.experienceYears < load.experienceRequired) continue;

    // Don't duplicate an active offer
    const existing = await OfferService.getOffer(load.loadId, driver.driverId);
    if (existing && existing.status === 'OFFERED' && existing.expiresAt > Helpers.getCurrentTimestamp()) continue;

    await OfferService.createOffer(load.loadId, driver.driverId, distMiles, load.offerTtlMinutes);
    offersCreated += 1;
  }

  return offersCreated;
}

}
