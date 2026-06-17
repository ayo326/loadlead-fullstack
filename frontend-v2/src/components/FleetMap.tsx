/**
 * FleetMap — admin live fleet map.
 *
 * Renders all drivers as markers on a Google Static Map, colored by status.
 * Static Maps API caps a single URL at ~16k chars; per driver we use ~22 chars,
 * so practical limit is ~700 drivers per snapshot. For larger fleets, we'd
 * switch to clustering or the JS Maps SDK.
 */

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

interface DriverPin {
  driverId: string;
  status: string;
  currentLat?: number | null;
  currentLng?: number | null;
}

interface FleetMapProps {
  drivers: DriverPin[];
  mapsApiKey?: string | null;
  className?: string;
}

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE:             "0x16a34a", // green
  VERIFIED:              "0x2563eb", // blue
  PENDING_VERIFICATION:  "0xd97706", // amber
  SUSPENDED:             "0xdc2626", // red
  OFFLINE:               "0x6b7280", // gray
};

export function FleetMap({ drivers, mapsApiKey, className }: FleetMapProps) {
  const key = mapsApiKey || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);

  const located = useMemo(
    () => drivers.filter(d => d.currentLat != null && d.currentLng != null),
    [drivers],
  );

  const src = useMemo(() => {
    if (!key || located.length === 0) return null;

    const markersByColor = new Map<string, string[]>();
    for (const d of located) {
      const color = STATUS_COLOR[d.status] ?? STATUS_COLOR.OFFLINE;
      const pos = `${d.currentLat!.toFixed(4)},${d.currentLng!.toFixed(4)}`;
      if (!markersByColor.has(color)) markersByColor.set(color, []);
      markersByColor.get(color)!.push(pos);
    }

    const params = new URLSearchParams({
      size: "640x360",
      maptype: "roadmap",
      key,
    });
    // Each color gets its own markers= group
    const markerParts: string[] = [];
    for (const [color, positions] of markersByColor) {
      markerParts.push(`color:${color}|size:small|${positions.join("|")}`);
    }
    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}&${markerParts.map(m => `markers=${encodeURIComponent(m)}`).join("&")}`;
  }, [key, located]);

  if (!key) {
    return (
      <div className={`aspect-video rounded-xl border border-dashed border-border bg-secondary/40 flex flex-col items-center justify-center text-sm text-muted-foreground gap-1 ${className ?? ""}`}>
        <p className="font-medium">Map unavailable</p>
        <p className="text-xs">Set VITE_GOOGLE_MAPS_API_KEY to enable the live fleet view.</p>
      </div>
    );
  }

  if (located.length === 0) {
    return (
      <div className={`aspect-video rounded-xl border border-border bg-secondary/40 flex items-center justify-center text-sm text-muted-foreground ${className ?? ""}`}>
        No drivers with known location yet.
      </div>
    );
  }

  const counts = located.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={className}>
      <div className="aspect-video rounded-xl overflow-hidden border border-border bg-secondary relative">
        <img src={src!} alt="Live fleet map" className="w-full h-full object-cover" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {Object.entries(counts).map(([status, count]) => {
          const c = STATUS_COLOR[status] ?? STATUS_COLOR.OFFLINE;
          const hex = `#${c.slice(2)}`;
          return (
            <span key={status} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1">
              <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
              <span className="font-medium">{count}</span>
              <span className="text-muted-foreground">{status.toLowerCase().replace(/_/g, " ")}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function FleetMapSkeleton({ className }: { className?: string }) {
  return (
    <div className={`aspect-video rounded-xl border border-border bg-secondary/40 flex items-center justify-center ${className ?? ""}`}>
      <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
    </div>
  );
}
