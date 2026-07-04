import { ReactNode } from "react";

// Dispatch page header. See design-system/MASTER.md §9.
//   - 56px tall surface (`h-page-header`), 1px bottom border
//   - eyebrow above title in JetBrains Mono uppercase
//   - title in `text-h1`, subtitle in `text-body` muted
//   - actions cluster right; at most one primary
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-overline font-mono text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="text-h1 font-display text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-body text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// KPI tile. Calmer than the old big-number variant; built for dashboards
// that show 4-6 of these side by side. See MASTER §9.
export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down" | "flat";
  icon?: React.ReactNode;
  /** Optional colored left-edge marker. Admin glass theme only - maps to the
   *  .gtile-* classes in admin-glass.css; the customer surface never passes
   *  it, so this is a no-op there. */
  accent?: "orgs" | "info" | "live" | "attn" | "brand";
}) {
  const trendColor =
    trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className={`rounded-md border border-border bg-card p-5${accent ? ` gtile gtile-${accent}` : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-overline font-mono text-muted-foreground">{label}</div>
        {icon && <div className="shrink-0">{icon}</div>}
      </div>
      <div className="mt-2 font-display text-h1 tabular text-foreground">{value}</div>
      {hint && <div className={`mt-1 text-label ${trendColor}`}>{hint}</div>}
    </div>
  );
}

// Status pill - load lifecycle. Maps every known status to a tonal variant
// using the new Badge atom. Dispatch uses sharp 4px radius (not pill round).
const STATUS_TO_VARIANT: Record<
  string,
  { tone: "neutral" | "info" | "success" | "warning" | "destructive"; pulse?: boolean; dot?: boolean }
> = {
  OPEN:       { tone: "info",        dot: true },
  TENDERED:   { tone: "info",        dot: true },
  BROADCAST:  { tone: "warning",     dot: true, pulse: true },
  BOOKED:     { tone: "info",        dot: true },
  ACCEPTED:   { tone: "success",     dot: true },
  DISPATCHED: { tone: "info",        dot: true },
  IN_TRANSIT: { tone: "info",        dot: true, pulse: true },
  DELIVERED:  { tone: "success",     dot: true },
  AVAILABLE:  { tone: "success",     dot: true },
  ON_LOAD:    { tone: "info",        dot: true, pulse: true },
  OFFLINE:    { tone: "neutral",     dot: true },
  CANCELLED:  { tone: "destructive", dot: true },
  REJECTED:   { tone: "destructive", dot: true },
  DRAFT:      { tone: "neutral" },
};

export function StatusPill({ status }: { status: string }) {
  const v = STATUS_TO_VARIANT[status] ?? { tone: "neutral" as const };
  const toneClass =
    v.tone === "info"
      ? "bg-primary/10 text-primary"
      : v.tone === "success"
        ? "bg-success/15 text-success"
        : v.tone === "warning"
          ? "bg-warning/15 text-[hsl(var(--warning))]"
          : v.tone === "destructive"
            ? "bg-destructive/10 text-destructive"
            : "bg-secondary text-secondary-foreground";

  return (
    <span
      className={`inline-flex items-center gap-1.5 h-5 rounded-sm px-2 text-overline uppercase ${toneClass}`}
    >
      {v.dot && (
        <span
          className={`status-dot ${v.pulse ? "animate-status-pulse" : ""}`}
          aria-hidden
        />
      )}
      {status.replace(/_/g, " ")}
    </span>
  );
}
