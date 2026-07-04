/**
 * Persona-NEUTRAL dashboard atoms.
 *
 * These are used by BOTH the carrier and OO dashboards. They do not branch on
 * parent type - if a future variant requires "if Carrier else OO" logic, the
 * caller passes different props, not a new branch in here. (Spec §0:
 * Independence principle.)
 */
import React from "react";
import { AlertTriangle, CheckCircle2, Clock, Link2Off } from "lucide-react";

// ── Shared "unavailable" shape, matching the backend dashboardCalc.ts ──────
export type Unavailable = {
  available: false;
  reason: "integration_not_connected" | "pending_capture" | "no_data";
};
export function isUnavailable(x: any): x is Unavailable {
  return x && typeof x === "object" && x.available === false && typeof x.reason === "string";
}

// ── StatTile: numeric metric or "-" / placeholder when Unavailable ─────────
export function StatTile({
  label, value, hint, icon: Icon, tone = "default",
}: {
  label: string;
  value: React.ReactNode;          // string/number - or pass <ConnectPlaceholder> for Unavailable
  hint?: string;
  icon?: React.ElementType;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneColor =
    tone === "good" ? "text-green-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "bad"  ? "text-red-600"   : "";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-primary" />}
      </div>
      <div className={`text-2xl font-bold ${toneColor}`}>{value}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// ── ConnectPlaceholder: rendered in place of a number for Unavailable fields ─
export function ConnectPlaceholder({ what, reason }: { what: string; reason: Unavailable["reason"] }) {
  const label =
    reason === "integration_not_connected" ? `Connect ${what}` :
    reason === "pending_capture"           ? `Pending data` :
    `No data`;
  return (
    <span className="text-sm font-medium text-muted-foreground inline-flex items-center gap-1.5">
      <Link2Off className="h-3.5 w-3.5" />{label}
    </span>
  );
}

// ── VerificationBadge: read-only mirror of verification status ─────────────
export function VerificationBadge({ status }: { status?: string }) {
  const s = (status ?? "UNVERIFIED").toUpperCase();
  const className =
    s === "VERIFIED" ? "bg-green-100 text-green-700"
    : s === "PENDING" ? "bg-amber-100 text-amber-700"
    : s === "REJECTED" || s === "EXPIRED" ? "bg-red-100 text-red-700"
    : "bg-secondary text-muted-foreground";
  const Icon = s === "VERIFIED" ? CheckCircle2 : s === "PENDING" ? Clock : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${className}`}>
      <Icon className="h-3 w-3" />{s}
    </span>
  );
}

// ── LoadRow: compact summary of a load (for tendered/unassigned lists) ─────
export interface LoadRowData {
  loadId: string;
  origin: { city: string; state: string };
  dest: { city: string; state: string };
  rate?: number;
  payout?: number;
  commodity?: string;
  equipment?: string;
  weight?: number;
}
export function LoadRow({ data, right }: { data: LoadRowData; right?: React.ReactNode }) {
  const money = data.payout ?? data.rate;
  return (
    <div className="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {data.origin.city}, {data.origin.state} → {data.dest.city}, {data.dest.state}
        </p>
        {(data.equipment || data.commodity) && (
          <p className="text-[11px] text-muted-foreground truncate">
            {data.equipment}{data.commodity ? ` · ${data.commodity}` : ""}
            {data.weight ? ` · ${data.weight.toLocaleString()} lbs` : ""}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {money != null && (
          <span className="text-sm font-semibold text-green-600">${money.toLocaleString()}</span>
        )}
        {right}
      </div>
    </div>
  );
}

// ── ProgressBar (used for onboarding rollups) ─────────────────────────────
export function ProgressBar({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return <div className="h-2 rounded-full bg-secondary" />;
  }
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-secondary">
      {segments.map((s, i) =>
        s.value > 0 ? (
          <div
            key={i}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ) : null,
      )}
    </div>
  );
}
