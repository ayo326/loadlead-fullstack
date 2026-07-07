/**
 * CommandMap - the command-center map canvas for the recomposed dashboards.
 *
 * Approach (agreed in Phase 1): a Google Static Maps dark image (basemap plus
 * an optional route path) with an HTML overlay of styled, clickable pins. The
 * static provider gives us the dark navy basemap with no new map library; we
 * compute each pin's pixel position ourselves (Web Mercator) so the overlay
 * pins are exactly aligned and fully interactive - clicking a pin calls
 * onPinClick(id) so the page can focus the matching load row/card.
 *
 * It never world-zooms: with pins it fits their bounds (clamped to a sane
 * regional zoom); with no pins it centers on the operator region fallback.
 * With no API key or no coordinates at all it renders a quiet dark placeholder
 * rather than a blank hole in the page.
 */

import { useMemo } from "react";
import { MapPin } from "lucide-react";

export type PinKind = "offer" | "available" | "truck" | "pickup" | "delivery";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  /** Short label shown on hover / for a11y. */
  label?: string;
}

interface CommandMapProps {
  pins: MapPin[];
  /** Optional route line drawn on the basemap (e.g. current -> pickup -> delivery). */
  route?: Array<{ lat: number; lng: number }>;
  /** Region fallback center when there are no pins (operator's area). */
  fallbackCenter?: { lat: number; lng: number } | null;
  /** id of the pin currently focused, for a highlighted ring. */
  activeId?: string | null;
  onPinClick?: (id: string) => void;
  mapsApiKey?: string | null;
  className?: string;
}

// Logical request size (Static Maps caps at 640; scale=2 doubles resolution).
// The overlay positions pins as percentages of this box, so the image can be
// scaled by CSS and the pins stay aligned.
const W = 640;
const H = 360;
const TILE = 256;
const MIN_ZOOM = 4;   // never world-zoom
const MAX_ZOOM = 14;  // do not slam to street level on a single pin

// Accent colors (navy system). Kept in sync with the dashboard token palette.
const PIN_COLOR: Record<PinKind, string> = {
  offer:     "#FBBF24", // amber - a live offer, the loudest
  available: "#5B8DEF", // blue - available load nearby
  truck:     "#34D399", // green - the operator / active position
  pickup:    "#A78BFA", // violet
  delivery:  "#F87171", // coral
};

// ── Web Mercator projection (256 world at zoom 0) ──────────────────────────
function projectWorld(lat: number, lng: number): { x: number; y: number } {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: TILE * (0.5 + lng / 360),
    y: TILE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

// Fit a center + zoom that bounds all points inside W x H with padding.
function fitBounds(points: Array<{ lat: number; lng: number }>): { center: { lat: number; lng: number }; zoom: number } {
  if (points.length === 0) return { center: { lat: 39.5, lng: -98.35 }, zoom: MIN_ZOOM };

  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };

  if (points.length === 1) return { center, zoom: 9 };

  // Zoom so the bounding box (in world pixels) fits the padded viewport.
  const nw = projectWorld(maxLat, minLng);
  const se = projectWorld(minLat, maxLng);
  const worldW = Math.max(Math.abs(se.x - nw.x), 1e-6);
  const worldH = Math.max(Math.abs(se.y - nw.y), 1e-6);
  const pad = 0.78; // leave a margin so pins are not on the edge
  const zoomX = Math.log2((W * pad) / worldW);
  const zoomY = Math.log2((H * pad) / worldH);
  const zoom = Math.floor(Math.min(zoomX, zoomY));
  return { center, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) };
}

// Project a lat/lng to a percentage position within the W x H image, given the
// chosen center + zoom. Returns null when off-canvas.
function pinPercent(
  lat: number, lng: number,
  center: { lat: number; lng: number }, zoom: number,
): { leftPct: number; topPct: number } | null {
  const scale = Math.pow(2, zoom);
  const c = projectWorld(center.lat, center.lng);
  const p = projectWorld(lat, lng);
  const x = (p.x - c.x) * scale + W / 2;
  const y = (p.y - c.y) * scale + H / 2;
  if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return null;
  return { leftPct: (x / W) * 100, topPct: (y / H) * 100 };
}

