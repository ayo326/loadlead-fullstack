/**
 * RouteMapCard
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows a Google Maps Embed inside the sidebar "Current position" widget.
 *
 * • When a pickup + delivery address are provided  → directions embed (route)
 * • When only a location is known                  → place embed (current pos)
 * • No API key / no data                           → dotted gradient placeholder
 *
 * Controls:
 *   🔍  Expand button  → fullscreen modal with a larger map
 *   ↗   "Open in Google Maps" button → opens native / web Maps app
 */

import { useState } from "react";
import { ExternalLink, Loader2, MapPin, Navigation, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface RouteMapCardProps {
  /** Full street address of pickup, e.g. "100 W Randolph St, Chicago, IL 60601" */
  pickupAddress?: string | null;
  /** Full street address of delivery */
  deliveryAddress?: string | null;
  /** Fallback city name when no active route (shown as label) */
  currentCity?: string | null;
  /** Fallback state when no active route */
  currentState?: string | null;
  /** Current driver lat (used for current-position embed) */
  currentLat?: number | null;
  /** Current driver lng (used for current-position embed) */
  currentLng?: number | null;
  /** Google Maps API key — passed from parent so it's read at render time */
  mapsApiKey?: string | null;
}

export function RouteMapCard({
  pickupAddress,
  deliveryAddress,
  currentCity,
  currentState,
  currentLat,
  currentLng,
  mapsApiKey,
}: RouteMapCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [miniLoaded, setMiniLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);

  // Resolve key: prefer prop, fall back to build-time env var
  const resolvedKey = mapsApiKey || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);

  // V6: an address only counts as "resolvable" if it has a street segment
  // (a non-empty part before the first comma). A partial like ", Chicago, IL"
  // (city typed, street blank) must NOT produce a directions embed - that
  // renders a zoomed-all-the-way-out world map. Fall through to the placeholder.
  const streetResolvable = (a?: string | null) =>
    !!a && a.trim().length > 0 && a.split(",")[0].trim().length > 0;
  const hasRoute = streetResolvable(pickupAddress) && streetResolvable(deliveryAddress);
  const hasLocation = !!(currentLat && currentLng) || !!(currentCity && currentState);

  // ── Build embed src ──────────────────────────────────────────────────────
  function buildSrc(): string | null {
    if (!resolvedKey) return null;

    if (hasRoute) {
      return (
        "https://www.google.com/maps/embed/v1/directions" +
        `?key=${encodeURIComponent(resolvedKey!)}` +
        `&origin=${encodeURIComponent(pickupAddress!)}` +
        `&destination=${encodeURIComponent(deliveryAddress!)}` +
        "&mode=driving" +
        "&avoid=tolls"
      );
    }

    // Use place mode for current position — works for both lat/lng and city/state
    if (currentLat && currentLng) {
      return (
        "https://www.google.com/maps/embed/v1/place" +
        `?key=${encodeURIComponent(resolvedKey!)}` +
        `&q=${currentLat},${currentLng}` +
        "&zoom=11"
      );
    }

    if (currentCity && currentState) {
      return (
        "https://www.google.com/maps/embed/v1/place" +
        `?key=${encodeURIComponent(resolvedKey!)}` +
        `&q=${encodeURIComponent(`${currentCity}, ${currentState}`)}` +
        "&zoom=11"
      );
    }

    return null;
  }

  // ── Build "Open in Google Maps" href ────────────────────────────────────
  function buildGoogleMapsHref(): string {
    if (hasRoute) {
      return (
        "https://www.google.com/maps/dir/?api=1" +
        `&origin=${encodeURIComponent(pickupAddress!)}` +
        `&destination=${encodeURIComponent(deliveryAddress!)}` +
        "&travelmode=driving"
      );
    }
    if (currentLat && currentLng) {
      return `https://www.google.com/maps/search/?api=1&query=${currentLat},${currentLng}`;
    }
    if (currentCity && currentState) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${currentCity}, ${currentState}`)}`;
    }
    return "https://maps.google.com";
  }

  const src = buildSrc();
  const gmHref = buildGoogleMapsHref();

  // ── No API key or no data → placeholder ─────────────────────────────────
  if (!src) {
    return (
      <Placeholder currentCity={currentCity} currentState={currentState} />
    );
  }

  return (
    <>
      {/* ── Mini map ─────────────────────────────────────────────────────── */}
      <div className="relative mt-4 rounded-xl overflow-hidden border border-border/50" style={{ aspectRatio: "1 / 1" }}>
        {/* Loading skeleton */}
        {!miniLoaded && (
          <div className="absolute inset-0 bg-secondary flex items-center justify-center z-10">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)",
                backgroundSize: "16px 16px",
              }}
            />
            <Loader2 className="h-6 w-6 text-white/70 animate-spin relative z-10" />
          </div>
        )}

        <iframe
          title="Route map"
          src={src}
          className="w-full h-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
          loading="lazy"
          onLoad={() => setMiniLoaded(true)}
        />

        {/* Expand — top-right magnifying glass */}
        <button
          onClick={() => { setExpanded(true); setFullLoaded(false); }}
          className="absolute top-2 right-2 z-20 h-8 w-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors shadow-lg"
          title="Expand map"
        >
          <Search className="h-3.5 w-3.5" />
        </button>

        {/* Route label badge */}
        {hasRoute && miniLoaded && (
          <div className="absolute bottom-2 left-2 right-12 z-20">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur-sm px-2.5 py-1 text-[11px] text-white font-medium shadow-lg max-w-full truncate">
              <Navigation className="h-3 w-3 shrink-0 text-emerald-400" />
              <span className="truncate">Route active</span>
            </div>
          </div>
        )}

        {!hasRoute && (currentCity || currentState) && miniLoaded && (
          <div className="absolute bottom-2 left-2 z-20 pointer-events-none">
            <div className="text-primary-foreground drop-shadow-sm">
              <div className="text-[10px] opacity-70">{currentState ?? ""}</div>
              <div className="text-xs font-semibold">{currentCity ?? "Unknown"}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Fullscreen modal ─────────────────────────────────────────────── */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-w-4xl w-full p-0 overflow-hidden rounded-md gap-0"
          style={{ height: "80vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              {hasRoute ? (
                <div>
                  <span className="text-sm font-semibold">Route</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {pickupAddress?.split(",")[0]} → {deliveryAddress?.split(",")[0]}
                  </span>
                </div>
              ) : (
                <span className="text-sm font-semibold">Current position — {currentCity}{currentState ? `, ${currentState}` : ""}</span>
              )}
            </div>
            <a
              href={gmHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Google Maps
            </a>
          </div>

          {/* Map fills rest of modal */}
          <div className="relative flex-1" style={{ height: "calc(80vh - 57px)" }}>
            {!fullLoaded && (
              <div className="absolute inset-0 bg-secondary flex items-center justify-center z-10">
                <Loader2 className="h-7 w-7 text-primary animate-spin" />
              </div>
            )}
            <iframe
              title="Route map fullscreen"
              src={src}
              className="w-full h-full border-0"
              referrerPolicy="no-referrer-when-downgrade"
              loading="lazy"
              onLoad={() => setFullLoaded(true)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Placeholder (no API key / no data) ────────────────────────────────────────

function Placeholder({ currentCity, currentState }: Pick<RouteMapCardProps, "currentCity" | "currentState">) {
  return (
    <div
      className="mt-4 aspect-square rounded-xl bg-secondary relative overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
          <div className="relative h-4 w-4 rounded-full bg-white border-2 border-primary" />
        </div>
      </div>
      {(currentCity || currentState) ? (
        <div className="absolute bottom-3 left-3 text-primary-foreground">
          <div className="text-xs opacity-70">{currentState ?? ""}</div>
          <div className="text-sm font-semibold">{currentCity ?? "Unknown"}</div>
        </div>
      ) : (
        // V6: no route and no location yet - tell the user what unlocks the map
        // instead of showing a zoomed-out world view.
        <div className="absolute inset-x-0 bottom-4 text-center px-4">
          <p className="text-xs text-muted-foreground">Enter pickup and delivery to preview the route</p>
        </div>
      )}
    </div>
  );
}
