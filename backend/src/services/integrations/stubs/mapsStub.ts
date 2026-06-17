// services/integrations/stubs/mapsStub.ts
//
// NON-PRODUCTION ONLY. Physically deleted from the production build by
// deploy-backend.sh. Reachable only via the guarded dynamic import in
// services/integrations/maps.ts — never import this statically.
//
// Canned, deterministic responses matching the EXACT shape the live Google
// Maps adapter returns, so downstream code (RoutingService, broadcast
// matching) behaves identically whether it's reading a live or stubbed
// result. Used in dev/staging and under load tests to avoid burning a
// capped API key or hitting real rate limits.

type LatLng = { lat: number; lng: number };

export default {
  async distanceMatrixMilesAndDuration(_origin: LatLng, _dest: LatLng): Promise<{
    miles: number;
    durationSeconds: number | null;
    durationText: string | null;
    distanceText: string | null;
  } | null> {
    return {
      miles: 250,
      durationSeconds: 14400,
      durationText: '4 hours',
      distanceText: '250 mi',
    };
  },

  async reverseGeocodeCityState(_lat: number, _lng: number): Promise<{ city?: string; state?: string } | null> {
    return { city: 'Columbus', state: 'OH' };
  },
};
