import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Package, Truck } from "lucide-react";
import { PageHeader, StatCard, StatusPill } from "@/components/PageHeader";
import { AccountHold } from "@/components/AccountHold";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { receiverShipments } from "@/lib/mockData";

export default function ReceiverDashboard() {
  const [profile, setProfile] = useState<any>(null);
  const [profileComplete, setProfileComplete] = useState(true);

  useEffect(() => {
    api.getReceiverProfile()
      .then((p) => { setProfile(p.receiver); setProfileComplete(!!p.receiver); })
      .catch((e: any) => {
        if (e.message?.includes("404")) { setProfile(null); setProfileComplete(false); }
        else toast.error(e.message);
      });
  }, []);

  const facilityName = profile?.facilityName ?? "Phoenix Distribution";

  return (
    <>
      <AccountHold profileComplete={profileComplete} verificationStatus={profileComplete ? "APPROVED" : "NONE"} />
      <PageHeader
        eyebrow={`Receiver · ${facilityName}`}
        title="Inbound shipments"
        subtitle="Track every truck rolling toward your dock, with live ETAs and signed PODs."
      />

      <div data-tour="receiver-facility" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Arriving today" value="6" hint="3 within 2 hrs" />
        <StatCard label="In transit" value="14" hint="Across 9 lanes" />
        <StatCard label="Delivered (30d)" value="284" hint="98.6% on time" trend="up" />
        <StatCard label="Exceptions" value="2" hint="Open · needs review" trend="down" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div data-tour="inbound-loads" className="lg:col-span-2 space-y-4">
          {receiverShipments.map((s) => (
            <Link
              key={s.id}
              to={`/receiver/loads/${s.id}`}
              className="block rounded-md border border-border bg-card p-5 hover:border-primary/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Truck className="h-5 w-5" /></div>
                  <div>
                    <div className="font-semibold">{s.origin} → {s.destination}</div>
                    <div className="text-xs text-muted-foreground">{s.id} · {s.shipper} · Driver {s.driver}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={s.status} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              {s.status === "IN_TRANSIT" ? (
                <>
                  <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-primary rounded-sm" style={{ width: "72%" }} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs">
                    <span className="text-muted-foreground">{s.origin}</span>
                    <span className="font-medium text-foreground">72% · ETA 6:15 PM</span>
                    <span className="text-muted-foreground">{s.destination}</span>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">{s.pickupAt}</div>
              )}
            </Link>
          ))}
        </div>

        <aside data-tour="confirm-delivery" className="space-y-4">
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Today's dock schedule</h3>
            <div className="space-y-3">
              {[
                { t: "10:00 AM", id: "L-10398", st: "Checked in" },
                { t: "1:30 PM", id: "L-10402", st: "On time" },
                { t: "4:00 PM", id: "L-10410", st: "In transit" },
                { t: "6:15 PM", id: "L-10421", st: "Inbound" },
              ].map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{d.t}</div>
                    <div className="font-medium">{d.id}</div>
                  </div>
                  <span className="text-xs text-primary font-medium">{d.st}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
