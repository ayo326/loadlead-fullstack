'use client';

import React, { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type Status = 'checking' | 'blocked' | 'ready';

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.7613; // miles
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

async function reverseGeocodeCityState(lat: number, lng: number): Promise<{ city: string; state: string } | null> {
  if (!GOOGLE_KEY) return null;

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${encodeURIComponent(lat + ',' + lng)}` +
    `&key=${encodeURIComponent(GOOGLE_KEY)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.status !== 'OK' || !Array.isArray(data.results)) return null;

  const comps: any[] = data.results?.[0]?.address_components || [];
  const city =
    comps.find((c) => c.types?.includes('locality'))?.long_name ||
    comps.find((c) => c.types?.includes('sublocality'))?.long_name ||
    comps.find((c) => c.types?.includes('administrative_area_level_2'))?.long_name ||
    '';

  const state =
    comps.find((c) => c.types?.includes('administrative_area_level_1'))?.short_name || '';

  if (!city || !state) return null;
  return { city, state };
}

export function DriverLocationGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<Status>('checking');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);

  const sendLocation = async (lat: number, lng: number) => {
    const now = Date.now();

    const last = lastPosRef.current;
    const moved = last ? haversineMiles(last, { lat, lng }) : 999;
    const tooSoon = now - lastSentRef.current < 20000; // 20s throttle
    const barelyMoved = moved < 0.1; // < ~0.1 mile

    if (tooSoon && barelyMoved) return;

    lastPosRef.current = { lat, lng };
    lastSentRef.current = now;

    let city = 'Unknown';
    let state = 'TX';

    const cs = await reverseGeocodeCityState(lat, lng);
    if (cs?.city && cs?.state) {
      city = cs.city;
      state = cs.state;
    }

    await api.updateDriverLocation(lat, lng, city, state);
  };

  useEffect(() => {
    if (loading) return;
    if (!user) return; // not logged in
    if (user.role !== 'DRIVER') return;

    if (!navigator.geolocation) {
      setStatus('blocked');
      setErrorMsg('Geolocation is not supported in this browser.');
      return;
    }

    setStatus('checking');
    setErrorMsg('');

    const onOk = async (pos: GeolocationPosition) => {
      try {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        await sendLocation(lat, lng);
        setStatus('ready');
      } catch (e: any) {
        setStatus('blocked');
        setErrorMsg(e?.message || 'Failed to send location to server.');
      }
    };

    const onErr = async (err: GeolocationPositionError) => {
      // Fall back to stored profile location so the app remains usable
      try {
        const profile = await api.getDriverProfile();
        const { currentLat, currentLng, currentCity, currentState } = profile.driver;
        if (currentLat && currentLng) {
          lastPosRef.current = { lat: currentLat, lng: currentLng };
          lastSentRef.current = Date.now();
          setStatus('ready');
          return;
        }
      } catch (_) {}
      setStatus('blocked');
      setErrorMsg(err?.message || 'Location permission denied.');
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onOk, onErr, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000
    });

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [loading, user]);

  if (!user || user.role !== 'DRIVER') return <>{children}</>;

  if (status !== 'ready') {
    return (
      <div className="max-w-2xl mx-auto mt-10">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-2">Location required</h2>
          <p className="text-gray-600 mb-4">
            Driver location sharing must be ON to use LoadLead. Turn on location permissions for this site.
          </p>

          {errorMsg ? (
            <div className="text-sm text-red-600 mb-4">{errorMsg}</div>
          ) : (
            <div className="text-sm text-gray-500 mb-4">Waiting for location…</div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => {
                setStatus('checking');
                setErrorMsg('');
                navigator.geolocation.getCurrentPosition(
                  (p) => {
                    void (async () => {
                      try {
                        await sendLocation(p.coords.latitude, p.coords.longitude);
                        setStatus('ready');
                      } catch (e: any) {
                        setStatus('blocked');
                        setErrorMsg(e?.message || 'Failed to send location.');
                      }
                    })();
                  },
                  async (e) => {
                    try {
                      const profile = await api.getDriverProfile();
                      const { currentLat, currentLng } = profile.driver;
                      if (currentLat && currentLng) {
                        lastPosRef.current = { lat: currentLat, lng: currentLng };
                        lastSentRef.current = Date.now();
                        setStatus('ready');
                        return;
                      }
                    } catch (_) {}
                    setStatus('blocked');
                    setErrorMsg(e.message || 'Location permission denied.');
                  },
                  { enableHighAccuracy: true, timeout: 15000 }
                );
              }}
            >
              Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
