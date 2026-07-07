import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bell, Gauge, MapPin, Navigation, Package, TrendingUp, Truck, Zap } from "lucide-react";
import { LoadRoutePanel } from "@/components/LoadRoutePanel";
import { StatusPill } from "@/components/PageHeader";
import { PushSubscriptionPrompt } from "@/components/PushSubscriptionPrompt";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Countdown } from "@/components/Countdown";
import { AccountHold } from "@/components/AccountHold";
import { CommandShell, CommandCard } from "@/components/dashboard/CommandShell";
import { CommandMap, MapPin as MapPinT } from "@/components/dashboard/CommandMap";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { registerPush } from "@/lib/pushNotifications";
import { startLocationSharing, stopLocationSharing } from "@/lib/geolocation";
import { toast } from "sonner";

// Composition-only recompose of the Fleet Driver dashboard into the command
// shell. Accept/Decline behavior is preserved EXACTLY (same handlers). Check-in
// and check-out are NOT on this dashboard today (they live on the driver
// load-detail page); this build does not move them - the assignment links
// there, where they stay unchanged.

export default function DriverDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [online, setOnline] = useState(true);
  const [offers, setOffers] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [profileComplete, setProfileComplete] = useState(true);
  const [affiliation, setAffiliation] = useState<{ status: string; carrier: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [locationCity, setLocationCity] = useState<string>("");
  const [routeOpenId, setRouteOpenId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const offerRefs = useRef<Record<string, HTMLDivElement | null>>({});
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

  // Behavior preserved exactly.
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

  const displayName = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.fullName || profile.legalName || user?.email : user?.email ?? "Driver";
  const bufferPct = profile?.safetyBufferPct ?? 10;
  const maxCapLbs = profile?.maxCapacityLbs ?? 0;
  const maxOpLbs = maxCapLbs * (1 - bufferPct / 100);
  const curLoadLbs = profile?.currentLoadLbs ?? 0;
  const availCap = profile ? Math.max(0, maxOpLbs - curLoadLbs).toLocaleString() : "-";
  const weightUsedPct = maxOpLbs > 0 ? Math.min(100, (curLoadLbs / maxOpLbs) * 100) : 0;
  const overBuffer = profile?.overBufferFlag ?? false;

  // Volume capacity (retained from the prior dashboard; renders only when
  // interior dims are set, otherwise a connect hint).
  const usableVolCuIn = (profile?.interiorLengthIn ?? 0) * (profile?.interiorWidthIn ?? 0) * (profile?.interiorHeightIn ?? 0);
  const maxOpVolCuIn = usableVolCuIn * (1 - bufferPct / 100);
  const curVolCuIn = profile?.currentVolumeCuIn ?? 0;
  const availVolCuFt = usableVolCuIn > 0 ? Math.max(0, (maxOpVolCuIn - curVolCuIn) / 1728) : null;
  const volUsedPct = maxOpVolCuIn > 0 ? Math.min(100, (curVolCuIn / maxOpVolCuIn) * 100) : 0;

  const driverStatus = profile?.status;
  const verificationStatus =
    driverStatus === "VERIFIED" || driverStatus === "AVAILABLE" ? "APPROVED" :
    driverStatus === "PENDING_VERIFICATION" ? "PENDING" : "NONE";
  const canAct = profileComplete && verificationStatus === "APPROVED";

  const showAwaitingAffiliation =
    !loading && profile && affiliation && affiliation.status === "UNAFFILIATED";

  // Map pins: offer pickups + the driver's own position.
  const pins = useMemo<MapPinT[]>(() => {
    const out: MapPinT[] = [];
    for (const { load } of offers) {
      if (Number.isFinite(load?.pickupLat) && Number.isFinite(load?.pickupLng)) {
        out.push({ id: load.loadId, lat: load.pickupLat, lng: load.pickupLng, kind: "offer", label: `${load.pickupCity} -> ${load.deliveryCity}` });
      }
    }
    if (Number.isFinite(profile?.currentLat) && Number.isFinite(profile?.currentLng)) {
      out.push({ id: "self", lat: profile.currentLat, lng: profile.currentLng, kind: "truck", label: "You" });
    }
    return out;
  }, [offers, profile]);

  const focusOffer = (id: string) => {
    setActiveId(id);
    offerRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      {/* Full-width alerts stay above the shell. */}
      <AccountHold profileComplete={profileComplete} verificationStatus={verificationStatus} />
      <div className="mx-auto max-w-[1400px] px-4 pt-4 lg:px-6">
        {showAwaitingAffiliation && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-200">
            <Bell className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <div className="flex-1 text-sm">
              <p className="font-semibold">Awaiting carrier affiliation.</p>
              <p className="mt-0.5 text-xs">
                You won't see matched loads until a carrier admin adds you to their roster. Watch{" "}
                <span className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900/40">{user?.email}</span>{" "}
                for an invitation. You can still complete identity verification now.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-200">
              <Link to="/driver/verification/idv">Onboarding</Link>
            </Button>
          </div>
        )}
        {overBuffer && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
            <span className="text-lg font-bold leading-none text-destructive">!</span>
            <div className="text-sm">
              <span className="font-semibold text-destructive">Over Buffer:</span>{" "}
              Your current load exceeds the operational limit after a buffer adjustment. You cannot accept new loads until resolved. Contact your admin.
            </div>
          </div>
        )}
      </div>
      <PushSubscriptionPrompt />

      <CommandShell
        title={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-overline font-mono uppercase text-muted-foreground">Driver - {displayName}</div>
              <h1 className="text-xl font-semibold">Live load offers</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {locationCity && (
                <span className="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 text-primary" /> {locationCity}
                </span>
              )}
              {!pushEnabled && (
                <Button size="sm" variant="outline" onClick={enablePush} className="gap-1.5 rounded-full">
                  <Bell className="h-3.5 w-3.5" /> Enable alerts
                </Button>
              )}
              <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2">
                <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
                <span className="text-sm font-medium">{online ? "Online - Accepting" : "Offline"}</span>
                <Switch checked={online} onCheckedChange={setOnline} />
              </div>
            </div>
          </div>
        }
        rail={
          <CommandCard loud={offers.length > 0} data-tour="driver-offers">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="h-4 w-4 text-warning" />
                {loading ? "Loading..." : `${offers.length} live offer${offers.length !== 1 ? "s" : ""}`}
              </h2>
              <Button variant="ghost" size="sm" onClick={fetchOffers}>Refresh</Button>
            </div>

            {!loading && offers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
                <Truck className="h-8 w-8 opacity-40" />
                <p className="text-sm">No live offers. We'll show them the moment one matches.</p>
              </div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto">
                {offers.map((o) => {
                  const load = o.load;
                  const offer = o.offer;
                  const miles = load.totalMiles ?? 0;
                  const rate = load.rateAmount ?? 0;
                  const total = load.rateType === "PER_MILE" ? (miles * rate).toFixed(0) : rate.toFixed(0);
                  return (
                    <div
                      key={load.loadId}
                      ref={(el) => { offerRefs.current[load.loadId] = el; }}
                      className={`border-b border-border px-4 py-3 last:border-0 ${activeId === load.loadId ? "bg-amber-400/10" : ""}`}
                      data-testid={`offer-${load.loadId}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <StatusPill status="BROADCAST" />
                          <span className="text-xs text-muted-foreground">{load.referenceNumber}</span>
                        </div>
                        {offer?.expiresAt && <Countdown expiresAt={offer.expiresAt * 1000} />}
                      </div>
                      <button
                        onClick={() => navigate(`/driver/loads/${load.loadId}`)}
                        className="block w-full text-left"
                      >
                        <div className="text-sm font-semibold">{load.pickupCity}, {load.pickupState}</div>
                        <div className="text-xs text-muted-foreground">to {load.deliveryCity}, {load.deliveryState} - {miles} mi</div>
                      </button>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <Mini label="Weight" value={`${(load.totalWeightLbs / 1000).toFixed(1)}k`} />
                        <Mini label="$/mi" value={`$${Number(rate).toFixed(2)}`} />
                        <Mini label="Total" value={`$${Number(total).toLocaleString()}`} accent />
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1" disabled={!canAct} onClick={() => decline(load.loadId)}>Decline</Button>
                        <Button size="sm" className="flex-1 bg-success text-success-foreground hover:bg-success/90" disabled={!canAct} onClick={() => accept(load.loadId, load.referenceNumber)}>
                          Accept <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <button
                        onClick={() => setRouteOpenId(routeOpenId === load.loadId ? null : load.loadId)}
                        className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${routeOpenId === load.loadId ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <Navigation className="h-3.5 w-3.5" /> {routeOpenId === load.loadId ? "Hide route" : "Route"}
                      </button>
                      {routeOpenId === load.loadId && (
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CommandCard>
        }
        map={
          <CommandCard className="overflow-hidden p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Navigation className="h-4 w-4 text-primary" />
                {offers.length > 0 ? "Offers near you" : "Current position"}
              </div>
              <span className="text-[11px] text-muted-foreground">{pins.filter((p) => p.kind === "offer").length} mapped</span>
            </div>
            <CommandMap
              pins={pins}
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
            {/* Capacity (weight) meter - driver state. */}
            <CommandCard className="px-4 py-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Weight capacity</p>
              <p className="text-xl font-bold">{availCap} <span className="text-sm font-normal text-muted-foreground">lbs bookable</span></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div className={`h-full rounded-full ${weightUsedPct >= 100 ? "bg-destructive" : weightUsedPct >= 90 ? "bg-warning" : "bg-primary"}`} style={{ width: `${weightUsedPct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{weightUsedPct.toFixed(0)}% of {maxOpLbs.toLocaleString()} op. limit - {bufferPct}% buffer</p>
            </CommandCard>

            {/* Volume capacity meter (retained). */}
            <CommandCard className="px-4 py-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Volume capacity</p>
              {availVolCuFt !== null ? (
                <>
                  <p className="text-xl font-bold">{availVolCuFt.toFixed(0)} <span className="text-sm font-normal text-muted-foreground">cu ft bookable</span></p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className={`h-full rounded-full ${volUsedPct >= 100 ? "bg-destructive" : volUsedPct >= 90 ? "bg-warning" : "bg-primary"}`} style={{ width: `${volUsedPct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{volUsedPct.toFixed(0)}% of op. limit</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Set interior dims in Equipment settings to enable volume matching.</p>
              )}
            </CommandCard>

            {/* Profile summary + equipment + MC/DOT. */}
            <CommandCard className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" /> Profile</div>
              <Row icon={Truck} label="Equipment" value={profile?.trailerType?.replace("_", " ") ?? "-"} />
              <Row icon={MapPin} label="Location" value={profile?.currentCity ? `${profile.currentCity}, ${profile.currentState ?? ""}` : "-"} />
              <Row icon={Package} label="Experience" value={`${profile?.experienceYears ?? "-"} yrs`} />
              <Row icon={Gauge} label="CDL class" value={profile ? `Class ${profile.cdlClass}` : "-"} />
              <Row icon={TrendingUp} label="MC / DOT" value={`${profile?.mcNumber ?? "-"} / ${profile?.dotNumber ?? "-"}`} />
            </CommandCard>
            {/* HOS / hours context is hidden until telematics data exists. */}
          </>
        }
      />
    </>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${accent ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
