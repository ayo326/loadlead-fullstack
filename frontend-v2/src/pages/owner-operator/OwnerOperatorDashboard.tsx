import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { MapPin, Navigation, Truck, Users, Package, ArrowRight, AlertCircle } from "lucide-react";
import { LoadRoutePanel } from "@/components/LoadRoutePanel";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { RouteMapCard } from "@/components/RouteMapCard";
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
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
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
      <PageHeader
        title={`Welcome back, ${profile.legalName ?? user?.email}`}
        subtitle="Owner Operator Dashboard"
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/owner-operator/settings")}>
            Settings
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" id="oo-stats">
          <StatCard
            label="Active Load Offers"
            value={loads.length}
            icon={<Package className="h-5 w-5 text-primary" />}
          />
          <StatCard
            label="Fleet Drivers"
            value={fleet.length}
            icon={<Users className="h-5 w-5 text-primary" />}
          />
          <StatCard
            label="MC Number"
            value={profile.mcNumber ?? "—"}
            icon={<Truck className="h-5 w-5 text-primary" />}
          />
        </div>

        {/* Main grid: loads + fleet on left, map sidebar on right */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">

            {/* Load offers */}
            <div className="rounded-xl border bg-card">
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
                            ${offer.rate?.toLocaleString() ?? "—"}
                          </span>
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/owner-operator/loads/${load.loadId}`}>View</Link>
                          </Button>
                        </div>
                      </div>

                      {/* Route toggle footer */}
                      <div className="border-t border-border/60 px-5 py-2.5 flex items-center gap-2 bg-secondary/30">
                        <button
                          onClick={() => setRouteOpenId(routeOpenId === load.loadId ? null : load.loadId)}
                          className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                            routeOpenId === load.loadId ? "text-primary" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Navigation className="h-3.5 w-3.5" />
                          {routeOpenId === load.loadId ? "Hide route" : "Route"}
                        </button>
                        {routeOpenId === load.loadId && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            {load.pickupCity} → {load.deliveryCity}
                          </span>
                        )}
                      </div>

                      {/* Route panel */}
                      {routeOpenId === load.loadId && (
                        <LoadRoutePanel
                          pickupAddress={load.pickupAddress}
                          deliveryAddress={load.deliveryAddress}
                          pickupCity={load.pickupCity}
                          pickupState={load.pickupState}
                          deliveryCity={load.deliveryCity}
                          deliveryState={load.deliveryState}
                          currentCity={profile?.currentCity ?? null}
                          currentState={profile?.currentState ?? null}
                          mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fleet */}
            <div className="rounded-xl border bg-card">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <h2 className="font-semibold">Your Fleet</h2>
                <Button size="sm" variant="outline" onClick={() => navigate("/owner-operator/settings?tab=fleet")}>
                  Manage Fleet
                </Button>
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

          {/* ── Sidebar: route/position map ──────────────────────────────── */}
          <aside>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4 text-primary" />
                  {loads.length > 0 ? "Route preview" : "Fleet area"}
                </div>
                {loads.length > 0 && (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-[130px]">
                    {loads[0].load?.pickupCity} → {loads[0].load?.deliveryCity}
                  </span>
                )}
              </div>
              <RouteMapCard
                pickupAddress={loads[0]?.load?.pickupAddress ?? null}
                deliveryAddress={loads[0]?.load?.deliveryAddress ?? null}
                currentCity={profile?.currentCity ?? null}
                currentState={profile?.currentState ?? null}
                mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
              />
              {loads.length > 1 && (
                <p className="mt-3 text-[11px] text-muted-foreground text-center">
                  +{loads.length - 1} more offer{loads.length > 2 ? "s" : ""} available
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
