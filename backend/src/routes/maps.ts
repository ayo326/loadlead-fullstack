import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';

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

export default router;
