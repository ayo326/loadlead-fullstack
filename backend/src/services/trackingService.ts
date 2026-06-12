import config from '../config/environment';
import { Database } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { Driver, Load } from '../types';
import { ShipperService } from './shipperService';
import { LoadService } from './loadService';

type TrackingResponse = {
  loadId: string;
  assignedDriverId?: string;
  driver: null | {
    driverId: string;
    legalName: string;
    lat: number;
    lng: number;
    label: string; // "City, ST" if available, else "lat,lng"
    lastLocationUpdate: number;
  };
  etaToDelivery: null | {
    miles: number;
    minutes: number;
    arrivalAt: number; // epoch ms
  };
};

function buildAddress(parts: Array<string | number | null | undefined>) {
  return parts
    .map((p) => (p ?? '').toString().trim())
    .filter(Boolean)
    .join(', ');
}

async function googleGeocode(address: string, apiKey: string) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(address) +
    '&key=' +
    encodeURIComponent(apiKey);

  const r = await fetch(url);
  if (!r.ok) return null;
  const data: any = await r.json();
  if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) return null;

  const loc = data.results[0].geometry.location;
  return { lat: Number(loc.lat), lng: Number(loc.lng) };
}

async function googleDistanceEtaMilesMinutes(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  apiKey: string
) {
  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial' +
    '&origins=' +
    encodeURIComponent(`${origin.lat},${origin.lng}`) +
    '&destinations=' +
    encodeURIComponent(`${dest.lat},${dest.lng}`) +
    '&key=' +
    encodeURIComponent(apiKey);

  const r = await fetch(url);
  if (!r.ok) return null;
  const data: any = await r.json();

  const el = data?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') return null;

  const meters = Number(el.distance?.value ?? 0);
  const seconds = Number(el.duration?.value ?? 0);

  const miles = meters * 0.000621371;
  const minutes = Math.max(1, Math.round(seconds / 60));

  return { miles, minutes };
}

export class TrackingService {
  static async getLoadTrackingForShipper(loadId: string, shipperUserId: string): Promise<TrackingResponse> {
    const shipper = await ShipperService.getProfileByUserId(shipperUserId);
    if (!shipper) throw new AppError('Shipper profile not found', 404);

    const load = await LoadService.getLoadById(loadId);
    if (!load) throw new AppError('Load not found', 404);

    if (load.shipperId !== shipper.shipperId) throw new AppError('Forbidden', 403);

    return await this.buildTracking(load);
  }

  static async getLoadTrackingForAdmin(loadId: string): Promise<TrackingResponse> {
    const load = await LoadService.getLoadById(loadId);
    if (!load) throw new AppError('Load not found', 404);
    return await this.buildTracking(load);
  }

  private static async buildTracking(load: Load): Promise<TrackingResponse> {
    const apiKey = config.google.mapsApiKey;
    if (!apiKey) {
      return {
        loadId: load.loadId,
        assignedDriverId: load.assignedDriverId,
        driver: null,
        etaToDelivery: null,
      };
    }

    if (!load.assignedDriverId) {
      return {
        loadId: load.loadId,
        assignedDriverId: undefined,
        driver: null,
        etaToDelivery: null,
      };
    }

    const driver = await Database.getItem<Driver>(config.dynamodb.driversTable, {
      driverId: load.assignedDriverId,
    });

    if (!driver) {
      return {
        loadId: load.loadId,
        assignedDriverId: load.assignedDriverId,
        driver: null,
        etaToDelivery: null,
      };
    }

    // Driver last location
    const dLat = Number(driver.currentLat ?? 0);
    const dLng = Number(driver.currentLng ?? 0);

    const label =
      driver.currentCity && driver.currentState
        ? `${driver.currentCity}, ${driver.currentState}`
        : dLat && dLng
          ? `${dLat.toFixed(4)}, ${dLng.toFixed(4)}`
          : 'Location unavailable';

    // Delivery coords (prefer stored; fallback to geocode delivery address)
    let deliveryLat = Number(load.deliveryLat ?? 0);
    let deliveryLng = Number(load.deliveryLng ?? 0);

    if ((!deliveryLat || !deliveryLng) && load.deliveryAddress) {
      const deliveryText = buildAddress([load.deliveryAddress, load.deliveryCity, load.deliveryState, load.deliveryZip]);
      const dest = await googleGeocode(deliveryText, apiKey);
      if (dest) {
        deliveryLat = dest.lat;
        deliveryLng = dest.lng;
      }
    }

    let etaToDelivery: TrackingResponse['etaToDelivery'] = null;

    if (dLat && dLng && deliveryLat && deliveryLng) {
      const dm = await googleDistanceEtaMilesMinutes({ lat: dLat, lng: dLng }, { lat: deliveryLat, lng: deliveryLng }, apiKey);
      if (dm) {
        const miles = Math.round(dm.miles * 10) / 10;
        const minutes = dm.minutes;
        etaToDelivery = { miles, minutes, arrivalAt: Date.now() + minutes * 60_000 };
      }
    }

    return {
      loadId: load.loadId,
      assignedDriverId: load.assignedDriverId,
      driver: {
        driverId: driver.driverId,
        legalName: driver.legalName,
        lat: dLat,
        lng: dLng,
        label,
        lastLocationUpdate: Number(driver.lastLocationUpdate ?? 0),
      },
      etaToDelivery,
    };
  }
}
