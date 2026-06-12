import { Driver, Load } from '../types';
import { AppError } from '../middleware/errorHandler';
import Logger from '../utils/logger';

export class CapacityService {
  static canDriverHandleLoad(driver: Driver, load: Load): { canHandle: boolean; reason?: string } {
    try {
      // Check if driver has enough capacity
      const availableCapacity = driver.maxCapacityLbs - driver.currentLoadLbs;
      
      if (availableCapacity < load.totalWeightLbs) {
        return {
          canHandle: false,
          reason: `Insufficient capacity: Available ${availableCapacity} lbs, Required ${load.totalWeightLbs} lbs`,
        };
      }
      
      // Check if load would overload the truck
      const totalLoadAfterPickup = driver.currentLoadLbs + load.totalWeightLbs;
      
      if (totalLoadAfterPickup > driver.maxCapacityLbs) {
        return {
          canHandle: false,
          reason: `Would cause overload: Current ${driver.currentLoadLbs} lbs + Load ${load.totalWeightLbs} lbs > Max ${driver.maxCapacityLbs} lbs`,
        };
      }
      
      // Check trailer type match
      if (driver.trailerType !== load.equipmentType) {
        return {
          canHandle: false,
          reason: `Equipment type mismatch: Driver has ${driver.trailerType}, Load requires ${load.equipmentType}`,
        };
      }
      
      // Check dimensions if specified
      if (load.length && driver.trailerLength < load.length) {
        return {
          canHandle: false,
          reason: `Length insufficient: Load ${load.length} ft, Trailer ${driver.trailerLength} ft`,
        };
      }
      
      if (load.width && driver.trailerWidth < load.width) {
        return {
          canHandle: false,
          reason: `Width insufficient: Load ${load.width} ft, Trailer ${driver.trailerWidth} ft`,
        };
      }
      
      if (load.height && driver.trailerHeight < load.height) {
        return {
          canHandle: false,
          reason: `Height insufficient: Load ${load.height} ft, Trailer ${driver.trailerHeight} ft`,
        };
      }
      
      return { canHandle: true };
    } catch (error) {
      Logger.error('Check driver capacity error', error);
      return { canHandle: false, reason: 'Error checking capacity' };
    }
  }
  
  static calculateAvailableCapacity(driver: Driver): number {
    return driver.maxCapacityLbs - driver.currentLoadLbs;
  }
  
  static wouldOverload(driver: Driver, additionalWeightLbs: number): boolean {
    return (driver.currentLoadLbs + additionalWeightLbs) > driver.maxCapacityLbs;
  }
}
