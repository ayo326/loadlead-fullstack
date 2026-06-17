// LoadLead — Proof of Delivery (POD) gate
// assertPodComplete(loadId) is the single check factoring calls before releasing
// an invoice. It must pass before any invoice packet or factoring opt-in proceeds.
//
// Requirements (from §9 of IMPLEMENTATION.md):
//   - load.status === 'DELIVERED'
//   - BOL has a consignee signature (delivery receipt)
//   - BOL has >= MIN_POD_PHOTOS pod photos uploaded to S3
//   - Optional geofence: if load.deliveryLat/Lng exist, at least one photo must
//     have been captured within POD_GEOFENCE_METERS of the dropoff point.

import { LoadService } from './loadService';
import { BOLService } from './bolService';
import { AppError } from '../middleware/errorHandler';

const MIN_PHOTOS       = Number(process.env.MIN_POD_PHOTOS      ?? 1);
const GEOFENCE_METERS  = Number(process.env.POD_GEOFENCE_METERS ?? 1609); // ~1 mile

// Haversine distance in metres between two lat/lng points.
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface PodResult {
  complete: boolean;
  loadId:   string;
  checks: {
    delivered:  boolean;
    signed:     boolean;
    photos:     boolean;
    geofence:   boolean | 'skipped'; // skipped when load has no dropoff coords
  };
}

export async function assertPodComplete(loadId: string): Promise<PodResult> {
  const [load, bol] = await Promise.all([
    LoadService.getLoadById(loadId),
    BOLService.getBOLByLoadId(loadId),
  ]);

  if (!load) throw new AppError(`Load ${loadId} not found`, 404);

  const delivered = load.status === 'DELIVERED';
  const signed    = !!bol?.consigneeSignature?.signedAt;
  const photos    = (bol?.podPhotos?.length ?? 0) >= MIN_PHOTOS;

  // Geofence: only enforced when the load has dropoff coordinates AND photos have coords.
  let geofence: boolean | 'skipped' = 'skipped';
  if (load.deliveryLat && load.deliveryLng && bol?.podPhotos?.length) {
    const photosWithCoords = bol.podPhotos.filter(p => p.lat != null && p.lng != null);
    if (photosWithCoords.length > 0) {
      geofence = photosWithCoords.some(
        p => haversineMeters(p.lat!, p.lng!, load.deliveryLat, load.deliveryLng) <= GEOFENCE_METERS,
      );
    }
  }

  const complete = delivered && signed && photos && geofence !== false;

  if (!complete) {
    const missing: string[] = [];
    if (!delivered)         missing.push('load not DELIVERED');
    if (!signed)            missing.push('consignee signature missing');
    if (!photos)            missing.push(`fewer than ${MIN_PHOTOS} POD photo(s)`);
    if (geofence === false) missing.push('no photo captured within delivery geofence');
    throw new AppError(`POD incomplete: ${missing.join('; ')}`, 400);
  }

  return {
    complete: true,
    loadId,
    checks: { delivered, signed, photos, geofence },
  };
}
