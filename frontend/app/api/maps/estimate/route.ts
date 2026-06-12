import { NextResponse } from 'next/server';

type LatLng = { lat: number; lng: number };

function getKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
}

async function geocode(address: string, key: string): Promise<LatLng | null> {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(address) +
    '&key=' +
    encodeURIComponent(key);

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();

  if (!data || data.status !== 'OK' || !data.results?.length) return null;
  const loc = data.results[0]?.geometry?.location;
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;

  return { lat: loc.lat, lng: loc.lng };
}

async function distanceMiles(origin: LatLng, dest: LatLng, key: string): Promise<number | null> {
  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial' +
    '&origins=' + encodeURIComponent(`${origin.lat},${origin.lng}`) +
    '&destinations=' + encodeURIComponent(`${dest.lat},${dest.lng}`) +
    '&key=' + encodeURIComponent(key);

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();

  const el = data?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') return null;

  const meters = el.distance?.value;
  if (typeof meters !== 'number') return null;

  return meters * 0.000621371;
}

export async function GET(req: Request) {
  const key = getKey();
  if (!key) return NextResponse.json({ error: 'Missing GOOGLE_MAPS_API_KEY' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const originText = (searchParams.get('originText') || '').trim();
  const destinationText = (searchParams.get('destinationText') || '').trim();

  if (!originText || !destinationText) {
    return NextResponse.json({ error: 'originText and destinationText are required' }, { status: 400 });
  }

  const origin = await geocode(originText, key);
  const dest = await geocode(destinationText, key);
  if (!origin || !dest) return NextResponse.json({ error: 'Geocode failed' }, { status: 400 });

  const miles = await distanceMiles(origin, dest, key);
  if (miles == null) return NextResponse.json({ error: 'Distance matrix failed' }, { status: 400 });

  const totalMiles = Math.round(miles * 10) / 10;

  return NextResponse.json({
    pickupLat: origin.lat,
    pickupLng: origin.lng,
    deliveryLat: dest.lat,
    deliveryLng: dest.lng,
    totalMiles,
  });
}
