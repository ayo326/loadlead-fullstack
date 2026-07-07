/**
 * LoadRoutePanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Inline route preview panel rendered inside each load-offer card on the
 * driver dashboard.
 *
 * Tabs
 *  • Pickup  - driver's current position → pickup address
 *  • Dropoff - pickup address → delivery address  (toggle to: current → delivery)
 *
 * Controls
 *  🔍 magnifying glass (top-right) → fullscreen dialog
 *  Google Maps' own "Open in Maps" link is built into the iframe (top-left)
 */

import { useState } from "react";
import { Loader2, MapPin, Navigation, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Tab = "pickup" | "dropoff";
type DropoffOrigin = "pickup" | "current";

interface LoadRoutePanelProps {
  /** Full street address of pickup, e.g. "100 W Randolph St, Chicago, IL 60601" */
  pickupAddress?: string | null;
  /** Full street address of delivery */
  deliveryAddress?: string | null;
  /** City labels for display only */
  pickupCity?: string | null;
  pickupState?: string | null;
  deliveryCity?: string | null;
  deliveryState?: string | null;
  /** Driver's stored GPS position */
  currentLat?: number | null;
  currentLng?: number | null;
  /** Fallback city when GPS unavailable */
  currentCity?: string | null;
  currentState?: string | null;
  /** Google Maps Embed API key */
  mapsApiKey?: string | null;
  /** Mini-map aspect ratio (CSS aspect-ratio). Default "16 / 9"; pass a wider
   *  ratio (e.g. "24 / 9") to make the pane shorter. */
  mapAspectRatio?: string;
  /** Which leg to show first. Default "pickup" (current -> pickup, for
   *  navigating to the load). Pass "dropoff" to open on the load's own route
   *  (pickup -> dropoff). */
  defaultTab?: Tab;
}

export function LoadRoutePanel({
  pickupAddress,
  deliveryAddress,
  pickupCity,
  pickupState,
  deliveryCity,
  deliveryState,
  currentLat,
  currentLng,
  currentCity,
  currentState,
  mapsApiKey,
  mapAspectRatio = "16 / 9",
  defaultTab = "pickup",
}: LoadRoutePanelProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [dropoffOrigin, setDropoffOrigin] = useState<DropoffOrigin>("pickup");
  const [miniLoaded, setMiniLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);

  const resolvedKey =
    mapsApiKey || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);

  // Driver origin: prefer GPS coords, fall back to city/state text
  const driverOrigin =
    currentLat && currentLng
      ? `${currentLat},${currentLng}`
      : currentCity && currentState
      ? `${currentCity}, ${currentState}`
      : null;

  function buildSrc(): string | null {
    if (!resolvedKey) return null;

    const base = "https://www.google.com/maps/embed/v1/directions";
    const mkUrl = (origin: string, dest: string) =>
      `${base}?key=${encodeURIComponent(resolvedKey!)}` +
      `&origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(dest)}` +
      "&mode=driving";

    if (tab === "pickup") {
      if (!driverOrigin || !pickupAddress) return null;
      return mkUrl(driverOrigin, pickupAddress);
    }

    // Dropoff tab
    if (!deliveryAddress) return null;
    if (dropoffOrigin === "current") {
      if (!driverOrigin) return null;
      return mkUrl(driverOrigin, deliveryAddress);
    }
    // "From pickup" - the haul leg
    if (!pickupAddress) return null;
    return mkUrl(pickupAddress, deliveryAddress);
  }

  const src = buildSrc();

  const tabLabel =
    tab === "pickup"
      ? `To pickup${pickupCity ? ` · ${pickupCity}${pickupState ? `, ${pickupState}` : ""}` : ""}`
      : `Load route${deliveryCity ? ` · to ${deliveryCity}${deliveryState ? `, ${deliveryState}` : ""}` : ""}`;

  // Reset load state when tab or origin changes
  const switchTab = (t: Tab) => {
    setTab(t);
    setMiniLoaded(false);
  };
  const switchOrigin = (o: DropoffOrigin) => {
    setDropoffOrigin(o);
    setMiniLoaded(false);
  };

  return (
    <div className="border-t border-border px-5 pb-5 pt-4 bg-secondary/20">
      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <TabBtn active={tab === "pickup"} onClick={() => switchTab("pickup")}>
          <Navigation className="h-3 w-3" />
          To pickup
        </TabBtn>
        <TabBtn active={tab === "dropoff"} onClick={() => switchTab("dropoff")}>
          <MapPin className="h-3 w-3" />
          Load route
        </TabBtn>

        {/* Dropoff origin toggle */}
        {tab === "dropoff" && (
          <div className="ml-auto flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
            <ToggleBtn
              active={dropoffOrigin === "pickup"}
              onClick={() => switchOrigin("pickup")}
            >
              From pickup
            </ToggleBtn>
            <ToggleBtn
              active={dropoffOrigin === "current"}
              onClick={() => switchOrigin("current")}
            >
              From current
            </ToggleBtn>
          </div>
        )}
      </div>

      {/* ── Map area ──────────────────────────────────────────────────────── */}
      {!src ? (
        <NoLocation hasMapsKey={!!resolvedKey} aspectRatio={mapAspectRatio} />
      ) : (
        <div
          className="relative rounded-xl overflow-hidden border border-border/50"
          style={{ aspectRatio: mapAspectRatio }}
        >
          {/* Loading skeleton - neutral, no brand gradient */}
          {!miniLoaded && (
            <div className="absolute inset-0 bg-secondary flex items-center justify-center z-10">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" aria-hidden />
            </div>
          )}

          {/* key={src} forces re-mount when route changes */}
          <iframe
            key={src}
            title={tabLabel}
            src={src}
            className="w-full h-full border-0"
            referrerPolicy="no-referrer-when-downgrade"
            loading="lazy"
            onLoad={() => setMiniLoaded(true)}
          />

          {/* Expand magnifying glass - top-right */}
          <button
            onClick={() => {
              setExpanded(true);
              setFullLoaded(false);
            }}
            className="absolute top-2 right-2 z-20 h-8 w-8 rounded-sm bg-foreground/80 text-card flex items-center justify-center hover:bg-foreground transition-colors duration-fast ease-soft cursor-pointer"
            title="Expand map"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Fullscreen modal ──────────────────────────────────────────────── */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-w-4xl w-full p-0 overflow-hidden rounded-md gap-0"
          style={{ height: "80vh" }}
        >
          {/* Header */}
          <div className="flex items-center px-5 py-3 border-b border-border bg-card shrink-0 gap-2">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold truncate">{tabLabel}</span>
            {tab === "dropoff" && (
              <span className="ml-auto text-xs text-muted-foreground shrink-0">
                {dropoffOrigin === "pickup" ? "From pickup location" : "From current position"}
              </span>
            )}
          </div>

          {/* Map fills rest of modal */}
          <div className="relative flex-1" style={{ height: "calc(80vh - 57px)" }}>
            {!fullLoaded && (
              <div className="absolute inset-0 bg-secondary flex items-center justify-center z-10">
                <Loader2 className="h-7 w-7 text-primary animate-spin" />
              </div>
            )}
            {src && (
              <iframe
                key={`${src}-full`}
                title={`${tabLabel} fullscreen`}
                src={src}
                className="w-full h-full border-0"
                referrerPolicy="no-referrer-when-downgrade"
                loading="lazy"
                onLoad={() => setFullLoaded(true)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-secondary text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function NoLocation({ hasMapsKey, aspectRatio = "16 / 9" }: { hasMapsKey: boolean; aspectRatio?: string }) {
  return (
    <div
      className="rounded-xl bg-secondary flex flex-col items-center justify-center text-center gap-2 p-6 text-sm text-muted-foreground"
      style={{ aspectRatio }}
    >
      <Navigation className="h-5 w-5 opacity-40" />
      {hasMapsKey
        ? "Enable location services on your device to see turn-by-turn directions."
        : "Maps are not configured for this environment."}
    </div>
  );
}
