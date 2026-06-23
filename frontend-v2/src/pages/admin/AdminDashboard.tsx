import { useEffect, useState, useCallback } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Shield, Users,
  Clock, TruckIcon, XCircle, RefreshCw, ChevronDown, ChevronUp,
  Building2, Loader2,
} from "lucide-react";
import { PageHeader, StatCard, StatusPill } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrgManagementPanel } from "@/components/admin/OrgManagementPanel";
import { FleetFeed } from "@/components/admin/FleetFeed";
import { SupportInbox } from "@/components/admin/SupportInbox";
import { SupportChannels } from "@/components/admin/SupportChannels";
import { Badge } from "@/components/ui/badge";
import { FleetMap } from "@/components/FleetMap";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Driver {
  driverId: string;
  userId: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  status: string;
  trailerType?: string;
  maxCapacityLbs?: number;
  currentLoadLbs?: number;
  safetyBufferPct?: number;
  overBufferFlag?: boolean;
  cargoInsuranceAmount?: number;
  liabilityInsuranceAmount?: number;
  mcNumber?: string;
  dotNumber?: string;
  currentCity?: string;
  currentState?: string;
  currentLat?: number;
  currentLng?: number;
  createdAt?: number;
}

// ─── Buffer Manager ───────────────────────────────────────────────────────────

function BufferManager({ driverId, current }: { driverId: string; current: number }) {
  const [pct, setPct] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(pct);
    if (n < 5 || n > 25) { toast.error("Buffer must be 5–25%."); return; }
    setSaving(true);
    try {
      const r = await api.adminSetDriverBuffer(driverId, n);
      toast.success(r.message ?? `Buffer set to ${n}%`);
      if (r.overBuffer) toast.warning(r.alert ?? "Driver is now over buffer.");
      setPct("");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <Input type="number" min={5} max={25} placeholder="5–25"
        value={pct} onChange={e => setPct(e.target.value)}
        className="w-20 h-8 text-xs" />
      <Button size="sm" variant="outline" disabled={saving || !pct} onClick={save} className="h-8 text-xs">
        Set
      </Button>
      <span className="text-xs text-muted-foreground">({current}%)</span>
    </div>
  );
}

// ─── Driver Row ───────────────────────────────────────────────────────────────

