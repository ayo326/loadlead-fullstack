import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { MapPin, Navigation, Truck, Users, Package, ArrowRight, AlertCircle } from "lucide-react";
import { LoadRoutePanel } from "@/components/LoadRoutePanel";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { PushSubscriptionPrompt } from "@/components/PushSubscriptionPrompt";
import { OwnerOperatorDashboardView } from "@/components/dashboard/OwnerOperatorDashboardView";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function OwnerOperatorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loads, setLoads] = useState<any[]>([]);
  const [fleet, setFleet] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [routeOpenId, setRouteOpenId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [profRes, lbRes, fleetRes] = await Promise.all([
          api.getOwnerOperatorProfile().catch((e: any) => {
            if (e.message?.includes("404")) return { ownerOperator: null };
            throw e;
          }),
          api.getOwnerOperatorLoadboard().catch(() => ({ loads: [] })),
          api.getOwnerOperatorFleet().catch(() => ({ drivers: [] })),
        ]);
        setProfile(profRes.ownerOperator);
        setLoads((lbRes.loads ?? []).filter((l: any) => l.load && l.offer?.status === "OFFERED"));
        setFleet(fleetRes.drivers ?? []);
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="h-16 w-16 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
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

  return (
    <div className="min-h-screen bg-background">
      <PushSubscriptionPrompt />
      {/* V1: Settings lives once, in the sidebar (canonical). The former header
          Settings duplicate is removed. */}
      <PageHeader
        title={`Welcome back, ${profile.legalName ?? user?.email}`}
        subtitle="Owner Operator Dashboard"
      />

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* P1 (above the fold): the actionable loadboard + route map + key
            stats come first. The blended secondary view (my haul, verification,
            fleet health, financial, SLA) renders BELOW. V2. */}

        {/* Stats */}
        <div data-tour="oo-verification" className="grid grid-cols-1 sm:grid-cols-3 gap-4" id="oo-stats">
          <StatCard
            label="Active Load Offers"
            value={String(loads.length)}
            icon={<Package className="h-5 w-5 text-primary" />}
          />
          <StatCard
            label="Fleet Drivers"
            value={String(fleet.length)}
            icon={<Users className="h-5 w-5 text-primary" />}
          />
          <StatCard
            label="MC Number"
            value={profile.mcNumber ?? "-"}
            icon={<Truck className="h-5 w-5 text-primary" />}
          />
        </div>

        {/* Single column: Available Loads, then a horizontal Route preview, then
            Your Fleet. Clicking "Route" on a load updates the preview map. */}
        <div className="space-y-6">

            {/* Load offers */}
            <div data-tour="oo-loadboard" className="rounded-xl border bg-card">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <h2 className="font-semibold">Available Loads</h2>
                <span className="text-xs text-muted-foreground">{loads.length} offered</span>
              </div>
              {loads.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Package className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No load offers right now.</p>
                  <p className="text-xs">Add drivers to your fleet to increase coverage.</p>
                </div>
              ) : (
                <div>
                  {loads.map(({ load, offer }: any) => (
                    <div key={load.loadId} className="border-b border-border last:border-0">
                      {/* Main row */}
                      <div className="px-5 py-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{load.pickupCity}, {load.pickupState} → {load.deliveryCity}, {load.deliveryState}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {load.trailerType} · {load.totalWeightLbs?.toLocaleString()} lbs
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-semibold text-green-600">
                            ${offer.rate?.toLocaleString() ?? "-"}
                          </span>
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/owner-operator/loads/${load.loadId}`}>View</Link>
                          </Button>
                        </div>
                      </div>

                      {/* Route select: updates the horizontal Route preview below. */}
                      <div className="border-t border-border/60 px-5 py-2.5 flex items-center gap-2 bg-secondary/30">
                        <button
                          onClick={() => setRouteOpenId(load.loadId)}
                          className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                            (routeOpenId ?? loads[0]?.load?.loadId) === load.loadId ? "text-primary" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Navigation className="h-3.5 w-3.5" />
                          Route
                        </button>
                        {(routeOpenId ?? loads[0]?.load?.loadId) === load.loadId && (
                          <span className="text-[10px] text-muted-foreground ml-1">Shown in Route preview</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Route preview: horizontal, sits between Available Loads and Your
                Fleet. Defaults to the first offer; clicking "Route" on a load
                above updates it, using the same LoadRoutePanel route logic. */}
            {loads.length > 0 && (() => {
              const routeLoad =
                (routeOpenId && loads.find((l: any) => l.load.loadId === routeOpenId)?.load) ||
                loads[0]?.load;
              if (!routeLoad) return null;
              return (
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <MapPin className="h-4 w-4 text-primary" /> Route preview
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-[240px]">
                      {routeLoad.pickupCity} → {routeLoad.deliveryCity}
                    </span>
                  </div>
                  <LoadRoutePanel
                    pickupAddress={routeLoad.pickupAddress}
                    deliveryAddress={routeLoad.deliveryAddress}
                    pickupCity={routeLoad.pickupCity}
                    pickupState={routeLoad.pickupState}
                    deliveryCity={routeLoad.deliveryCity}
                    deliveryState={routeLoad.deliveryState}
                    currentCity={profile?.currentCity ?? null}
                    currentState={profile?.currentState ?? null}
                    mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                    mapAspectRatio="32 / 9"
                  />
                </div>
              );
            })()}

            {/* Fleet */}
            <div data-tour="oo-fleet" className="rounded-xl border bg-card">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <h2 className="font-semibold">Your Fleet</h2>
                {/* D8: add/assign action surfaced inline on the card (both empty
                    and populated states); the full manager stays in Settings. */}
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
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Users className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No drivers in your fleet yet.</p>
                  <Button size="sm" className="mt-2" onClick={() => navigate("/owner-operator/settings?tab=fleet")}>
                    Invite a Driver
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {fleet.map((driver: any) => (
                    <div key={driver.driverId} className="px-5 py-3 flex items-center gap-3">
                      {driver.headshotUrl ? (
                        <img src={driver.headshotUrl} className="h-9 w-9 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold">
                          {driver.legalName?.[0] ?? "D"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{driver.legalName}</p>
                        <p className="text-xs text-muted-foreground">{driver.cdlClass} · {driver.trailerType}</p>
                      </div>
                      <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
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
            </div>
        </div>

        {/* P2/P3: blended secondary view (my haul, verification, fleet health,
            financial, SLA). Its own tendered-loadboard is suppressed so the
            "Available Loads" board above is the single source of truth. V3. */}
        <OwnerOperatorDashboardView hideLoadboard />
      </div>
    </div>
  );
}
