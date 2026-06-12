'use client';

import React, { useMemo, useState } from 'react';

type Actor = 'shipper' | 'driver' | 'admin';
type LatLng = { lat: number; lng: number };

export interface RouteMapPanelProps {
  actor?: Actor;
  loadId?: string;
  origin?: LatLng;
  destination?: LatLng;
  originText?: string;
  destinationText?: string;
  originLabel?: string;
  destinationLabel?: string;
  distanceMiles?: number | null;
  ratePerMile?: number | null;
  startCollapsed?: boolean;
  stopClickPropagation?: boolean;
  driver?: any;
  etaToDelivery?: any;
  [key: string]: any;
}

function cityStateFromText(text?: string) {
  if (!text) return '';
  const parts = text.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const stateZip = parts[parts.length - 1];
    const city = parts[parts.length - 2];
    const m = stateZip.match(/\b([A-Z]{2})\b/);
    const st = m ? m[1] : (stateZip.split(' ')[0] || stateZip);
    return `${city}, ${st}`.trim();
  }
  return text.trim();
}

function formatMiles(m?: number | null) {
  if (typeof m !== 'number' || !isFinite(m) || m <= 0) return '—';
  const v = Math.round(m * 10) / 10;
  return `${v.toFixed(1)} mi`;
}

function formatUsd(n?: number | null) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export const RouteMapPanel: React.FC<RouteMapPanelProps> = ({
  origin,
  destination,
  originText,
  destinationText,
  originLabel,
  destinationLabel,
  distanceMiles,
  ratePerMile,
  startCollapsed = true,
  stopClickPropagation = false,
}) => {
  const [collapsed, setCollapsed] = useState(startCollapsed);

  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
    '';

  const computedOriginText = (originText && originText.trim()) || (origin ? `${origin.lat},${origin.lng}` : '');
  const computedDestinationText = (destinationText && destinationText.trim()) || (destination ? `${destination.lat},${destination.lng}` : '');

  const hasOrigin = Boolean(computedOriginText);
  const hasDest = Boolean(computedDestinationText);

  const oLabel = originLabel?.trim() || cityStateFromText(computedOriginText);
  const dLabel = destinationLabel?.trim() || cityStateFromText(computedDestinationText);

  const milesVal =
    typeof distanceMiles === 'number' && isFinite(distanceMiles) && distanceMiles > 0
      ? distanceMiles
      : null;

  const rateVal =
    typeof ratePerMile === 'number' && isFinite(ratePerMile) && ratePerMile > 0
      ? ratePerMile
      : null;

  const estCost = milesVal != null && rateVal != null ? milesVal * rateVal : null;

  const iframeSrc = useMemo(() => {
    if (!hasOrigin) return '';
    const o = encodeURIComponent(computedOriginText.trim());

    if (hasDest) {
      const d = encodeURIComponent(computedDestinationText.trim());
      if (apiKey && apiKey.startsWith('AIza')) {
        return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(
          apiKey
        )}&origin=${o}&destination=${d}&mode=driving`;
      }
      return `https://www.google.com/maps?output=embed&saddr=${o}&daddr=${d}`;
    }

    if (apiKey && apiKey.startsWith('AIza')) {
      return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${o}`;
    }
    return `https://www.google.com/maps?output=embed&q=${o}`;
  }, [apiKey, computedDestinationText, hasDest, hasOrigin, computedOriginText]);

  const openGoogleMaps = () => {
    if (!hasOrigin) return;
    const o = encodeURIComponent(computedOriginText.trim());
    const url = hasDest
      ? `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${encodeURIComponent(
          computedDestinationText.trim()
        )}`
      : `https://www.google.com/maps/search/?api=1&query=${o}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!hasOrigin) return null;

  const onRootClick = (e: React.MouseEvent) => {
    if (stopClickPropagation) e.stopPropagation();
  };

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm" onClick={onRootClick}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Route</p>
          <p className="text-sm text-gray-700">
            {oLabel}
            {hasDest ? ` \u2192 ${dLabel}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openGoogleMaps}
            className="rounded-lg border bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200"
          >
            Open in Google Maps
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(v => !v)}
            className="rounded-lg border bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200"
          >
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>

      {/* Distance / Rate / Total */}
      <div className="mt-3 border-t pt-3">
        <div className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-gray-500">Distance</p>
            <p className="font-semibold">{formatMiles(milesVal)}</p>
          </div>
          <div>
            <p className="text-gray-500">Rate</p>
            <p className="font-semibold text-green-600">
              {rateVal != null ? `${formatUsd(rateVal)}/mi` : '—'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Total</p>
            <p className="font-semibold text-green-600">
              {estCost != null ? formatUsd(estCost) : '—'}
            </p>
          </div>
        </div>
      </div>

      {!collapsed && iframeSrc ? (
        <div className="mt-4 overflow-hidden rounded-xl border">
          <iframe
            title="route-map"
            src={iframeSrc}
            className="h-64 w-full md:h-80"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      ) : null}
    </div>
  );
};

export default RouteMapPanel;
