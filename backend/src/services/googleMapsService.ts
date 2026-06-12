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
    const key = this.getKey();
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

  static async reverseGeocodeCityState(lat: number, lng: number): Promise<{ city?: string; state?: string } | null> {
    const key = this.getKey();
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
}
