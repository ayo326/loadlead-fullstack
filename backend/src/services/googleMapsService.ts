// All external calls now route through services/integrations/maps.ts — this
// class's public method signatures and return shapes are unchanged, so
// RoutingService and every other caller needs zero changes.
import * as MapsAdapter from './integrations/maps';

type LatLng = { lat: number; lng: number };

export class GoogleMapsService {
  static getKey() {
    return process.env.GOOGLE_MAPS_API_KEY || '';
  }

  static hasKey() {
    return Boolean(this.getKey());
  }

  static async distanceMatrixMilesAndDuration(origin: LatLng, dest: LatLng): Promise<{
    miles: number;
    durationSeconds: number | null;
    durationText: string | null;
    distanceText: string | null;
  } | null> {
    return MapsAdapter.distanceMatrixMilesAndDuration(origin, dest);
  }

  static async reverseGeocodeCityState(lat: number, lng: number): Promise<{ city?: string; state?: string } | null> {
    return MapsAdapter.reverseGeocodeCityState(lat, lng);
  }
}
