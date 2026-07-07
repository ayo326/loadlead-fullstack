/**
 * EarningsStrip - full-width settlement strip below the map.
 *
 * Real settlement data only. It reads the owner-operator dashboard `financial`
 * aggregate (grossRevenue, payeeBreakdown, factoringPipeline). A trend
 * sparkline renders ONLY when a real weekly series with >= MIN_POINTS points is
 * provided; otherwise the strip shows the figures alone (never a fabricated or
 * empty chart). Phase 5 wires the pending-payout source and the series.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DollarSign, ArrowRight } from "lucide-react";
import { CommandCard } from "./CommandShell";

const MIN_POINTS = 4;

interface EarningsStripProps {
  financial?: {
    grossRevenue?: { week?: number | null; month?: number | null };
    payeeBreakdown?: { carrier?: number | null; factor?: number | null };
    factoringPipeline?: { submitted?: number | null };
  } | null;
  /** Optional real weekly earnings series [{ label, amount }]. */
  series?: Array<{ label: string; amount: number }>;
  /** Route for the factoring export-and-send flow. */
  factoringHref?: string;
}

const fmt = (n?: number | null) => (n == null ? "-" : `$${Math.round(n).toLocaleString()}`);

export function EarningsStrip({ financial, series, factoringHref = "/owner-operator/factoring" }: EarningsStripProps) {
  const paidWeek = financial?.grossRevenue?.week ?? null;
  const paidToOperator = financial?.payeeBreakdown?.carrier ?? null;
  const paidToFactor = financial?.payeeBreakdown?.factor ?? null;

  const spark = useMemo(() => {
    if (!series || series.length < MIN_POINTS) return null;
    const vals = series.map((s) => s.amount);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const range = Math.max(max - min, 1);
    const w = 120, h = 32;
    const pts = vals
      .map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`)
      .join(" ");
    return { pts, w, h };
  }, [series]);

  return (
    <CommandCard className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
      <Figure label="Paid this week" value={fmt(paidWeek)} tone="good" />
      <Figure label="Paid to operator" value={fmt(paidToOperator)} />
      <Figure label="Paid to factor" value={fmt(paidToFactor)} />

      {spark && (
        <svg width={spark.w} height={spark.h} viewBox={`0 0 ${spark.w} ${spark.h}`} className="text-emerald-500" aria-hidden>
          <polyline points={spark.pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      <Link
        to={factoringHref}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Factor an invoice <ArrowRight className="h-4 w-4" />
      </Link>
    </CommandCard>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <DollarSign className="h-3 w-3" /> {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}
