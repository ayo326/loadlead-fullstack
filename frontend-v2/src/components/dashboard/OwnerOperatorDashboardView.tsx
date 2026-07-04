/**
 * Owner Operator dashboard view (operator-scoped, blended).
 *
 * INDEPENDENT of the Carrier dashboard — separate component, separate code.
 * The two share only persona-NEUTRAL atoms from ./atoms (StatTile,
 * ConnectPlaceholder, VerificationBadge, LoadRow, ProgressBar). If you find
 * yourself adding a parent-type prop, split the component instead.
 *
 * Blended layout per spec §2:
 *  - "My haul" panel (OO-specific — they're driver AND dispatcher)
 *  - Verification (authority + identity, both gates)
 *  - Same categories as carrier: alerts, fleet, financial, loadboard, SLA —
 *    OWNED here, not imported from CarrierDashboardView.
 *
 * Same dispatcher/exec toggle as carrier: a solo OO lives in dispatcher; an
 * OO with a fleet may switch to exec.
 */
import React, { useEffect, useState } from "react";
import {
  AlertTriangle, Truck, Map, DollarSign, TrendingUp, Users, Shield,
  Activity, BarChart3, RefreshCw, UserCheck, Navigation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  StatTile, ConnectPlaceholder, VerificationBadge, LoadRow,
  isUnavailable,
} from "./atoms";

type View = "dispatcher" | "exec";

