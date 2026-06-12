import { api } from './api';

let _watchId: number | null = null;

export function startLocationSharing(onUpdate?: (city: string, state: string) => void) {
  if (!navigator.geolocation) return;

  const send = async (pos: GeolocationPosition) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    try {
      // Reverse geocode via backend (uses Google Maps)
      const geo = await api.reverseGeocode(lat, lng).catch(() => ({ city: '', state: '' }));
      await api.updateDriverLocation(lat, lng, geo.city || '', geo.state || '');
      onUpdate?.(geo.city || '', geo.state || '');
    } catch (_) {}
  };

  // Send immediately, then every 60 seconds
  navigator.geolocation.getCurrentPosition(send, undefined, { enableHighAccuracy: true });
  _watchId = window.setInterval(() => {
    navigator.geolocation.getCurrentPosition(send, undefined, { enableHighAccuracy: true });
  }, 60_000);
}

export function stopLocationSharing() {
  if (_watchId !== null) { clearInterval(_watchId); _watchId = null; }
}
