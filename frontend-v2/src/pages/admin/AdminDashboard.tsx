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

      {/* Order: highest-stakes first.
            Orgs (IAM overrides) -> Support inbox -> Fleet -> Channels.
            Redundant KPI cards + legacy Driver roster removed -- the
            FleetFeed status pills already show those counts. */}

      <OrgManagementPanel />

      <SupportInbox />

      <FleetFeed />

      <SupportChannels />

    </>
  );
}

// ─── stale local OrgManagementPanel removed (Phase 5 cleanup).
// The real component is imported from @/components/admin/OrgManagementPanel
// (Phase 5: removed the local OrgManagementPanel stub that shadowed the imported real one.)

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