export function OwnerOperatorDashboardView({ hideLoadboard = false }: { hideLoadboard?: boolean } = {}) {
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<View>("dispatcher");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(refresh = false) {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const d = await api.getOoDashboard();
      setData(d);
    } catch (e: any) {
      toast.error(e.message ?? "Could not load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="py-12 flex justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Header + view toggle */}
      <div className="flex items-center justify-between">
        <div className="inline-flex border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setView("dispatcher")}
            className={`px-3 py-1.5 text-xs font-semibold ${view === "dispatcher" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
          >
            Dispatcher
          </button>
          <button
            onClick={() => setView("exec")}
            className={`px-3 py-1.5 text-xs font-semibold ${view === "exec" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
          >
            Exec
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* OO-specific: My haul (always visible) */}
      <MyHaulPanel myHaul={data.myHaul} />

      {/* OO-specific: Verification (both gates surfaced at top level) */}
      <VerificationPanel verification={data.verification} />

      {view === "dispatcher" ? <DispatcherView data={data} hideLoadboard={hideLoadboard} /> : <ExecView data={data} />}
    </div>
  );
}

// ── My haul (OO-only blended panel) ────────────────────────────────────────
function MyHaulPanel({ myHaul }: { myHaul: any }) {
  return (
    <Section title="My haul" icon={Navigation}>
      {!myHaul
        ? <p className="text-sm text-muted-foreground">You don't have an active load. New tendered offers appear on the loadboard below.</p>
        : (
          <div className="grid md:grid-cols-3 gap-3">
            <StatTile
              label="Status"
              value={<span className="text-sm font-semibold">{myHaul.status}</span>}
            />
            <StatTile label="Route" value={
              <span className="text-sm font-semibold">{myHaul.pickup.city}, {myHaul.pickup.state} → {myHaul.delivery.city}, {myHaul.delivery.state}</span>
            } />
            <StatTile label="Pay" value={`$${myHaul.rate?.toLocaleString() ?? "—"}`} icon={DollarSign} tone="good" />
          </div>
        )}
    </Section>
  );
}

// ── Two-gate verification (OO-only at top level) ────────────────────────────
function VerificationPanel({ verification }: { verification: any }) {
  const a = verification.authority;
  const i = verification.identity;
  return (
    <Section title="My verification (both gates required to accept loads)" icon={Shield}>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Carrier authority (FMCSA + KYB)</p>
          <VerificationBadge status={a.verificationCurrent ? "VERIFIED" : "PENDING"} />
          <p className="text-xs text-muted-foreground mt-2">
            {a.daysToExpiry == null ? "No expiry on file" : a.daysToExpiry > 0 ? `Re-verify in ${a.daysToExpiry} days` : "Re-verification overdue"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Personal identity (IDV)</p>
          <VerificationBadge status={i.status} />
          <p className="text-xs text-muted-foreground mt-2">
            {i.daysToExpiry == null ? "Complete identity verification in Settings" : `Re-verify in ${i.daysToExpiry} days`}
          </p>
        </div>
      </div>
    </Section>
  );
}

// ── Dispatcher view ────────────────────────────────────────────────────────
function DispatcherView({ data, hideLoadboard = false }: { data: any; hideLoadboard?: boolean }) {
  const a = data.alerts;
  const f = data.fleet;
  const lb = data.loadboard;

  return (
    <div className="space-y-5">
      <Section title="Alerts" icon={AlertTriangle}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StatTile label="Booked"     value={a.activeLoads.booked} icon={Truck} />
          <StatTile label="Dispatched" value={a.activeLoads.dispatched} icon={Truck} />
          <StatTile label="In Transit" value={a.activeLoads.inTransit} icon={Activity} />
          <StatTile label="At Pickup"  value={a.activeLoads.atPickup} icon={Map} />
          <StatTile label="Delivered"  value={a.activeLoads.delivered} icon={Truck} tone="good" />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Subsection title={`Unassigned (${a.unassigned.length})`}>
            {a.unassigned.length === 0
              ? <Empty text="All loads have a driver." />
              : a.unassigned.slice(0, 5).map((l: any) => <LoadRow key={l.loadId} data={l} />)}
          </Subsection>
          <Subsection title={`ETA at risk (${a.etaAtRisk.length})`}>
            {a.etaAtRisk.length === 0
              ? <Empty text="No loads running late." />
              : a.etaAtRisk.slice(0, 5).map((r: any) => (
                  <div key={r.loadId} className="px-3 py-2 border-b border-border last:border-0">
                    <p className="text-sm">{r.loadId.slice(-8)}</p>
                    <p className="text-xs text-red-600">{r.minutesLate} min late</p>
                  </div>
                ))}
          </Subsection>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatTile label="HOS warnings"     value={isUnavailable(a.hosWarnings) ? <ConnectPlaceholder what="ELD" reason={a.hosWarnings.reason} /> : a.hosWarnings} />
          <StatTile label="Reefer deviations" value={isUnavailable(a.reeferDeviations) ? <ConnectPlaceholder what="reefer telemetry" reason={a.reeferDeviations.reason} /> : a.reeferDeviations} />
        </div>
      </Section>

      <Section title="Fleet & compliance" icon={Users}>
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <StatTile label="Drivers"  value={f.drivers.length} icon={Users} hint={`${f.drivers.filter((d: any) => d.isSelf).length} self · ${f.drivers.filter((d: any) => !d.isSelf).length} fleet`} />
          <StatTile label="Verified" value={f.onboarding.verified} icon={UserCheck} tone="good" />
          <StatTile label="Blocked"  value={f.onboarding.blocked}  icon={AlertTriangle} tone={f.onboarding.blocked > 0 ? "bad" : "default"} />
        </div>
        <div className="rounded-xl border border-border bg-card">
          {f.drivers.length === 0
            ? <Empty text="No drivers yet." />
            : f.drivers.slice(0, 8).map((d: any) => (
                <div key={d.driverId} className="px-3 py-2.5 flex items-center justify-between border-b border-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    {d.isSelf && <p className="text-[10px] text-muted-foreground">self-driver (non-removable)</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <VerificationBadge status={d.idvStatus} />
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${d.availability === "free" ? "bg-secondary text-muted-foreground" : "bg-blue-100 text-blue-700"}`}>
                      {d.availability}
                    </span>
                  </div>
                </div>
              ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatTile label="Insurance"        value={isUnavailable(f.insurance) ? <ConnectPlaceholder what="COI" reason={f.insurance.reason} /> : f.insurance} />
          <StatTile label="HOS remaining"    value={isUnavailable(f.hosRemaining) ? <ConnectPlaceholder what="ELD" reason={f.hosRemaining.reason} /> : f.hosRemaining} />
          <StatTile label="Equipment health" value={isUnavailable(f.equipmentHealth) ? <ConnectPlaceholder what="telematics" reason={f.equipmentHealth.reason} /> : f.equipmentHealth} />
        </div>
      </Section>

      {/* V3: when the page renders the single "Available Loads" board above,
          suppress this duplicate tendered list (one loadboard, one truth). The
          Dwell/Deadhead metrics are retained either way (nothing deleted). */}
      <Section title={hideLoadboard ? "Loadboard metrics" : "Tendered loadboard (self + fleet)"} icon={Map}>
        {!hideLoadboard && (
          <div className="rounded-xl border border-border bg-card">
            {lb.tendered.length === 0
              ? <Empty text="No outstanding offers." />
              : lb.tendered.slice(0, 10).map((t: any) => (
                  <LoadRow key={t.loadId + t.driverId} data={t} right={
                    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${t.acceptAs === "self" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                      {t.acceptAs === "self" ? "Accept as self" : "Accept as fleet"}
                    </span>
                  } />
                ))}
          </div>
        )}
        <div className={`grid grid-cols-2 gap-3 ${hideLoadboard ? "" : "mt-3"}`}>
          <StatTile label="Dwell"    value={isUnavailable(lb.dwell)    ? <ConnectPlaceholder what="timestamps" reason={lb.dwell.reason} /> : lb.dwell} />
          <StatTile label="Deadhead" value={isUnavailable(lb.deadhead) ? <ConnectPlaceholder what="last-drop data" reason={lb.deadhead.reason} /> : lb.deadhead} />
        </div>
      </Section>
    </div>
  );
}

// ── Exec view ──────────────────────────────────────────────────────────────
function ExecView({ data }: { data: any }) {
  const fin = data.financial;
  const sla = data.sla;
  const fmt = (n?: number | null) => n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
  const pct = (n?: number | null) => n == null ? "—" : `${Math.round(n * 100)}%`;

  return (
    <div className="space-y-5">
      <Section title="Financial" icon={DollarSign}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatTile label="Gross / week"  value={fmt(fin.grossRevenue.week)}  icon={DollarSign} tone="good" />
          <StatTile label="Gross / month" value={fmt(fin.grossRevenue.month)} icon={DollarSign} tone="good" />
          <StatTile label="Avg $/mi"      value={fin.rpm.avg == null ? "—" : `$${fin.rpm.avg.toFixed(2)}`} icon={TrendingUp} />
          <StatTile label="Loads w/ RPM"  value={fin.rpm.byLoad.length} icon={BarChart3} />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatTile label="Paid to operator" value={fmt(fin.payeeBreakdown.carrier)} icon={DollarSign} />
          <StatTile label="Paid to factor"   value={fmt(fin.payeeBreakdown.factor)}  icon={DollarSign} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatTile label="Factoring submitted" value={fin.factoringPipeline.submitted} />
          <StatTile label="Approved" value={isUnavailable(fin.factoringPipeline.approved) ? <ConnectPlaceholder what="partner callbacks" reason={fin.factoringPipeline.approved.reason} /> : fin.factoringPipeline.approved} />
          <StatTile label="Funded"   value={isUnavailable(fin.factoringPipeline.funded)   ? <ConnectPlaceholder what="partner callbacks" reason={fin.factoringPipeline.funded.reason} />   : fin.factoringPipeline.funded} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatTile label="Fuel spend" value={isUnavailable(fin.fuelSpend) ? <ConnectPlaceholder what="fuel card" reason={fin.fuelSpend.reason} /> : fin.fuelSpend} />
          <StatTile label="Tolls"      value={isUnavailable(fin.tolls)     ? <ConnectPlaceholder what="fuel card" reason={fin.tolls.reason} />     : fin.tolls} />
        </div>
      </Section>

      <Section title="SLA & acceptance" icon={Shield}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="On-time pickup"
            value={isUnavailable(sla.otp.pickupPct) ? <ConnectPlaceholder what="timestamps" reason={sla.otp.pickupPct.reason} /> : pct(sla.otp.pickupPct)}
          />
          <StatTile
            label="On-time delivery"
            value={isUnavailable(sla.otp.deliveryPct) ? <ConnectPlaceholder what="timestamps" reason={sla.otp.deliveryPct.reason} /> : pct(sla.otp.deliveryPct)}
          />
          <StatTile label="Acceptance rate" value={pct(sla.acceptance.acceptanceRate)} />
          <StatTile label="Rejection rate"  value={pct(sla.acceptance.rejectionRate)}  tone={sla.acceptance.rejectionRate && sla.acceptance.rejectionRate > 0.3 ? "warn" : "default"} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatTile
            label="Authority"
            value={sla.compliancePosture.authorityActive === null ? "—" : (sla.compliancePosture.authorityActive ? "Active" : "Inactive")}
            tone={sla.compliancePosture.authorityActive ? "good" : (sla.compliancePosture.authorityActive === false ? "bad" : "default")}
          />
          <StatTile
            label="CSA scores"
            value={isUnavailable(sla.csaScores) ? <ConnectPlaceholder what="FMCSA SMS" reason={sla.csaScores.reason} /> : sla.csaScores}
          />
        </div>
      </Section>
    </div>
  );
}

// ── Local layout helpers ───────────────────────────────────────────────────
function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-5">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  );
}
function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="px-3 py-6 text-xs text-center text-muted-foreground">{text}</p>;
}
