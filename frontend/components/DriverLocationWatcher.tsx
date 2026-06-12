'use client';

import React, { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

type LatLng = { lat: number; lng: number };

function haversineMeters(a: LatLng, b: LatLng) {
  const R = 6371000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * R * Math.asin(Math.sqrt(x));
}

export function DriverLocationWatcher() {
  const watchIdRef = useRef<number | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const lastSentPosRef = useRef<LatLng | null>(null);

  const [status, setStatus] = useState<'starting' | 'active' | 'blocked' | 'error'>('starting');
  const [message, setMessage] = useState<string>('Requesting location permission…');

  // Tune these if you want
  const MIN_SEND_INTERVAL_MS = 10_000; // send at most every 10s
  const MIN_MOVE_METERS = 50;          // or when moved 50m+

  useEffect(() => {
    const start = () => {
      if (!navigator.geolocation) {
        setStatus('error');
        setMessage('Geolocation is not supported in this browser.');
        return;
      }

      // If already watching, clear first (prevents duplicates)
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      setStatus('starting');
      setMessage('Starting live location sharing…');

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          const now = Date.now();
          const lastSentAt = lastSentAtRef.current;
          const lastPos = lastSentPosRef.current;

          const movedEnough = !lastPos || haversineMeters(lastPos, { lat, lng }) >= MIN_MOVE_METERS;
          const waitedEnough = now - lastSentAt >= MIN_SEND_INTERVAL_MS;

          if (!movedEnough && !waitedEnough) {
            setStatus('active');
            setMessage('Live location sharing is ON.');
            return;
          }

          try {
            await api.updateDriverLocation(lat, lng, '', '');
            lastSentAtRef.current = now;
            lastSentPosRef.current = { lat, lng };
            setStatus('active');
            setMessage('Live location sharing is ON.');
          } catch (e) {
            setStatus('error');
            setMessage('Location captured, but failed to send to server.');
          }
        },
        (err) => {
          // PERMISSION_DENIED = 1
          if ((err as any)?.code === 1) {
            setStatus('blocked');
            setMessage('Location is required. Please allow location permissions for this site, then refresh.');
          } else {
            setStatus('error');
            setMessage(err.message || 'Failed to get location.');
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 15_000,
        }
      );
    };

    start();

    // Re-start watch when tab becomes visible again (helps on some browsers)
    const onVis = () => {
      if (document.visibilityState === 'visible') start();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // “Must have location on” = block UI if permission denied
  if (status === 'blocked') {
    return (
      <div className="mb-4 p-4 rounded-lg border bg-red-50">
        <p className="font-semibold text-red-800">Location Required</p>
        <p className="text-sm text-red-700 mt-1">{message}</p>
        <p className="text-xs text-red-700 mt-2">
          Tip: In Chrome → click the lock icon in the address bar → Site settings → Location → Allow, then refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 p-4 rounded-lg border bg-white flex items-center justify-between">
      <div>
        <p className="font-semibold text-gray-900">Location Sharing</p>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
      <span
        className={`text-sm font-semibold ${
          status === 'active' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-gray-600'
        }`}
      >
        {status === 'active' ? 'ON' : status === 'error' ? 'ERROR' : 'STARTING'}
      </span>
    </div>
  );
}
