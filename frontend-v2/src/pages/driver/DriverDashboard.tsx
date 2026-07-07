import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bell, Gauge, MapPin, Navigation, Package, TrendingUp, Truck, Zap } from "lucide-react";
import { RouteMapCard } from "@/components/RouteMapCard";
import { LoadRoutePanel } from "@/components/LoadRoutePanel";
import { PageHeader, StatCard, StatusPill } from "@/components/PageHeader";
import { PushSubscriptionPrompt } from "@/components/PushSubscriptionPrompt";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Countdown } from "@/components/Countdown";
import { AccountHold } from "@/components/AccountHold";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { registerPush } from "@/lib/pushNotifications";
import { startLocationSharing, stopLocationSharing } from "@/lib/geolocation";
import { toast } from "sonner";

export default function DriverDashboard() {
  const { user } = useAuth();
  const [online, setOnline] = useState(true);
  const [offers, setOffers] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [profileComplete, setProfileComplete] = useState(true);
  const [affiliation, setAffiliation] = useState<{ status: string; carrier: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [locationCity, setLocationCity] = useState<string>("");
  const [routeOpenId, setRouteOpenId] = useState<string | null>(null);
  const locationActive = useRef(false);

  const fetchOffers = async () => {
    try {
      const [lb, pr, af] = await Promise.all([
        api.getDriverLoadboard(),
        api.getDriverProfile().catch((e: any) => {
          if (e.message?.includes("404")) return { driver: null };
          throw e;
        }),
        api.getDriverAffiliation().catch(() => ({ status: "NO_PROFILE", carrier: null })),
      ]);
      setOffers((lb.loads ?? []).filter((l: any) => l.load && l.offer?.status === "OFFERED"));
      setProfile(pr.driver);
      setProfileComplete(!!pr.driver);
      setAffiliation(af);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();
    // Auto-start location sharing when online
    if (!locationActive.current) {
      locationActive.current = true;
      startLocationSharing((city, state) => setLocationCity(city ? `${city}, ${state}` : ""));
    }
    return () => { stopLocationSharing(); locationActive.current = false; };
  }, []);

  const enablePush = async () => {
    const ok = await registerPush();
    if (ok) { setPushEnabled(true); toast.success("Push notifications enabled!"); }
    else toast.error("Could not enable push notifications. Please allow notifications in your browser.");
  };

  const accept = async (loadId: string, label: string) => {
    try {
      await api.acceptOffer(loadId);
      toast.success(`Load ${label} booked!`);
      setOffers((p) => p.filter((o) => o.load?.loadId !== loadId));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const decline = async (loadId: string) => {
    try {
      await api.declineOffer(loadId);
      setOffers((p) => p.filter((o) => o.load?.loadId !== loadId));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const navigate = useNavigate();
  const displayName = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.fullName || profile.legalName || user?.email : user?.email ?? "Driver";
  const bufferPct = profile?.safetyBufferPct ?? 10;
  const maxCapLbs = profile?.maxCapacityLbs ?? 0;
  const maxOpLbs = maxCapLbs * (1 - bufferPct / 100);
  const curLoadLbs = profile?.currentLoadLbs ?? 0;
  const availCap = profile ? Math.max(0, maxOpLbs - curLoadLbs).toLocaleString() : "-";
  const maxCap = profile ? maxCapLbs.toLocaleString() : "-";

  // Volume
  const interiorL = profile?.interiorLengthIn ?? 0;
  const interiorW = profile?.interiorWidthIn ?? 0;
  const interiorH = profile?.interiorHeightIn ?? 0;
  const usableVolCuIn = interiorL * interiorW * interiorH;
  const maxOpVolCuIn = usableVolCuIn * (1 - bufferPct / 100);
  const curVolCuIn = profile?.currentVolumeCuIn ?? 0;
  const availVolCuFt = usableVolCuIn > 0 ? Math.max(0, (maxOpVolCuIn - curVolCuIn) / 1728) : null;

  // Weight utilization % of operational limit
  const weightUsedPct = maxOpLbs > 0 ? Math.min(100, (curLoadLbs / maxOpLbs) * 100) : 0;
  const volUsedPct = maxOpVolCuIn > 0 ? Math.min(100, (curVolCuIn / maxOpVolCuIn) * 100) : 0;
  const overBuffer = profile?.overBufferFlag ?? false;

  const driverStatus = profile?.status;
  const verificationStatus =
    driverStatus === "VERIFIED" || driverStatus === "AVAILABLE" ? "APPROVED" :
    driverStatus === "PENDING_VERIFICATION" ? "PENDING" : "NONE";

  // Affiliation gate: a driver with no carrier of record cannot accept loads
  // (resolveCarrierOfRecord returns null in the backend). Show a passive
  // "waiting for invite" banner so the next-step UX is obvious; the driver
  // can't self-serve here - a carrier admin has to invite them.
  const showAwaitingAffiliation =
    !loading && profile && affiliation && affiliation.status === "UNAFFILIATED";

  return (
    <>
      <AccountHold profileComplete={profileComplete} verificationStatus={verificationStatus} />
      {showAwaitingAffiliation && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900 dark:text-blue-200">
          <Bell className="h-5 w-5 shrink-0 text-blue-500 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Awaiting carrier affiliation.</p>
            <p className="text-xs mt-0.5">
              You won't see matched loads until a carrier admin adds you to their roster. Watch{" "}
              <span className="font-mono text-xs bg-blue-100 dark:bg-blue-900/40 px-1 py-0.5 rounded">{user?.email}</span>{" "}
              for an invitation. You can still complete identity verification now.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-200">
            <Link to="/driver/verification/idv">Onboarding</Link>
          </Button>
        </div>
      )}
      <PushSubscriptionPrompt />
      <PageHeader
        eyebrow={`Driver · ${displayName}`}
        title="Live load offers"
        subtitle="Only loads matching your equipment, capacity, and radius show here. Tap accept before the timer runs out."
        actions={
          <div data-tour="driver-idv" className="flex items-center gap-2 flex-wrap">
            {locationCity && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-full px-3 py-1.5 bg-card">
                <MapPin className="h-3 w-3 text-primary" /> {locationCity}
              </span>
            )}
            {!pushEnabled && (
              <Button size="sm" variant="outline" onClick={enablePush} className="rounded-full gap-1.5">
                <Bell className="h-3.5 w-3.5" /> Enable alerts
              </Button>
            )}
            <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2">
              <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-sm font-medium">{online ? "Online · Accepting" : "Offline"}</span>
              <Switch checked={online} onCheckedChange={setOnline} />
            </div>
          </div>
        }
      />

      {overBuffer && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-3">
          <span className="text-destructive font-bold text-lg leading-none">!</span>
          <div className="text-sm">
            <span className="font-semibold text-destructive">Over Buffer:</span>{" "}
            Your current load exceeds the operational limit after a buffer adjustment. You cannot accept new loads until resolved. Contact your admin.
          </div>
        </div>
      )}

      <div data-tour="driver-affiliation" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {/* Weight capacity meter */}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Weight capacity</p>
          <p className="text-xl font-bold">{availCap} <span className="text-sm font-normal text-muted-foreground">lbs bookable</span></p>
          <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${weightUsedPct >= 100 ? "bg-destructive" : weightUsedPct >= 90 ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${weightUsedPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{weightUsedPct.toFixed(0)}% of {maxOpLbs.toLocaleString()} op. limit · {bufferPct}% buffer</p>
        </div>

        {/* Volume capacity meter */}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Volume capacity</p>
          {availVolCuFt !== null ? (
            <>
              <p className="text-xl font-bold">{availVolCuFt.toFixed(0)} <span className="text-sm font-normal text-muted-foreground">cu ft bookable</span></p>
              <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${volUsedPct >= 100 ? "bg-destructive" : volUsedPct >= 90 ? "bg-warning" : "bg-primary"}`}
                  style={{ width: `${volUsedPct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{volUsedPct.toFixed(0)}% of op. limit</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-2">Set interior dims in Equipment settings to enable volume matching.</p>
          )}
        </div>

        <StatCard label="Equipment" value={profile?.trailerType?.replace("_", " ") ?? "-"} hint={profile?.cdlClass ? `CDL-${profile.cdlClass}` : ""} />
        <StatCard label="Location" value={profile?.currentCity ?? "-"} hint={profile?.currentState ?? ""} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div data-tour="driver-offers" className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" />
              {loading ? "Loading…" : `${offers.length} live offer${offers.length !== 1 ? "s" : ""}`}
            </h2>
            <Button variant="ghost" size="sm" onClick={fetchOffers}>Refresh</Button>
          </div>

          {offers.map((o) => {
            const load = o.load;
            const offer = o.offer;
            const miles = load.totalMiles ?? 0;
            const rate = load.rateAmount ?? 0;
            const total = load.rateType === "PER_MILE" ? (miles * rate).toFixed(0) : rate.toFixed(0);

            return (
              <div
                key={load.loadId}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/driver/loads/${load.loadId}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/driver/loads/${load.loadId}`)}
                className="rounded-md border border-border bg-card overflow-hidden hover:border-primary/30 transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/40">
                  <div className="flex items-center gap-3">
                    <StatusPill status="BROADCAST" />
                    <span className="text-xs text-muted-foreground">{load.referenceNumber}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {offer?.expiresAt && <Countdown expiresAt={offer.expiresAt * 1000} />}
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <div className="p-5 grid md:grid-cols-12 gap-5 items-center">
                  <div className="md:col-span-5">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center pt-1">
                        <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                        <div className="w-px flex-1 bg-border my-1 min-h-[28px]" />
                        <div className="h-2.5 w-2.5 rounded-full bg-accent" />
                      </div>
                      <div className="flex-1 space-y-3 min-w-0">
                        <div>
                          <div className="text-sm font-semibold truncate">{load.pickupCity}, {load.pickupState}</div>
                          <div className="text-xs text-muted-foreground">Pickup · {load.pickupTime}</div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold truncate">{load.deliveryCity}, {load.deliveryState}</div>
                          <div className="text-xs text-muted-foreground">{miles} mi · {load.equipmentType?.replace("_", " ")}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-4 grid grid-cols-3 gap-3">
                    <Mini label="Weight" value={`${(load.totalWeightLbs / 1000).toFixed(1)}k`} />
                    <Mini label="$/mile" value={`$${Number(rate).toFixed(2)}`} />
                    <Mini label="Total" value={`$${Number(total).toLocaleString()}`} accent />
                  </div>
                  <div className="md:col-span-3 flex md:flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" className="flex-1" disabled={!profileComplete || verificationStatus !== "APPROVED"} onClick={() => decline(load.loadId)}>Decline</Button>
                    <Button
                      className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                      disabled={!profileComplete || verificationStatus !== "APPROVED"}
                      onClick={() => accept(load.loadId, load.referenceNumber)}
                    >
                      Accept <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* ── Route toggle footer ──────────────────────────────── */}
                <div
                  className="border-t border-border/60 px-5 py-2.5 flex items-center gap-2 bg-secondary/30"
                  onClick={(e) => e.stopPropagation()}
                >
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

                {/* ── Route panel ──────────────────────────────────────── */}
                {routeOpenId === load.loadId && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <LoadRoutePanel
                      pickupAddress={load.pickupAddress}
                      deliveryAddress={load.deliveryAddress}
                      pickupCity={load.pickupCity}
                      pickupState={load.pickupState}
                      deliveryCity={load.deliveryCity}
                      deliveryState={load.deliveryState}
                      currentLat={profile?.currentLat}
                      currentLng={profile?.currentLng}
                      currentCity={profile?.currentCity}
                      currentState={profile?.currentState}
                      mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {!loading && offers.length === 0 && (
            <div className="rounded-md border border-dashed border-border bg-card p-12 text-center">
              <Truck className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">No live offers. We'll show them here the moment one matches.</p>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4 text-primary" />
                {offers.length > 0 ? "Route preview" : "Current position"}
              </div>
              {offers.length > 0 && (
                <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {offers[0].load?.pickupCity} → {offers[0].load?.deliveryCity}
                </span>
              )}
            </div>
            <RouteMapCard
              pickupAddress={offers[0]?.load?.pickupAddress ?? null}
              deliveryAddress={offers[0]?.load?.deliveryAddress ?? null}
              currentCity={profile?.currentCity ?? null}
              currentState={profile?.currentState ?? null}
              currentLat={profile?.currentLat ?? null}
              currentLng={profile?.currentLng ?? null}
              mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
            />
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-secondary p-2.5">
                <div className="text-muted-foreground">Equipment</div>
                <div className="font-semibold">{profile?.trailerType?.replace("_", " ") ?? "-"}</div>
              </div>
              <div className="rounded-lg bg-secondary p-2.5">
                <div className="text-muted-foreground">MC</div>
                <div className="font-semibold">{profile?.mcNumber ?? "-"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold mb-4"><TrendingUp className="h-4 w-4 text-primary" /> Profile summary</div>
            <Row icon={Package} label="Experience" value={`${profile?.experienceYears ?? "-"} yrs`} />
            <Row icon={Gauge} label="CDL class" value={profile ? `Class ${profile.cdlClass}` : "-"} />
            <Row icon={TrendingUp} label="DOT" value={profile?.dotNumber ?? "-"} />
          </div>
        </aside>
      </div>
    </>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary p-2.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${accent ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
