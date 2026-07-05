// services/integrations/maps.ts
//
// Google Maps adapter. Ships to every environment, including production.
// Moved verbatim from services/googleMapsService.ts - GoogleMapsService now
// delegates here instead of calling fetch() directly; its public method
// signatures/return shapes are unchanged, so RoutingService and every other
// caller needs zero changes.

import { resolveMode } from './modeResolver';

type LatLng = { lat: number; lng: number };

type DistanceResult = {
  miles: number;
  durationSeconds: number | null;
  durationText: string | null;
  distanceText: string | null;
} | null;

type GeocodeResult = { city?: string; state?: string } | null;

interface MapsStubModule {
  default: {
    distanceMatrixMilesAndDuration(origin: LatLng, dest: LatLng): Promise<DistanceResult>;
    reverseGeocodeCityState(lat: number, lng: number): Promise<GeocodeResult>;
  };
}

// Built from parts for the same reason as fmcsa.ts's stub import - see that
// file's comment. Centralized here since both maps functions need it.
async function loadStub(): Promise<MapsStubModule['default']> {
  const modulePath = './stubs/' + 'maps' + 'Stub';
  const stubModule = (await import(modulePath)) as MapsStubModule;
  return stubModule.default;
}

function getKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY || '';
}

export async function distanceMatrixMilesAndDuration(origin: LatLng, dest: LatLng): Promise<DistanceResult> {
  if (resolveMode('maps') !== 'live') {
    const stub = await loadStub();
    return stub.distanceMatrixMilesAndDuration(origin, dest);
  }

  const key = getKey();
  if (!key) return null;
  if (!origin?.lat || !origin?.lng || !dest?.lat || !dest?.lng) return null;

  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json' +
    `?origins=${origin.lat},${origin.lng}` +
    `&destinations=${dest.lat},${dest.lng}` +
    `&units=imperial` +
    `&key=${encodeURIComponent(key)}`;

  const resp = await fetch(url);
  const data: any = await resp.json();

  if (data?.status !== 'OK') return null;

  const el = data?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') return null;

  const meters = el?.distance?.value ?? 0;
  const miles = meters / 1609.344;

  return {
    miles,
    durationSeconds: el?.duration?.value ?? null,
    durationText: el?.duration?.text ?? null,
    distanceText: el?.distance?.text ?? null,
  };
}

export async function reverseGeocodeCityState(lat: number, lng: number): Promise<GeocodeResult> {
  if (resolveMode('maps') !== 'live') {
    const stub = await loadStub();
    return stub.reverseGeocodeCityState(lat, lng);
  }

  const key = getKey();
  if (!key) return null;

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${lat},${lng}` +
    `&key=${encodeURIComponent(key)}`;

  const resp = await fetch(url);
  const data: any = await resp.json();
  if (data?.status !== 'OK') return null;

  const comps = data?.results?.[0]?.address_components ?? [];
  const get = (type: string) => comps.find((c: any) => (c.types || []).includes(type))?.short_name;

  const city = get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_2');
  const state = get('administrative_area_level_1');

  return { city, state };
}
