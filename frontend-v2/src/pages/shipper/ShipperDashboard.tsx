import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, PackagePlus, Search, TrendingUp, X } from "lucide-react";
import { PageHeader, StatCard, StatusPill } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountHold } from "@/components/AccountHold";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function ShipperDashboard() {
  const { user } = useAuth();
  const [loads, setLoads] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [profileComplete, setProfileComplete] = useState(true);
  // D1/V7: the "Match velocity" widget renders ONLY when real data is present.
  // There is no match-velocity endpoint yet, so this stays null and the widget
  // does not render - no fabricated bars or stat. The component is retained so
  // it lights up the moment a real endpoint feeds these two values.
  const [matchVelocity] = useState<{ label: string; pct: number }[] | null>(null);
  const [avgMatchSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    Promise.all([
      api.getShipperLoads(),
      api.getShipperProfile().catch((e: any) => {
        if (e.message?.includes("404")) return { shipper: null };
        throw e;
      }),
    ])
      .then(([l, p]) => {
        setLoads(l.loads ?? []);
        setProfile(p.shipper);
        setProfileComplete(!!p.shipper);
      })
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const open = loads.filter((l) => l.status === "OPEN").length;
  const booked = loads.filter((l) => l.status === "BOOKED").length;
  const inTransit = loads.filter((l) => l.status === "IN_TRANSIT").length;

  const filteredLoads = loads.filter((l) => {
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [l.pickupCity, l.deliveryCity, l.referenceNumber, l.commodityDescription]
        .some((f: string) => f?.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <>
      <AccountHold profileComplete={profileComplete} verificationStatus={profileComplete ? "APPROVED" : "NONE"} />
      <PageHeader
        eyebrow={`Shipper · ${profile?.companyName ?? user?.email ?? "—"}`}
        title="Your loads"
        subtitle="Post a load and we'll broadcast it to qualified drivers in your radius the moment you submit."
        actions={
          <Button asChild className="h-10" disabled={!profileComplete}>
            <Link data-tour="shipper-post-cta" to="/shipper/post"><PackagePlus className="h-4 w-4" /> Post a load</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total loads" value={String(loads.length)} hint="all time" />
        <StatCard label="Open / broadcasting" value={String(open)} hint="awaiting driver" />
        <StatCard label="Booked" value={String(booked)} hint="driver assigned" trend="up" />
        <StatCard label="In transit" value={String(inTransit)} hint="on the road" trend="up" />
      </div>

      <div data-tour="shipper-tracking" className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold">All loads</h2>
            <p className="text-xs text-muted-foreground">Click a load to see details.</p>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="City, reference…" className="pl-8 h-8 text-xs w-44" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="h-3 w-3 text-muted-foreground" /></button>}
          </div>
          {/* Status filter */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 pr-6 appearance-none cursor-pointer">
            <option value="">All statuses</option>
            {["DRAFT","OPEN","OFFERED","BOOKED","IN_TRANSIT","DELIVERED","CANCELLED"].map((s) => (
              <option key={s} value={s}>{s.replace("_"," ")}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
                <th className="px-5 py-3 font-medium">Reference</th>
                <th className="px-5 py-3 font-medium">Lane</th>
                <th className="px-5 py-3 font-medium">Pickup</th>
                <th className="px-5 py-3 font-medium">Driver</th>
                <th className="px-5 py-3 font-medium text-right">Rate</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredLoads.map((l) => {
                const total = l.rateType === "PER_MILE"
                  ? (l.totalMiles * l.rateAmount).toFixed(0)
                  : l.rateAmount.toFixed(0);
                return (
                  <tr key={l.loadId} className="border-t border-border hover:bg-secondary/40">
                    <td className="px-5 py-4 font-mono text-xs text-muted-foreground">{l.referenceNumber}</td>
                    <td className="px-5 py-4">
                      <div className="font-medium">{l.pickupCity}, {l.pickupState} → {l.deliveryCity}, {l.deliveryState}</div>
                      <div className="text-xs text-muted-foreground">{l.totalMiles} mi · {l.equipmentType?.replace("_", " ")}</div>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{l.pickupTime}</td>
                    <td className="px-5 py-4">
                      {l.assignedDriverId
                        ? <span className="font-medium text-success">Assigned</span>
                        : <span className="text-muted-foreground italic">— broadcasting —</span>}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold">${Number(total).toLocaleString()}</td>
                    <td className="px-5 py-4"><StatusPill status={l.status} /></td>
                    <td className="px-5 py-4">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/shipper/loads/${l.loadId}`}>View <ArrowRight className="h-3.5 w-3.5" /></Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredLoads.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-sm">No loads yet — post your first one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Match velocity - rendered only with real data (D1/V7). No fabricated
          bars or average. Wire matchVelocity + avgMatchSeconds to a real
          endpoint to light this up. */}
      {matchVelocity && matchVelocity.length > 0 && (
        <div className="mt-6 rounded-md border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" /> Match velocity (7 days)</div>
          <div className="mt-6 flex items-end gap-2 h-40">
            {matchVelocity.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full rounded-t-md bg-primary" style={{ height: `${d.pct}%` }} />
                <div className="text-[10px] text-muted-foreground">{d.label}</div>
              </div>
            ))}
          </div>
          {avgMatchSeconds != null && (
            <div className="mt-4 text-xs text-muted-foreground">Average match: <span className="font-semibold text-foreground">{avgMatchSeconds}s</span></div>
          )}
        </div>
      )}
    </>
  );
}
