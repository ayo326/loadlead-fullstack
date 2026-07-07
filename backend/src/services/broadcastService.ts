import { Load, Driver, DriverStatus } from '../types';
import { LoadService } from './loadService';
import { DriverService } from './driverService';
import { OfferService } from './offerService';
import { CapacityService } from './capacityService';
import { EquipmentService, deriveLoadingRequirements } from './equipmentService';
import { GeolocationService } from './geolocationService';
import { RoutingService } from './routingService';
import { isFleetCarrierDriver } from './carrierOfRecord';
import { isFleetCarrierPersonaEnabled } from '../config/featureFlags';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

/**
 * Persona-aware pool filter for the broadcast/matching pool. While the
 * fleet-carrier persona is muted, drivers who haul under a fleet-carrier
 * organization are excluded from the pool, so no load is broadcast to a fleet
 * carrier. Owner-operator drivers (self and fleet) and unaffiliated drivers
 * are untouched, and the matching logic (equipment/capacity/insurance/etc.)
 * is not altered - this only narrows WHO is considered. When the persona is
 * enabled, the pool is returned unchanged with no extra reads.
 */
async function excludeMutedFleetCarriers<T extends Driver>(drivers: T[]): Promise<T[]> {
  if (isFleetCarrierPersonaEnabled()) return drivers;
  const keep = await Promise.all(drivers.map(async (d) => !(await isFleetCarrierDriver(d))));
  return drivers.filter((_, i) => keep[i]);
}

export class BroadcastService {
  static async broadcastLoad(loadId: string): Promise<void> {
    try {
      const load = await LoadService.getLoadById(loadId);
      
      if (!load) {
        throw new Error('Load not found');
      }

      // ── Geocoding fallback ────────────────────────────────────────────────────
      // New loads always arrive with coordinates (required at draft time).
      // This fallback handles historical loads that were drafted before that
      // requirement was added - so they're not stranded with zero offers.
      if (!load.pickupLat || !load.pickupLng) {
        const addr = [load.pickupAddress, load.pickupCity, load.pickupState, load.pickupZip]
          .filter(Boolean).join(', ');
        Logger.info(`Load ${loadId} has no pickup coords - attempting geocode: "${addr}"`);
        const coords = await RoutingService.geocodeAddress(addr);
        if (!coords) {
          Logger.warn(`Cannot broadcast load ${loadId}: pickup coords null and geocoding failed/unavailable`);
          return;
        }
        load.pickupLat = coords.lat;
        load.pickupLng = coords.lng;
        // Persist so rebroadcast also works
        await LoadService.updateLoad(loadId, { pickupLat: coords.lat, pickupLng: coords.lng });
        Logger.info(`Geocoded pickup for load ${loadId}: lat=${coords.lat} lng=${coords.lng}`);
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

      // Persona muting: drop fleet-carrier drivers from the pool while the
      // persona is off. No-op (and no extra reads) when the persona is on.
      const personaFilteredDrivers = await excludeMutedFleetCarriers(driversInRadius);
      if (personaFilteredDrivers.length !== driversInRadius.length) {
        Logger.info(
          `Persona filter: excluded ${driversInRadius.length - personaFilteredDrivers.length} ` +
          `fleet-carrier driver(s) from load ${loadId} pool (persona muted)`,
        );
      }

      // Filter by capacity and requirements
      const eligibleDrivers: Array<Driver & { distanceMiles: number }> = [];
      
      // Pre-compute derived loading requirements once per load (spec §11.3)
      const loadWithDerived = {
        ...load,
        derivedLoadingRequirements: load.derivedLoadingRequirements
          ?? deriveLoadingRequirements(
               (load as any).pickupFacility,
               (load as any).deliveryFacility,
             ),
      };

      for (const driver of personaFilteredDrivers) {
        // Step 1+2: equipment type + loading requirements (spec §11.4)
        const equipCheck = EquipmentService.checkEquipmentMatch(driver, loadWithDerived as any);
        if (!equipCheck.eligible) {
          Logger.debug(`Driver ${driver.driverId} excluded (equipment): ${equipCheck.reason}`);
          continue;
        }

        // Steps 3+4: capacity + geometric fit
        const capacityCheck = CapacityService.canDriverHandleLoad(driver, loadWithDerived as any);
        if (!capacityCheck.canHandle) {
          Logger.debug(`Driver ${driver.driverId} excluded (capacity): ${capacityCheck.reason}`);
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

  // Persona muting: a fleet-carrier driver coming online receives no offers
  // through this reverse-match path either, mirroring the broadcast pool
  // filter. Owner-operator and unaffiliated drivers are unaffected.
  if (!isFleetCarrierPersonaEnabled() && await isFleetCarrierDriver(driver)) return 0;

  const openLoads = await LoadService.getLoadsByStatus('OPEN' as any);
  let offersCreated = 0;

  for (const load of openLoads) {
    // Skip if already assigned
    if ((load as any).assignedDriverId) continue;

    // Radius check (driver vs pickup)
    const distMiles = GeolocationService.calculateDistance(load.pickupLat, load.pickupLng, driver.currentLat, driver.currentLng);
    if (distMiles > load.broadcastRadiusMiles) continue;

    // Steps 1+2: equipment + loading requirements
    const equipCheck = EquipmentService.checkEquipmentMatch(driver as any, load as any);
    if (!equipCheck.eligible) continue;

    // Steps 3+4: capacity + geometric fit
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
