import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Truck, Users, Package, ArrowRight, Navigation, ShieldCheck, DollarSign,
  Activity, FileCheck, Bell,
} from "lucide-react";
import { PushSubscriptionPrompt } from "@/components/PushSubscriptionPrompt";
import { OwnerOperatorDashboardView } from "@/components/dashboard/OwnerOperatorDashboardView";
import { CommandShell, CommandCard } from "@/components/dashboard/CommandShell";
import { CommandMap, MapPin as MapPinT } from "@/components/dashboard/CommandMap";
import { EarningsStrip } from "@/components/dashboard/EarningsStrip";
import { Countdown } from "@/components/Countdown";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Composition-only recompose of the Owner-Operator dashboard into the shared
// command layout. NOTHING IS DELETED: the P1 zones (my haul, offers, map,
// verification, earnings, compact activity/health) surface the actionable few;
// the ENTIRE prior blended view (alerts, fleet, financial, SLA, history) is
// retained below in P3 via <OwnerOperatorDashboardView>. Offers keep their
// View -> load-detail behavior (bid/accept live in the NegotiationPanel there).

export default function OwnerOperatorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loads, setLoads] = useState<any[]>([]);
  const [fleet, setFleet] = useState<any[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const offerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    (async () => {
      try {
        const [profRes, lbRes, fleetRes, dashRes, notifRes] = await Promise.all([
          api.getOwnerOperatorProfile().catch((e: any) => {
            if (e.message?.includes("404")) return { ownerOperator: null };
            throw e;
          }),
          api.getOwnerOperatorLoadboard().catch(() => ({ loads: [] })),
          api.getOwnerOperatorFleet().catch(() => ({ drivers: [] })),
          api.getOoDashboard().catch(() => null),
          api.getNotifications().catch(() => ({ notifications: [] })),
        ]);
        setProfile(profRes.ownerOperator);
        setLoads((lbRes.loads ?? []).filter((l: any) => l.load && l.offer?.status === "OFFERED"));
        setFleet(fleetRes.drivers ?? []);
        setDash(dashRes);
        setActivity((notifRes.notifications ?? []).slice(0, 6));
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Map pins: one per offered-load pickup, plus the operator position ──────
  const pins = useMemo<MapPinT[]>(() => {
    const out: MapPinT[] = [];
    for (const { load } of loads) {
      if (Number.isFinite(load?.pickupLat) && Number.isFinite(load?.pickupLng)) {
        out.push({
          id: load.loadId,
          lat: load.pickupLat,
          lng: load.pickupLng,
          kind: "offer",
          label: `${load.pickupCity}, ${load.pickupState} -> ${load.deliveryCity}, ${load.deliveryState}`,
        });
      }
    }
    if (Number.isFinite(profile?.currentLat) && Number.isFinite(profile?.currentLng)) {
      out.push({ id: "self", lat: profile.currentLat, lng: profile.currentLng, kind: "truck", label: "You" });
    }
    return out;
  }, [loads, profile]);

  // Active-haul route line when a load is in progress.
  const route = useMemo(() => {
    const h = dash?.myHaul;
    if (!h?.pickup?.lat || !h?.delivery?.lat) return undefined;
    return [
      { lat: h.pickup.lat, lng: h.pickup.lng },
      { lat: h.delivery.lat, lng: h.delivery.lng },
    ];
  }, [dash]);

  const focusOffer = (id: string) => {
    setActiveId(id);
    const el = offerRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-md bg-primary/10">
            <Truck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Set Up Your Profile</h1>
          <p className="text-muted-foreground">
            Complete your Owner Operator profile to start seeing loads and managing your fleet.
          </p>
          <Button onClick={() => navigate("/owner-operator/settings")}>
            Set Up Profile <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  const haul = dash?.myHaul;
  const ver = dash?.verification;

  return (
    <>
      <PushSubscriptionPrompt />
      <CommandShell
        title={
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">Welcome back, {profile.legalName ?? user?.email}</h1>
              <p className="text-sm text-muted-foreground">Owner Operator Dashboard</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Truck className="h-3.5 w-3.5" />
              MC {profile.mcNumber ?? "-"}
            </div>
          </div>
        }
        rail={
          <>
            {/* My haul: one-line state, only when a load is active. */}
            {haul && (
              <CommandCard accent="#34D399" className="px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Navigation className="h-3.5 w-3.5 text-emerald-500" /> My haul
                </div>
                <p className="mt-1 truncate text-sm font-medium">
                  {haul.pickup.city}, {haul.pickup.state} -&gt; {haul.delivery.city}, {haul.delivery.state}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {haul.status} {haul.rate ? `- $${haul.rate.toLocaleString()}` : ""}
                </p>
              </CommandCard>
            )}

            {/* OFFERS (P1): the loudest panel when a live offer exists. */}
            <CommandCard loud={loads.length > 0} data-tour="oo-loadboard">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-amber-500" />
                  <h2 className="text-sm font-semibold">Load offers</h2>
                </div>
                <span className="text-xs text-muted-foreground">{loads.length} live</span>
              </div>
              {loads.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-muted-foreground">
                  <Package className="h-7 w-7 opacity-40" />
                  <p className="text-sm">No live offers right now.</p>
                  <p className="text-xs">Matched offers appear here with a countdown.</p>
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  {loads.map(({ load, offer }: any) => (
                    <div
                      key={load.loadId}
                      ref={(el) => { offerRefs.current[load.loadId] = el; }}
                      data-testid={`offer-${load.loadId}`}
                      className={`border-b border-border px-4 py-3 last:border-0 transition-colors ${
                        activeId === load.loadId ? "bg-amber-400/10" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">
                          {load.pickupCity}, {load.pickupState} -&gt; {load.deliveryCity}, {load.deliveryState}
                        </p>
                        <span className="shrink-0 text-sm font-semibold text-emerald-600">
                          ${offer.rate?.toLocaleString() ?? "-"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {load.trailerType} - {load.totalWeightLbs?.toLocaleString()} lbs
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {offer?.expiresAt ? (
                          <Countdown expiresAt={offer.expiresAt * 1000} />
                        ) : <span className="text-xs text-muted-foreground">Open</span>}
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/owner-operator/loads/${load.loadId}`}>View</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CommandCard>

            {/* Verification badges (compliance packet state). */}
            {ver && (
              <CommandCard className="px-4 py-3" data-tour="oo-verification">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Verification
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <VerRow label="Carrier authority (FMCSA + KYB)" ok={!!ver.authority?.verificationCurrent} />
                  <VerRow label="Personal identity (IDV)" ok={ver.identity?.status === "APPROVED" || ver.identity?.status === "VERIFIED"} />
                </div>
              </CommandCard>
            )}
          </>
        }
        map={
          <CommandCard className="overflow-hidden p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Navigation className="h-4 w-4 text-primary" />
                {loads.length > 0 ? "Live loads" : "Your area"}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {pins.filter((p) => p.kind === "offer").length} mapped
              </span>
            </div>
            <CommandMap
              pins={pins}
              route={route}
              activeId={activeId}
              onPinClick={(id) => id !== "self" && focusOffer(id)}
              fallbackCenter={
                Number.isFinite(profile?.currentLat) && Number.isFinite(profile?.currentLng)
                  ? { lat: profile.currentLat, lng: profile.currentLng }
                  : null
              }
              mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
            />
          </CommandCard>
        }
        activity={
          <>
            {/* Recent activity */}
            <CommandCard className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Bell className="h-3.5 w-3.5 text-primary" /> Recent activity
              </div>
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">No recent events.</p>
              ) : (
                <ul className="space-y-2">
                  {activity.map((n: any) => (
                    <li key={n.notificationId ?? n.id} className="flex items-start gap-2 text-xs">
                      <Activity className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="font-medium">{n.title ?? n.type ?? "Update"}</span>
                        {n.body && <span className="block truncate text-muted-foreground">{n.body}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CommandCard>

            {/* Fleet health (compact, non-zero only) */}
            <FleetHealthCompact dash={dash} fleetCount={fleet.length} />

            {/* Compliance packet shortcut */}
            <CommandCard className="px-4 py-3">
              <button
                onClick={() => navigate("/owner-operator/factoring")}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <FileCheck className="h-3.5 w-3.5 text-primary" /> Compliance packet
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </CommandCard>
          </>
        }
        earnings={<EarningsStrip financial={dash?.financial} />}
        p3={
          <>
            {/* Fleet card (relocated from the old primary column) */}
            <CommandCard data-tour="oo-fleet">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="font-semibold">Your Fleet</h2>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => navigate("/owner-operator/settings?tab=fleet")}>
                    <Users className="h-4 w-4" /> Add driver
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate("/owner-operator/settings?tab=fleet")}>
                    Manage Fleet
                  </Button>
                </div>
              </div>
              {fleet.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Users className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No drivers in your fleet yet.</p>
                  <Button size="sm" className="mt-1" onClick={() => navigate("/owner-operator/settings?tab=fleet")}>
                    Invite a Driver
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {fleet.map((driver: any) => (
                    <div key={driver.driverId} className="flex items-center gap-3 px-5 py-3">
                      {driver.headshotUrl ? (
                        <img src={driver.headshotUrl} className="h-9 w-9 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                          {driver.legalName?.[0] ?? "D"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{driver.legalName}</p>
                        <p className="text-xs text-muted-foreground">{driver.cdlClass} - {driver.trailerType}</p>
                      </div>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                        driver.status === "ACTIVE" ? "bg-green-100 text-green-700" :
                        driver.status === "SUSPENDED" ? "bg-red-100 text-red-700" :
                        "bg-secondary text-muted-foreground"
                      }`}>
                        {driver.status ?? "PENDING"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CommandCard>

            {/* The ENTIRE prior blended view: dispatcher/exec, alerts, fleet
                health detail, financial, SLA, history. Its own loadboard stays
                suppressed so the rail Offers block is the single source. */}
            <OwnerOperatorDashboardView hideLoadboard />
          </>
        }
      />
    </>
  );
}

// ── Small rail/activity helpers ─────────────────────────────────────────────

function VerRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
        ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}>
        {ok ? "Verified" : "Pending"}
      </span>
    </div>
  );
}

// Compact fleet-health strip: only renders tiles that have real, non-zero
// active state, so there is no wall of zeros. Hidden entirely when idle.
function FleetHealthCompact({ dash, fleetCount }: { dash: any; fleetCount: number }) {
  const al = dash?.alerts?.activeLoads;
  const tiles: Array<{ label: string; value: number }> = [];
  if (al) {
    for (const [label, value] of [
      ["Booked", al.booked], ["Dispatched", al.dispatched], ["In transit", al.inTransit],
      ["At pickup", al.atPickup], ["Delivered", al.delivered],
    ] as Array<[string, number]>) {
      if (typeof value === "number" && value > 0) tiles.push({ label, value });
    }
  }
  if (tiles.length === 0 && fleetCount === 0) return null;

  return (
    <CommandCard className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <DollarSign className="h-3.5 w-3.5 text-primary" /> Fleet health
      </div>
      {tiles.length === 0 ? (
        <p className="text-xs text-muted-foreground">All clear - {fleetCount} driver{fleetCount === 1 ? "" : "s"}, no active loads.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded border border-border px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
              <div className="text-lg font-semibold tabular-nums">{t.value}</div>
            </div>
          ))}
        </div>
      )}
    </CommandCard>
  );
}