function DriverRow({ driver, onAction }: { driver: Driver; onAction: () => void }) {
  const [acting, setActing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const name = driver.fullName
    || [driver.firstName, driver.lastName].filter(Boolean).join(" ")
    || driver.driverId;

  const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  const bufPct = driver.safetyBufferPct ?? 10;
  const maxOp = (driver.maxCapacityLbs ?? 0) * (1 - bufPct / 100);
  const used = maxOp > 0 ? Math.min(100, Math.round(((driver.currentLoadLbs ?? 0) / maxOp) * 100)) : 0;
  const location = [driver.currentCity, driver.currentState].filter(Boolean).join(", ") || "—";
  const hasLocation = (driver.currentLat ?? 0) !== 0;
  const hasInsurance = (driver.cargoInsuranceAmount ?? 0) > 0;
  const isPending = driver.status === "PENDING_VERIFICATION";

  const verify = async () => {
    setActing(true);
    try {
      await api.adminVerifyDriver(driver.driverId);
      toast.success(`${name} verified successfully`);
      onAction();
    } catch (e: any) { toast.error(e.message); }
    finally { setActing(false); }
  };

  const suspend = async () => {
    setActing(true);
    try {
      await api.adminSuspendDriver(driver.driverId);
      toast.success(`${name} suspended`);
      onAction();
    } catch (e: any) { toast.error(e.message); }
    finally { setActing(false); }
  };

  return (
    <>
      <tr
        className={`border-t border-border transition-colors cursor-pointer ${
          driver.overBufferFlag ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-secondary/40"
        }`}
        onClick={() => setExpanded(x => !x)}
      >
        {/* Driver name */}
        <td className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-secondary text-primary flex items-center justify-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="font-medium flex items-center gap-1.5 flex-wrap">
                {name}
                {driver.overBufferFlag && (
                  <span className="text-[10px] font-bold text-destructive bg-destructive/10 rounded px-1">OVER BUFFER</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{driver.mcNumber ?? "—"}</div>
            </div>
          </div>
        </td>

        {/* Equipment */}
        <td className="px-5 py-4 text-sm text-muted-foreground whitespace-nowrap">
          {driver.trailerType?.replace(/_/g, " ") ?? "—"}
        </td>

        {/* Capacity bar */}
        <td className="px-5 py-4">
          <div className="w-28">
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full transition-all ${used >= 100 ? "bg-destructive" : used >= 90 ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${used}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {((driver.currentLoadLbs ?? 0) / 1000).toFixed(1)}k / {(maxOp / 1000).toFixed(0)}k lbs
            </div>
          </div>
        </td>

        {/* Buffer */}
        <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
          <BufferManager driverId={driver.driverId} current={bufPct} />
        </td>

        {/* Location */}
        <td className="px-5 py-4 text-sm">
          <span className={hasLocation ? "text-foreground" : "text-muted-foreground"}>{location}</span>
        </td>

        {/* Status + actions */}
        <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={driver.status} />
            {isPending && (
              <Button size="sm" variant="default" disabled={acting} onClick={verify}
                className="h-7 text-xs px-2 bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Verify
              </Button>
            )}
            {!isPending && driver.status !== "SUSPENDED" && (
              <Button size="sm" variant="ghost" disabled={acting} onClick={suspend}
                className="h-7 text-xs px-2 text-destructive hover:bg-destructive/10">
                <XCircle className="h-3 w-3 mr-1" /> Suspend
              </Button>
            )}
          </div>
        </td>

        {/* Expand toggle */}
        <td className="px-3 py-4 text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="bg-secondary/20 border-t border-dashed border-border">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <Detail label="Driver ID" value={driver.driverId} mono />
              <Detail label="DOT #" value={driver.dotNumber ?? "—"} />
              <Detail label="Cargo insurance" value={hasInsurance ? `$${(driver.cargoInsuranceAmount!).toLocaleString()}` : "⚠ $0 — will be excluded from broadcasts"} warn={!hasInsurance} />
              <Detail label="Liability insurance" value={(driver.liabilityInsuranceAmount ?? 0) > 0 ? `$${driver.liabilityInsuranceAmount!.toLocaleString()}` : "⚠ $0"} warn={(driver.liabilityInsuranceAmount ?? 0) === 0} />
              <Detail label="Location set" value={hasLocation ? `${driver.currentLat?.toFixed(4)}, ${driver.currentLng?.toFixed(4)}` : "⚠ No location — geo filter will exclude"} warn={!hasLocation} />
              <Detail label="Trailer" value={driver.trailerType ?? "⚠ Not set"} warn={!driver.trailerType} />
              <Detail label="Max capacity" value={driver.maxCapacityLbs ? `${driver.maxCapacityLbs.toLocaleString()} lbs` : "—"} />
              <Detail label="Member since" value={driver.createdAt ? new Date(driver.createdAt).toLocaleDateString() : "—"} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value, mono, warn }: { label: string; value: string; mono?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-xs font-medium ${mono ? "font-mono" : ""} ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const STATUS_TABS = ["PENDING_VERIFICATION", "VERIFIED", "AVAILABLE", "SUSPENDED"] as const;
type StatusTab = typeof STATUS_TABS[number];

export default function AdminDashboard() {
  const [tab, setTab] = useState<StatusTab>("PENDING_VERIFICATION");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      // Load all tab counts in parallel, plus current tab drivers
      const [pending, verified, available, suspended, current] = await Promise.all([
        api.getAdminDrivers("PENDING_VERIFICATION"),
        api.getAdminDrivers("VERIFIED"),
        api.getAdminDrivers("AVAILABLE"),
        api.getAdminDrivers("SUSPENDED"),
        api.getAdminDrivers(tab),
      ]);
      setCounts({
        PENDING_VERIFICATION: pending.drivers.length,
        VERIFIED: verified.drivers.length,
        AVAILABLE: available.drivers.length,
        SUSPENDED: suspended.drivers.length,
      });
      setDrivers(current.drivers);
      setAllDrivers([
        ...pending.drivers,
        ...verified.drivers,
        ...available.drivers,
        ...suspended.drivers,
      ]);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load drivers");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const TAB_LABELS: Record<StatusTab, string> = {
    PENDING_VERIFICATION: "Pending",
    VERIFIED: "Verified",
    AVAILABLE: "Available",
    SUSPENDED: "Suspended",
  };

  const TAB_COLORS: Record<StatusTab, string> = {
    PENDING_VERIFICATION: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    VERIFIED: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    AVAILABLE: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
    SUSPENDED: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Platform"
        title="Operations console"
        subtitle="Real-time view of drivers, loads, and match quality across the network."
      />

      {/* Live fleet map */}
      <div className="rounded-md border border-border bg-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Live fleet map</h2>
            <p className="text-xs text-muted-foreground">Every driver's last known location, colored by status.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <FleetMap drivers={allDrivers} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Pending verification" value={String(counts.PENDING_VERIFICATION ?? "—")}
          hint={counts.PENDING_VERIFICATION > 0 ? "Needs review" : "All clear"} trend={counts.PENDING_VERIFICATION > 0 ? "down" : "up"} />
        <StatCard label="Available drivers" value={String(counts.AVAILABLE ?? "—")} hint="Ready for loads" trend="up" />
        <StatCard label="Verified" value={String(counts.VERIFIED ?? "—")} hint="Awaiting activation" trend="up" />
        <StatCard label="Suspended" value={String(counts.SUSPENDED ?? "—")} hint="Inactive" trend="down" />
      </div>

      {/* Phase 4: chat + click-to-call vendor embeds */}
      <SupportChannels />

      {/* Phase 3: Support inbox -- inbound + outbound via Resend, SLA monitor */}
      <SupportInbox />

      {/* Phase 2: Live fleet feed (telematics-gated; no fabricated GPS) */}
      <FleetFeed />

      {/* Platform IAM overrides: list / suspend / reinstate / revoke-admin */}
      <OrgManagementPanel />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Driver roster */}
        <div className="lg:col-span-2 rounded-md border border-border bg-card overflow-hidden">
          {/* Header + tabs */}
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Driver roster</h2>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={refreshing}
                onClick={() => load(true)}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {/* Status tabs */}
            <div className="flex gap-1.5 flex-wrap">
              {STATUS_TABS.map(s => (
                <button
                  key={s}
                  onClick={() => setTab(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    tab === s
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {TAB_LABELS[s]}
                  {counts[s] !== undefined && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${TAB_COLORS[s]}`}>
                      {counts[s]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading drivers…
            </div>
          ) : drivers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <TruckIcon className="h-8 w-8 opacity-30" />
              <p className="text-sm">No drivers with status <strong>{tab.replace(/_/g, " ")}</strong></p>
            </div>
          ) : (
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
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {drivers.map(d => (
                    <DriverRow key={d.driverId} driver={d} onAction={() => load(true)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Compliance health */}
          <div className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold mb-4">
              <Shield className="h-4 w-4 text-primary" /> Compliance health
            </div>
            <ComplianceBar label="Insurance set" drivers={drivers} check={d => (d.cargoInsuranceAmount ?? 0) > 0} />
            <ComplianceBar label="Trailer type set" drivers={drivers} check={d => !!d.trailerType} />
            <ComplianceBar label="Location set" drivers={drivers} check={d => (d.currentLat ?? 0) !== 0} />
            <ComplianceBar label="Has MC number" drivers={drivers} check={d => !!d.mcNumber} />
          </div>

          {/* Legend */}
          <div className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold mb-4">
              <Activity className="h-4 w-4 text-primary" /> Status guide
            </div>
            <div className="space-y-3 text-xs text-muted-foreground">
              {[
                { icon: Clock, color: "text-amber-500", label: "PENDING_VERIFICATION", desc: "Driver signed up, awaiting admin review. Click Verify to approve." },
                { icon: CheckCircle2, color: "text-blue-500", label: "VERIFIED", desc: "Approved by admin. Driver must set location to become AVAILABLE." },
                { icon: TruckIcon, color: "text-green-500", label: "AVAILABLE", desc: "Online and receiving load offers via broadcast." },
                { icon: XCircle, color: "text-red-500", label: "SUSPENDED", desc: "Account suspended. No load offers will be sent." },
              ].map(({ icon: Icon, color, label, desc }) => (
                <div key={label} className="flex gap-2">
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color}`} />
                  <div>
                    <div className="font-semibold text-foreground">{label.replace(/_/g, " ")}</div>
                    <div>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning card if pending > 0 */}
          {(counts.PENDING_VERIFICATION ?? 0) > 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2">
                <AlertTriangle className="h-4 w-4" />
                {counts.PENDING_VERIFICATION} driver{counts.PENDING_VERIFICATION > 1 ? "s" : ""} pending
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Click a driver row to expand details, then use the <strong>Verify</strong> button to approve them.
                Unverified drivers cannot receive load offers.
              </p>
              <Button size="sm" variant="outline"
                className="mt-3 h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={() => setTab("PENDING_VERIFICATION")}>
                Review pending drivers
              </Button>
            </div>
          )}
        </aside>
      </div>

      {/* ── Organisations ─────────────────────────────────────── */}
      <OrgManagementPanel />
    </>
  );
}

// ─── Org management panel (Platform Admin only) ───────────────────────────────

function OrgManagementPanel() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // We fetch each user's orgs; for admin we need a different approach.
    // For now we try to list all orgs for the admin user (who may belong to none),
    // and fall back to empty with an explanation.
    try {
      const { orgs: list } = await api.getMyOrgs();
      setOrgs(list);
    } catch {
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSuspend(orgId: string, currentlySuspended: boolean) {
    const reason = currentlySuspended
      ? undefined
      : prompt("Reason for suspension (optional):");
    if (!currentlySuspended && reason === null) return; // cancelled
    setActing(orgId);
    try {
      if (currentlySuspended) {
        await api.reinstateOrg(orgId);
        toast.success("Organisation reinstated");
      } else {
        await api.suspendOrg(orgId, reason ?? "");
        toast.success("Organisation suspended");
      }
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="mt-8 rounded-md border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Building2 className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Organisations</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Platform Admin can suspend / reinstate any org
        </span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading organisations…
        </div>
      ) : orgs.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          No organisations visible. To list all orgs, a <code className="text-xs bg-secondary px-1 rounded">GET /api/admin/orgs</code> endpoint is needed (future work).
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Organisation</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Capabilities</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orgs.map(org => (
              <tr key={org.orgId} className={`hover:bg-muted/20 transition-colors ${org.suspended ? "opacity-60" : ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium">{org.legalName}</div>
                  <div className="text-xs text-muted-foreground font-mono">{org.orgId}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(org.capabilities ?? []).map((c: string) => (
                      <span key={c} className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {org.suspended ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 font-medium">SUSPENDED</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 font-medium">ACTIVE</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant={org.suspended ? "outline" : "destructive"}
                    className="h-7 text-xs"
                    disabled={acting === org.orgId}
                    onClick={() => handleSuspend(org.orgId, org.suspended)}
                  >
                    {acting === org.orgId
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : org.suspended ? "Reinstate" : "Suspend"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Compliance bar ───────────────────────────────────────────────────────────

function ComplianceBar({ label, drivers, check }: { label: string; drivers: Driver[]; check: (d: Driver) => boolean }) {
  if (drivers.length === 0) return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">—</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary" />
    </div>
  );
  const pct = Math.round((drivers.filter(check).length / drivers.length) * 100);
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${pct < 70 ? "text-red-500" : pct < 90 ? "text-amber-500" : "text-green-600"}`}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full transition-all ${pct < 70 ? "bg-red-500" : pct < 90 ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
