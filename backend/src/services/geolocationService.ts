import { Driver } from '../types';
import Logger from '../utils/logger';

export class GeolocationService {
  private static toRad(value: number) {
    return (value * Math.PI) / 180;
  }

  // Returns distance in miles
  static calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    try {
      const R = 3958.7613; // Earth radius in miles
      const dLat = this.toRad(lat2 - lat1);
      const dLng = this.toRad(lng2 - lng1);

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const miles = R * c;

      return Math.round(miles * 100) / 100;
    } catch (error) {
      Logger.error('Calculate distance error', error);
      return 0;
    }
  }

  static isWithinRadius(lat1: number, lng1: number, lat2: number, lng2: number, radiusMiles: number): boolean {
    const distance = this.calculateDistance(lat1, lng1, lat2, lng2);
    return distance <= radiusMiles;
  }

  static filterDriversByRadius(
    drivers: Driver[],
    pickupLat: number,
    pickupLng: number,
    radiusMiles: number
  ): Array<Driver & { distanceMiles: number }> {
    return drivers
      .map(driver => ({
        ...driver,
        distanceMiles: this.calculateDistance(pickupLat, pickupLng, driver.currentLat, driver.currentLng),
      }))
      .filter(driver => driver.distanceMiles <= radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
  }
}
