import { ReactNode } from "react";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div>
        {eyebrow && <div className="text-xs uppercase tracking-widest text-primary font-semibold mb-2">{eyebrow}</div>}
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-muted-foreground max-w-xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, trend }: { label: string; value: string; hint?: string; trend?: "up" | "down" | "flat" }) {
  const trendColor = trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">{value}</div>
      {hint && <div className={`mt-1 text-xs ${trendColor}`}>{hint}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    OPEN: "bg-secondary text-secondary-foreground",
    BROADCAST: "bg-warning/15 text-warning border border-warning/30",
    BOOKED: "bg-primary/10 text-primary border border-primary/20",
    IN_TRANSIT: "bg-accent/15 text-accent border border-accent/30",
    DELIVERED: "bg-success/15 text-success border border-success/30",
    AVAILABLE: "bg-success/15 text-success border border-success/30",
    ON_LOAD: "bg-accent/15 text-accent border border-accent/30",
    OFFLINE: "bg-muted text-muted-foreground border border-border",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${map[status] ?? "bg-secondary"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status.replace("_", " ")}
    </span>
  );
}