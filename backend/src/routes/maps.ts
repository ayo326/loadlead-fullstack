import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { GoogleMapsService } from '../services/googleMapsService';

const router = Router();

type LatLng = { lat: number; lng: number };

async function googleGeocode(address: string, apiKey: string): Promise<LatLng | null> {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(address) +
    '&key=' +
    encodeURIComponent(apiKey);

  const res = await fetch(url);
  const data: any = await res.json();

  if (data?.status !== 'OK' || !data?.results?.length) return null;
  const loc = data.results[0]?.geometry?.location;
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;

  return { lat: loc.lat, lng: loc.lng };
}

async function googleDistanceMiles(origin: LatLng, dest: LatLng, apiKey: string): Promise<number | null> {
  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial' +
    '&origins=' + encodeURIComponent(`${origin.lat},${origin.lng}`) +
    '&destinations=' + encodeURIComponent(`${dest.lat},${dest.lng}`) +
    '&key=' + encodeURIComponent(apiKey);

  const res = await fetch(url);
  const data: any = await res.json();

  const el = data?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') return null;

  const meters = el?.distance?.value;
  if (typeof meters !== 'number') return null;

  // meters -> miles
  return meters / 1609.344;
}

/**
 * POST /api/maps/estimate
 * body: { originText: string, destinationText: string }
 * returns: { totalMiles: number }
 */
router.post(
  '/estimate',
  asyncHandler(async (req, res) => {
    const { originText, destinationText } = (req.body ?? {}) as {
      originText?: string;
      destinationText?: string;
    };

    if (!originText || !destinationText) {
      return res.status(400).json({ error: 'originText and destinationText are required' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey || apiKey.startsWith('YOUR_')) {
      return res.status(500).json({ error: 'Server GOOGLE_MAPS_API_KEY is missing/invalid' });
    }

    const origin = await googleGeocode(originText, apiKey);
    const dest = await googleGeocode(destinationText, apiKey);
    if (!origin || !dest) return res.status(422).json({ error: 'Unable to geocode' });

    const miles = await googleDistanceMiles(origin, dest, apiKey);
    if (miles == null) return res.status(422).json({ error: 'Unable to calculate distance' });

    const totalMiles = Math.round(miles * 10) / 10; // 1 decimal
    res.json({ totalMiles });
  })
);

/**
 * GET /api/maps/geocode?address=...
 * Returns { lat, lng } for any address string.
 * Called by the PostLoad form before submitting a draft so coordinates are
 * always stored on the load and the broadcast radius check never gets null.
 */
router.get(
  '/geocode',
  asyncHandler(async (req, res) => {
    const { address } = req.query as { address?: string };
    if (!address?.trim()) {
      return res.status(400).json({ error: 'address query param is required' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) {
      return res.status(503).json({ error: 'Server geocoding unavailable - GOOGLE_MAPS_API_KEY not configured' });
    }

    let coords: LatLng | null = null;
    try {
      coords = await googleGeocode(address.trim(), apiKey);
    } catch (err: any) {
      return res.status(503).json({ error: `Geocoding failed: ${err.message}` });
    }

    if (!coords) {
      return res.status(422).json({
        error: 'Unable to geocode address - verify street, city, state, and zip are correct',
      });
    }

    res.json(coords); // { lat, lng }
  })
);

/**
 * GET /api/maps/autocomplete?q=...
 * Address suggestions as the user types (US addresses). Proxies Google Places
 * Autocomplete with the server-side key. Degrades to an empty list on any
 * non-OK status (for example REQUEST_DENIED when the Places API is not enabled
 * on the key), so the form still works with manual entry.
 */
router.get(
  '/autocomplete',
  asyncHandler(async (req, res) => {
    const q = String((req.query.q ?? '')).trim();
    if (q.length < 3) return res.json({ suggestions: [] });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) return res.json({ suggestions: [] });

    const url =
      'https://maps.googleapis.com/maps/api/place/autocomplete/json?input=' +
      encodeURIComponent(q) +
      '&types=address&components=country:us&key=' +
      encodeURIComponent(apiKey);

    try {
      const r = await fetch(url);
      const data: any = await r.json();
      if (data?.status !== 'OK') {
        if (data?.status && data.status !== 'ZERO_RESULTS') {
          console.warn(`[maps] autocomplete status=${data.status} ${data?.error_message ?? ''}`);
        }
        return res.json({ suggestions: [] });
      }
      const suggestions = (data.predictions ?? []).map((p: any) => ({
        description: p.description,
        placeId: p.place_id,
      }));
      res.json({ suggestions });
    } catch (err: any) {
      console.warn(`[maps] autocomplete failed: ${err?.message ?? err}`);
      res.json({ suggestions: [] });
    }
  })
);

/**
 * GET /api/maps/place?placeId=...
 * Resolve a selected suggestion to structured address parts to fill the form.
 */
router.get(
  '/place',
  asyncHandler(async (req, res) => {
    const placeId = String((req.query.placeId ?? '')).trim();
    if (!placeId) return res.status(400).json({ error: 'placeId is required' });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) return res.status(503).json({ error: 'maps unavailable' });

    const url =
      'https://maps.googleapis.com/maps/api/place/details/json?place_id=' +
      encodeURIComponent(placeId) +
      '&fields=address_component,formatted_address&key=' +
      encodeURIComponent(apiKey);

    const r = await fetch(url);
    const data: any = await r.json();
    if (data?.status !== 'OK' || !data?.result) {
      return res.status(422).json({ error: `Unable to resolve place (${data?.status ?? 'unknown'})` });
    }

    const comps: any[] = data.result.address_components ?? [];
    const get = (type: string, short = false) => {
      const c = comps.find((x) => (x.types ?? []).includes(type));
      return c ? (short ? c.short_name : c.long_name) : '';
    };
    const streetNumber = get('street_number');
    const route = get('route');
    res.json({
      street: [streetNumber, route].filter(Boolean).join(' '),
      city: get('locality') || get('sublocality') || get('postal_town'),
      state: get('administrative_area_level_1', true),
      zip: get('postal_code'),
      formatted: data.result.formatted_address ?? '',
    });
  })
);

/**
 * GET /api/maps/reverse-geocode?lat=...&lng=...
 * Returns { city, state } for GPS coordinates.
 * Called by the driver app to get a readable location name from browser GPS.
 */
router.get(
  '/reverse-geocode',
  asyncHandler(async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid lat and lng query params are required' });
    }

    const result = await GoogleMapsService.reverseGeocodeCityState(lat, lng);
    if (!result || (!result.city && !result.state)) {
      return res.status(422).json({ error: 'Unable to reverse geocode coordinates' });
    }

    res.json({ city: result.city ?? '', state: result.state ?? '' });
  })
);

export default router;