// Compact dark navy Static Maps style, consistent with the #0E1A38 surfaces.
const DARK_STYLE = [
  "style=element:geometry|color:0x0e1a38",
  "style=element:labels.text.fill|color:0x9daac9",
  "style=element:labels.text.stroke|color:0x0e1a38",
  "style=feature:administrative|element:geometry|color:0x2a3a5f",
  "style=feature:road|element:geometry|color:0x1c2a4a",
  "style=feature:road.highway|element:geometry|color:0x2a3a5f",
  "style=feature:water|element:geometry|color:0x0a1226",
  "style=feature:poi|element:geometry|color:0x16223f",
  "style=feature:landscape|element:geometry|color:0x111d3a",
].join("&");

export function CommandMap({
  pins, route, fallbackCenter, activeId, onPinClick, mapsApiKey, className,
}: CommandMapProps) {
  const key = mapsApiKey || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);

  const valid = useMemo(
    () => pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)),
    [pins],
  );

  const { center, zoom } = useMemo(() => {
    if (valid.length > 0) return fitBounds(valid.map((p) => ({ lat: p.lat, lng: p.lng })));
    if (fallbackCenter) return { center: fallbackCenter, zoom: 6 };
    return { center: { lat: 39.5, lng: -98.35 }, zoom: MIN_ZOOM };
  }, [valid, fallbackCenter]);

  const src = useMemo(() => {
    if (!key) return null;
    const params = [
      `center=${center.lat},${center.lng}`,
      `zoom=${zoom}`,
      `size=${W}x${H}`,
      "scale=2",
      "maptype=roadmap",
      DARK_STYLE,
    ];
    if (route && route.length >= 2) {
      const pathPts = route
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
        .join("|");
      if (pathPts) params.push(`path=color:0x5b8defcc|weight:4|${pathPts}`);
    }
    params.push(`key=${encodeURIComponent(key)}`);
    return `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}`;
  }, [key, center, zoom, route]);

  const positioned = useMemo(
    () =>
      valid
        .map((p) => ({ pin: p, pos: pinPercent(p.lat, p.lng, center, zoom) }))
        .filter((x): x is { pin: MapPin; pos: { leftPct: number; topPct: number } } => x.pos != null),
    [valid, center, zoom],
  );

  // No key at all: a quiet dark placeholder (never a blank/world map).
  if (!src) {
    return (
      <div className={`relative overflow-hidden rounded-md bg-[#0e1a38] ${className ?? ""}`} style={{ aspectRatio: `${W} / ${H}` }}>
        <div
          className="absolute inset-0 opacity-40"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(157,170,201,0.18) 1px, transparent 0)", backgroundSize: "18px 18px" }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#9daac9]">
          <MapPin className="h-6 w-6 opacity-60" />
          <p className="text-xs">Map unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-md border border-[#22314f] bg-[#0e1a38] ${className ?? ""}`} style={{ aspectRatio: `${W} / ${H}` }}>
      <img src={src} alt="Operating area map" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />

      {/* Clickable pin overlay - percentages of the logical W x H box, so it
          stays aligned as the image scales with the container. */}
      {positioned.map(({ pin, pos }) => {
        const color = PIN_COLOR[pin.kind];
        const active = activeId === pin.id;
        return (
          <button
            key={pin.id}
            type="button"
            onClick={() => onPinClick?.(pin.id)}
            title={pin.label ?? pin.kind}
            aria-label={pin.label ?? `${pin.kind} pin`}
            data-testid={`map-pin-${pin.id}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer focus:outline-none"
            style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
          >
            <span className="relative flex items-center justify-center">
              {pin.kind === "offer" && (
                <span className="absolute inline-flex h-5 w-5 animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
              )}
              <span
                className="relative block rounded-full border-2 border-[#0e1a38] shadow"
                style={{
                  backgroundColor: color,
                  height: active ? 16 : 12,
                  width: active ? 16 : 12,
                  boxShadow: active ? `0 0 0 4px ${color}55` : undefined,
                }}
              />
            </span>
          </button>
        );
      })}

      {positioned.length === 0 && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-[11px] text-white/80">
          No mapped loads in view
        </div>
      )}
    </div>
  );
}
