import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Shield, Users } from "lucide-react";
import { PageHeader, StatCard, StatusPill } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminDrivers, adminMetrics } from "@/lib/mockData";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── Buffer manager panel ────────────────────────────────────────────────────

function BufferManager({ driverId, driverName }: { driverId: string; driverName: string }) {
  const [pct, setPct] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(pct);
    if (n < 5 || n > 25) { toast.error("Buffer must be between 5% and 25%."); return; }
    setSaving(true);
    try {
      const r = await api.adminSetDriverBuffer(driverId, n);
      toast.success(r.message);
      if (r.overBuffer) toast.warning(r.alert ?? "Driver is now Over Buffer.");
      setPct("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={5}
        max={25}
        placeholder="5–25%"
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        className="w-24 h-8 text-xs"
      />
      <Button size="sm" variant="outline" disabled={saving || !pct} onClick={save} className="h-8 text-xs">
        Set buffer
      </Button>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <>
      <PageHeader
        eyebrow="Admin · Platform"
        title="Operations console"
        subtitle="Real-time view of users, loads, and match quality across the network."
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="Active loads" value={String(adminMetrics.activeLoads)} hint="+18 today" trend="up" />
        <StatCard label="Active drivers" value={String(adminMetrics.activeDrivers)} hint="74% online" trend="up" />
        <StatCard label="Match rate" value={`${adminMetrics.matchRate}%`} hint="vs 78% market avg" trend="up" />
        <StatCard label="Avg time to match" value={`${adminMetrics.avgTimeToMatch}s`} hint="-12s WoW" trend="up" />
        <StatCard label="GMV this week" value={`$${(adminMetrics.weeklyGmv / 1000).toFixed(0)}k`} hint="+9% WoW" trend="up" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Driver roster</h2></div>
            <span className="text-xs text-muted-foreground">{adminDrivers.length} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
                  <th className="px-5 py-3 font-medium">Driver</th>
                  <th className="px-5 py-3 font-medium">Equipment</th>
                  <th className="px-5 py-3 font-medium">Capacity</th>
                  <th className="px-5 py-3 font-medium">Buffer</th>
                  <th className="px-5 py-3 font-medium">Location</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {adminDrivers.map((d) => {
                  const bufPct: number = (d as any).safetyBufferPct ?? 10;
                  const maxOp = d.maxCapacityLbs * (1 - bufPct / 100);
                  const used = Math.min(100, Math.round((d.currentLoadLbs / maxOp) * 100));
                  const overBuffer = (d as any).overBufferFlag ?? false;
                  return (
                    <tr key={d.id} className={`border-t border-border hover:bg-secondary/40 ${overBuffer ? "bg-destructive/5" : ""}`}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground flex items-center justify-center text-xs font-semibold">
                            {d.name.split(" ").map((n: string) => n[0]).join("")}
                          </div>
                          <div>
                            <div className="font-medium flex items-center gap-1.5">
                              {d.name}
                              {overBuffer && <span className="text-[10px] font-bold text-destructive bg-destructive/10 rounded px-1">OVER BUFFER</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">{d.mcNumber}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{d.equipment.replace("_", " ")}</td>
                      <td className="px-5 py-4">
                        <div className="w-28 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className={`h-full ${used >= 100 ? "bg-destructive" : used >= 90 ? "bg-warning" : "bg-primary"}`} style={{ width: `${used}%` }} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {(d.currentLoadLbs / 1000).toFixed(1)}k / {(maxOp / 1000).toFixed(0)}k op. lbs
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <BufferManager driverId={d.id} driverName={d.name} />
                        <p className="text-xs text-muted-foreground mt-1">Current: {bufPct}%</p>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{d.location}</td>
                      <td className="px-5 py-4"><StatusPill status={d.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-2 text-sm font-semibold mb-4"><Activity className="h-4 w-4 text-primary" /> Live activity</div>
            <div className="space-y-3 text-sm">
              {[
                { i: CheckCircle2, c: "text-success", t: "L-10421 accepted by Marcus T.", s: "2s ago" },
                { i: Activity, c: "text-primary", t: "Broadcast: 8 drivers notified", s: "14s ago" },
                { i: AlertTriangle, c: "text-warning", t: "L-10398 offer expired (no accept)", s: "1m ago" },
                { i: CheckCircle2, c: "text-success", t: "Driver D-004 came online", s: "3m ago" },
              ].map((e, i) => (
                <div key={i} className="flex items-start gap-3">
                  <e.i className={`h-4 w-4 mt-0.5 ${e.c}`} />
                  <div className="flex-1">
                    <div>{e.t}</div>
                    <div className="text-xs text-muted-foreground">{e.s}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <div className="text-sm font-semibold mb-4">Compliance health</div>
            <Bar label="Insurance current" value={96} />
            <Bar label="MC maturity ≥ 6mo" value={88} />
            <Bar label="Profile complete" value={92} />
          </div>
        </aside>
      </div>
    </>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}