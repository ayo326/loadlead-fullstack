'use client';

import React from 'react';

interface MapProps {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  className?: string;
  heightPx?: number;
  originLabel?: string;
  destinationLabel?: string;
}

function hasValidKey(key: string | undefined) {
  if (!key) return false;
  const k = key.trim();
  if (!k) return false;
  if (k === 'YOUR_KEY_HERE') return false;
  return true;
}

export const Map: React.FC<MapProps> = ({
  origin,
  destination,
  className = '',
  heightPx = 320,
  originLabel,
  destinationLabel,
}) => {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const originStr = originLabel?.trim() ? originLabel : `${origin.lat},${origin.lng}`;
  const destinationStr = destinationLabel?.trim() ? destinationLabel : `${destination.lat},${destination.lng}`;

  const src = hasValidKey(apiKey)
    ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(
        apiKey!
      )}&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(
        destinationStr
      )}&mode=driving`
    : `https://www.google.com/maps?output=embed&saddr=${encodeURIComponent(
        originStr
      )}&daddr=${encodeURIComponent(destinationStr)}`;

  return (
    <div
      className={`w-full rounded-lg overflow-hidden border ${className}`}
      style={{ height: `${heightPx}px` }}
    >
      <iframe
        title="Route Map"
        width="100%"
        height="100%"
        frameBorder={0}
        style={{ border: 0 }}
        src={src}
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
};
