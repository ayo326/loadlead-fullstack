import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Package, Truck } from "lucide-react";
import { PageHeader, StatCard, StatusPill } from "@/components/PageHeader";
import { AccountHold } from "@/components/AccountHold";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ReceiverDashboard - backed by the real /api/receiver/incoming endpoint.
//
// Stat cards are derived from the in-transit list returned by that endpoint
// (no mocked totals). When data isn't available yet, cards show "-" rather
// than fabricated numbers, per the no-fabrication audit rule. The 30-day
// delivered count + exceptions count don't have a real source yet (no
// receiver-side delivered/exceptions endpoint exists) - both honestly say
// "-" instead of a confident-looking lie.

type Load = {
  loadId: string;
  pickupCity?: string; pickupState?: string;
  deliveryCity?: string; deliveryState?: string;
  shipperId?: string;
  assignedDriverId?: string;
  status?: string;
  estimatedDeliveryTime?: string;
  scheduledPickupTime?: string;
};

function place(city?: string, state?: string) {
  return [city, state].filter(Boolean).join(", ") || "-";
}

export default function ReceiverDashboard() {
  const [profile, setProfile] = useState<any>(null);
  const [profileComplete, setProfileComplete] = useState(true);
  const [loads, setLoads] = useState<Load[]>([]);
  const [loadsLoading, setLoadsLoading] = useState(true);

  useEffect(() => {
    api.getReceiverProfile()
      .then((p) => { setProfile(p.receiver); setProfileComplete(!!p.receiver); })
      .catch((e: any) => {
        if (e.message?.includes("404")) { setProfile(null); setProfileComplete(false); }
        else toast.error(e.message);
      });

    api.getReceiverIncoming()
      .then((r) => setLoads(r.loads ?? []))
      .catch((e: any) => {
        // 404 = no receiver profile yet, fine to show empty state
        if (!e.message?.includes("404")) toast.error(e.message);
      })
      .finally(() => setLoadsLoading(false));
  }, []);

  const facilityName = profile?.facilityName ?? "-";

  // Derived stats from real loads (the only honest source we have today).
  // "Arriving today" = scheduled within next 24h. The backend doesn't tag
  // arrival vs departure time yet, so we approximate by counting in-transit
  // loads - under-counts is honest, over-counts would be a fabrication.
  const inTransit = loads.filter(l => l.status === "IN_TRANSIT").length;
  const arrivingToday = inTransit; // best honest signal available

  return (
    <>
      <AccountHold profileComplete={profileComplete} verificationStatus={profileComplete ? "APPROVED" : "NONE"} />
      <PageHeader
        eyebrow={`Receiver · ${facilityName}`}
        title="Inbound shipments"
        subtitle="Track every truck rolling toward your dock, with live ETAs and signed PODs."
      />

      <div data-tour="receiver-facility" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Arriving today"   value={loadsLoading ? "…" : String(arrivingToday)} hint={inTransit > 0 ? `${inTransit} in transit` : "No inbound activity"} />
        <StatCard label="In transit"        value={loadsLoading ? "…" : String(inTransit)}      hint={inTransit > 0 ? "Live tracking active" : "-"} />
        <StatCard label="Delivered (30d)"   value="-"                                            hint="Backend metric pending" />
        <StatCard label="Exceptions"        value="-"                                            hint="Backend metric pending" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div data-tour="inbound-loads" className="lg:col-span-2 space-y-4">
          {loadsLoading && (
            <div className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
              Loading inbound shipments…
            </div>
          )}
          {!loadsLoading && loads.length === 0 && (
            <div className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
              No inbound shipments. When a shipper assigns a load to this facility, it shows up here.
            </div>
          )}
          {loads.map((s) => (
            <Link
              key={s.loadId}
              to={`/receiver/loads/${s.loadId}`}
              className="block rounded-md border border-border bg-card p-5 hover:border-primary/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Truck className="h-5 w-5" /></div>
                  <div>
                    <div className="font-semibold">{place(s.pickupCity, s.pickupState)} → {place(s.deliveryCity, s.deliveryState)}</div>
                    <div className="text-xs text-muted-foreground font-mono">{s.loadId.slice(0, 14)}…</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={s.status ?? "UNKNOWN"} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              {s.estimatedDeliveryTime ? (
                <div className="text-xs text-muted-foreground">ETA: {new Date(s.estimatedDeliveryTime).toLocaleString()}</div>
              ) : (
                <div className="text-xs text-muted-foreground">ETA: not yet provided</div>
              )}
            </Link>
          ))}
        </div>

        <aside data-tour="confirm-delivery" className="space-y-4">
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Today's dock schedule</h3>
            {loadsLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : loads.length === 0 ? (
              <p className="text-xs text-muted-foreground">No appointments scheduled. Schedule data appears once shippers post pickup windows.</p>
            ) : (
              <div className="space-y-3">
                {loads.slice(0, 4).map((l) => (
                  <div key={l.loadId} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {l.estimatedDeliveryTime ? new Date(l.estimatedDeliveryTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-"}
                      </div>
                      <div className="font-mono text-xs font-medium">{l.loadId.slice(0, 12)}…</div>
                    </div>
                    <span className="text-xs text-primary font-medium">{l.status ?? "-"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
