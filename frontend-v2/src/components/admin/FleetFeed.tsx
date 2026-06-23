// Live fleet feed for the admin console.
//
// Two parts:
//   - A driver list grouped by status (the colour bucketing the spec
//     asks for). A row click opens a detail drawer.
//   - A small "live tracking" banner at the top. When the backend
//     reports liveTracking.connected = false we show a plain "Live
//     tracking not connected" pill -- no fake spinner, no synthesised
//     GPS. The position column for any driver with no real heartbeat
//     reads "No location yet" in muted text.
//
// Quick actions in the drawer are tier-aware: flag (any staff tier)
// and open ticket (Phase 3 placeholder until the inbox lands).

import { useEffect, useMemo, useState } from "react";
import { Truck, MapPin, RefreshCw, AlertCircle, X, ShieldCheck, Flag, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

type FeedItem = {
  driverId: string; userId: string; fullName: string | null;
  status: string; equipment: string | null; currentLoadId: string | null;
  position: { lat: number; lng: number; city: string | null; state: string | null; updatedAt: number | null; source: string } | null;
};

const STATUS_COLOURS: Record<string, string> = {
  AVAILABLE:            "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  VERIFIED:             "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  PENDING_VERIFICATION: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  OFFLINE:              "bg-muted text-muted-foreground",
  SUSPENDED:            "bg-destructive/15 text-destructive",
};

const STATUS_ORDER = ["AVAILABLE", "VERIFIED", "PENDING_VERIFICATION", "OFFLINE", "SUSPENDED"];

function fmtAge(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000)       return "just now";
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function FleetFeed() {
  const [feed, setFeed] = useState<{
    liveTracking: { connected: boolean; provider: string | null };
    counts: Record<string, number>;
    items: FeedItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [openDriverId, setOpenDriverId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const f = await api.adminFleetFeed();
      setFeed(f);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load fleet feed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    if (!feed) return [] as Array<[string, FeedItem[]]>;
    const buckets = new Map<string, FeedItem[]>();
    for (const it of feed.items) {
      if (statusFilter !== "ALL" && it.status !== statusFilter) continue;
      const list = buckets.get(it.status) ?? [];
      list.push(it);
      buckets.set(it.status, list);
    }
    return STATUS_ORDER
      .filter((s) => buckets.has(s))
      .map((s) => [s, buckets.get(s)!] as [string, FeedItem[]]);
  }, [feed, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Live-tracking banner — honest "not connected" state when no telematics */}
      <div className="rounded-md border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-3" role="status">
        <Truck className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-sm font-semibold">Fleet feed</span>
        {feed && (
          feed.liveTracking.connected
            ? <Badge variant="default">Live tracking · {feed.liveTracking.provider}</Badge>
            : <Badge variant="outline" className="text-muted-foreground">Live tracking not connected</Badge>
        )}
        {feed && !feed.liveTracking.connected && (
          <span className="text-xs text-muted-foreground">
            Positions shown are last-known driver-app heartbeats, not real-time telematics.
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto h-8" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            statusFilter === "ALL" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
          }`}>All ({feed?.items.length ?? 0})</button>
        {STATUS_ORDER.map((s) => {
          const n = feed?.counts[s] ?? 0;
          if (n === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                statusFilter === s ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {s.replace(/_/g, " ")} ({n})
            </button>
          );
        })}
      </div>

      {loading && !feed && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading fleet…
        </div>
      )}
      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}
      {feed && grouped.length === 0 && !loading && (
        <div className="text-center py-12 text-sm text-muted-foreground">No drivers match this filter.</div>
      )}

      {grouped.map(([status, rows]) => (
        <div key={status} className="rounded-md border border-border bg-card overflow-hidden">
          <div className={`px-4 py-2 text-xs font-bold tracking-widest ${STATUS_COLOURS[status] ?? ""}`}>
            {status.replace(/_/g, " ")} · {rows.length}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
                <th className="px-4 py-2 font-medium">Driver</th>
                <th className="px-4 py-2 font-medium">Equipment</th>
                <th className="px-4 py-2 font-medium">Last known position</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr
                  key={d.driverId}
                  className="border-t border-border hover:bg-secondary/30 cursor-pointer"
                  onClick={() => setOpenDriverId(d.driverId)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpenDriverId(d.driverId); }}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.fullName ?? <span className="text-muted-foreground">{d.driverId}</span>}</div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{d.equipment ?? "—"}</td>
                  <td className="px-4 py-2">
                    {d.position
                      ? <span><MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />{d.position.city ?? "?"}{d.position.state ? `, ${d.position.state}` : ""}</span>
                      : <span className="text-xs text-muted-foreground">No location yet</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{fmtAge(d.position?.updatedAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {openDriverId && (
        <DriverDrawer
          driverId={openDriverId}
          onClose={() => setOpenDriverId(null)}
        />
      )}
    </div>
  );
}

// Compact map for the drawer. Google Maps Embed API (iframe). Rendered
// ONLY when caller passes real coords — that gate lives in the parent
// so this component cannot accidentally invent a position. If the API
// key is unset the iframe is replaced with a plain "Map unavailable"
// box; we do NOT render a placeholder labelled as if it were a map.
function DriverMap({ lat, lng }: { lat: number; lng: number }) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) {
    return (
      <div className="h-44 rounded-md border border-border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
        Map unavailable (no Google Maps key configured)
      </div>
    );
  }
  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${lat},${lng}&zoom=12`;
  return (
    <iframe
      title="Driver last-known position"
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="h-44 w-full rounded-md border border-border"
      allowFullScreen={false}
    />
  );
}

function DriverDrawer({ driverId, onClose }: { driverId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const d = await api.adminFleetDriver(driverId);
        if (!cancelled) setDetail(d);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load driver");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [driverId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Driver detail"
      className="fixed inset-0 z-50 flex"
    >
      <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden />
      <div className="w-full max-w-md bg-background border-l border-border overflow-y-auto">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="font-semibold text-sm">Driver detail</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close drawer"><X className="h-4 w-4" /></Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {err && <div className="px-5 py-4 text-sm text-destructive">{err}</div>}

        {detail && (
          <div className="p-5 space-y-5 text-sm">
            <section>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Profile</div>
              <div className="font-semibold">{detail.driver.fullName ?? detail.driver.driverId}</div>
              <div className="text-xs text-muted-foreground">{detail.driver.email ?? "—"} · {detail.driver.phone ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Status: <Badge variant="outline">{detail.driver.status}</Badge></div>
              <div className="text-xs text-muted-foreground">Equipment: {detail.driver.equipment ?? "—"}</div>
              <div className="text-xs text-muted-foreground">MC: {detail.driver.mcNumber ?? "—"}</div>
            </section>

            <section>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Identity verification (IDV)</div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span>{detail.idv?.status ?? "UNVERIFIED"}</span>
              </div>
            </section>

            <section>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Last known position</div>
              {detail.driver.position ? (
                <div className="space-y-2">
                  <div>{detail.driver.position.city ?? "?"}{detail.driver.position.state ? `, ${detail.driver.position.state}` : ""}</div>
                  <div className="text-xs text-muted-foreground">
                    {detail.driver.position.lat.toFixed(4)}, {detail.driver.position.lng.toFixed(4)} · {fmtAge(detail.driver.position.updatedAt)} · source: {detail.driver.position.source}
                  </div>
                  <DriverMap lat={detail.driver.position.lat} lng={detail.driver.position.lng} />
                  {!detail.liveTracking?.connected && (
                    <div className="text-[11px] text-muted-foreground">
                      Live tracking not connected. The pin shows the last driver-app heartbeat, not a real-time telematics fix.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground">No location reported yet.</div>
              )}
            </section>

            <section>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Current load</div>
              {detail.currentLoad ? (
                <div>
                  <div className="font-medium">{detail.currentLoad.loadId}</div>
                  <div className="text-xs text-muted-foreground">
                    {detail.currentLoad.pickupCity}, {detail.currentLoad.pickupState} → {detail.currentLoad.deliveryCity}, {detail.currentLoad.deliveryState}
                  </div>
                  <Badge variant="outline" className="mt-1">{detail.currentLoad.status}</Badge>
                </div>
              ) : (
                <div className="text-muted-foreground">Not on a load.</div>
              )}
            </section>

            <section className="border-t border-border pt-4 flex gap-2">
              <Button variant="outline" size="sm" disabled title="Flag (coming with the audit trail)">
                <Flag className="h-3.5 w-3.5 mr-1.5" /> Flag
              </Button>
              <Button variant="outline" size="sm" disabled title="Opens a support ticket (Phase 3)">
                <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" /> Open ticket
              </Button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
