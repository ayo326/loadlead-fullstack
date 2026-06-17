import { Load } from '../types';

type Coord = { lat: number; lng: number };

function buildAddress(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
}

function toMiles(meters: number) {
  return meters / 1609.344;
}

async function googleGeocode(address: string, apiKey: string): Promise<Coord | null> {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(address) +
    '&key=' +
    encodeURIComponent(apiKey);

  let res: Response;
  try {
    res = await fetch(url as any);
  } catch (err) {
    console.warn('Geocode network error:', (err as Error).message);
    return null;
  }
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok || data?.status !== 'OK') {
    console.warn('Geocode failed:', { http: res.status, status: data?.status, error: data?.error_message });
    return null;
  }

  const loc = data?.results?.[0]?.geometry?.location;
  if (!loc) return null;

  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

/**
 * IMPORTANT:
 * Distance Matrix `distance.value` is in METERS, regardless of units=imperial.
 */
async function googleDistanceMiles(origin: Coord, dest: Coord, apiKey: string): Promise<number | null> {
  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json?' +
    'origins=' +
    encodeURIComponent(`${origin.lat},${origin.lng}`) +
    '&destinations=' +
    encodeURIComponent(`${dest.lat},${dest.lng}`) +
    '&mode=driving' +
    '&units=imperial' +
    '&key=' +
    encodeURIComponent(apiKey);

  let res: Response;
  try {
    res = await fetch(url as any);
  } catch (err) {
    console.warn('Distance Matrix network error:', (err as Error).message);
    return null;
  }
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok || data?.status !== 'OK') {
    console.warn('Distance Matrix failed:', { http: res.status, status: data?.status, error: data?.error_message });
    return null;
  }

  const el = data?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') {
    console.warn('Distance Matrix element not OK:', { elementStatus: el?.status });
    return null;
  }

  const meters = Number(el?.distance?.value);
  if (!Number.isFinite(meters) || meters <= 0) return null;

  return toMiles(meters);
}

export class RoutingService {
  /**
   * Google Distance Matrix: returns miles + durationSeconds + durationText
   */
  static async distanceMatrixMilesAndDuration(origin: Coord, dest: Coord) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return null;

    const url =
      'https://maps.googleapis.com/maps/api/distancematrix/json?' +
      'origins=' + encodeURIComponent(`${origin.lat},${origin.lng}`) +
      '&destinations=' + encodeURIComponent(`${dest.lat},${dest.lng}`) +
      '&mode=driving' +
      '&units=imperial' +
      '&key=' + encodeURIComponent(apiKey);

    let res: Response;
    try {
      res = await fetch(url as any);
    } catch (err) {
      console.warn('Distance Matrix (ETA) network error:', (err as Error).message);
      return null;
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.status !== 'OK') return null;

    const el = data?.rows?.[0]?.elements?.[0];
    if (!el || el.status !== 'OK') return null;

    const meters = Number(el?.distance?.value ?? 0);
    const seconds = Number(el?.duration?.value ?? 0);
    if (!Number.isFinite(meters) || meters <= 0) return null;

    return {
      miles: Math.round((meters / 1609.344) * 10) / 10,
      durationSeconds: seconds,
      durationText: el?.duration?.text,
    };
  }
  /**
   * Returns patch: pickupLat/pickupLng/deliveryLat/deliveryLng/totalMiles
   * Uses GOOGLE Geocoding + GOOGLE Distance Matrix.
   */
  static async enrichLoadRoute(load: Partial<Load>): Promise<Partial<Load> | null> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn('GOOGLE_MAPS_API_KEY missing in backend env; cannot compute Google miles.');
      return null;
    }

    const pickupText = buildAddress([load.pickupAddress, load.pickupCity, load.pickupState, load.pickupZip]);
    const deliveryText = buildAddress([load.deliveryAddress, load.deliveryCity, load.deliveryState, load.deliveryZip]);

    if (!pickupText || !deliveryText) return null;

    const origin = await googleGeocode(pickupText, apiKey);
    const dest = await googleGeocode(deliveryText, apiKey);

    if (!origin || !dest) return null;

    const miles = await googleDistanceMiles(origin, dest, apiKey);
    if (miles == null) return null;

    const totalMiles = Math.round(miles * 10) / 10;

    return {
      pickupLat: origin.lat,
      pickupLng: origin.lng,
      deliveryLat: dest.lat,
      deliveryLng: dest.lng,
      totalMiles,
    };
  }

  /**
   * Geocode a single address string → { lat, lng } or null.
   * Used by BroadcastService as a fallback for loads that were drafted
   * before coordinates were required at submission time.
   */
  static async geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return null;
    try {
      return await googleGeocode(address, apiKey);
    } catch {
      return null;
    }
  }
}
