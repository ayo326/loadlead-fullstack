import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { distanceMatrixMilesAndDuration, reverseGeocodeCityState } from '../../../src/services/integrations/maps';

const ENV_VARS = ['APP_ENV', 'MAPS_MODE', 'GOOGLE_MAPS_API_KEY'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('maps adapter — stub mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'staging';
    process.env.MAPS_MODE = 'stub';
  });

  it('returns a deterministic distance shape without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await distanceMatrixMilesAndDuration({ lat: 1, lng: 1 }, { lat: 2, lng: 2 });
    expect(result).toEqual({ miles: 250, durationSeconds: 14400, durationText: '4 hours', distanceText: '250 mi' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a deterministic geocode shape without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await reverseGeocodeCityState(1, 1);
    expect(result).toEqual({ city: 'Columbus', state: 'OH' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('maps adapter — live mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'staging';
    process.env.MAPS_MODE = 'live';
  });

  it('returns null with no API key set, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await distanceMatrixMilesAndDuration({ lat: 1, lng: 1 }, { lat: 2, lng: 2 });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses a live distance-matrix response into miles', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        status: 'OK',
        rows: [{ elements: [{ status: 'OK', distance: { value: 160934, text: '100 mi' }, duration: { value: 3600, text: '1 hour' } }] }],
      }),
    }));
    const result = await distanceMatrixMilesAndDuration({ lat: 1, lng: 1 }, { lat: 2, lng: 2 });
    expect(result?.miles).toBeCloseTo(100, 0);
    expect(result?.distanceText).toBe('100 mi');
  });

  it('parses a live geocode response into city/state', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        status: 'OK',
        results: [{ address_components: [
          { types: ['locality'], short_name: 'Chicago' },
          { types: ['administrative_area_level_1'], short_name: 'IL' },
        ] }],
      }),
    }));
    const result = await reverseGeocodeCityState(41.8, -87.6);
    expect(result).toEqual({ city: 'Chicago', state: 'IL' });
  });
});
