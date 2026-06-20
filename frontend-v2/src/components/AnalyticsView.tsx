/**
 * AnalyticsView — derives carrier performance metrics from the history list.
 *
 * All metrics are computed client-side from the same data the History page uses,
 * so there's no new backend endpoint to maintain. If the dataset grows past a
 * few thousand loads we'll push aggregation down into DynamoDB / a materialised
 * view.
 */

import { useMemo, useState } from "react";
// Map is aliased to MapIcon to avoid shadowing the global Map constructor used
// on line ~89. Minified prod builds otherwise rename the icon symbol to something
// like 'Aa' and `new Map(...)` becomes `new Aa(...)` → "Aa is not a constructor".
import { DollarSign, TrendingUp, Truck, Map as MapIcon, CheckCircle2 } from "lucide-react";

interface AnalyticsViewProps {
  items: Array<{ load: any; offer?: any }>;
}

type Range = "30" | "90" | "365" | "ALL";

const RANGE_LABEL: Record<Range, string> = {
  "30":  "Last 30 days",
  "90":  "Last 90 days",
  "365": "Last 12 months",
  "ALL": "All time",
};

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtNum(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StatCard({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function AnalyticsView({ items }: AnalyticsViewProps) {
  const [range, setRange] = useState<Range>("90");

  const stats = useMemo(() => {
    const cutoff = range === "ALL" ? 0 : Date.now() - parseInt(range) * 86_400_000;
    const filtered = items.filter(({ load, offer }) => {
      const ts = offer?.acceptedAt ?? load?.createdAt ?? 0;
      return !cutoff || ts >= cutoff;
    });

    const delivered = filtered.filter(i => i.load?.status === "DELIVERED");
    const inProgress = filtered.filter(i => i.load?.status === "BOOKED" || i.load?.status === "IN_TRANSIT");

    let totalMiles = 0;
    let totalEarnings = 0;
    let perMileSum = 0;
    let perMileCount = 0;

    for (const { load, offer } of filtered) {
      const miles = Number(load?.totalMiles) || 0;
      const rate  = Number(offer?.rate ?? load?.rateAmount) || 0;
      totalMiles += miles;
      totalEarnings += rate;
      if (miles > 0 && rate > 0) {
        perMileSum += rate / miles;
        perMileCount += 1;
      }
    }

    const avgRatePerMile = perMileCount > 0 ? perMileSum / perMileCount : 0;

    return {
      totalLoads: filtered.length,
      delivered: delivered.length,
      inProgress: inProgress.length,
      totalMiles,
      totalEarnings,
      avgRatePerMile,
    };
  }, [items, range]);

  // Earnings by month (for the table) — top 6 most recent months
  const byMonth = useMemo(() => {
    const buckets = new Map<string, { miles: number; earnings: number; loads: number }>();
    for (const { load, offer } of items) {
      const ts = offer?.acceptedAt ?? load?.createdAt;
      if (!ts) continue;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.get(key) ?? { miles: 0, earnings: 0, loads: 0 };
      b.miles    += Number(load?.totalMiles) || 0;
      b.earnings += Number(offer?.rate ?? load?.rateAmount) || 0;
      b.loads    += 1;
      buckets.set(key, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 6)
      .map(([key, v]) => {
        const [y, m] = key.split("-");
        const label = new Date(parseInt(y), parseInt(m) - 1, 1)
          .toLocaleDateString(undefined, { month: "short", year: "numeric" });
        return { label, ...v };
      });
  }, [items]);

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground mr-1">Range:</span>
        {(["30", "90", "365", "ALL"] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
              range === r ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80"
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Total earnings" value={fmtMoney(stats.totalEarnings)} hint={`${stats.totalLoads} loads`} />
        <StatCard icon={MapIcon}    label="Miles driven"   value={fmtNum(stats.totalMiles)}      hint="Cumulative" />
        <StatCard icon={CheckCircle2} label="Delivered"    value={fmtNum(stats.delivered)}       hint={`${stats.inProgress} in progress`} />
        <StatCard icon={TrendingUp} label="Avg $ / mile"   value={fmtMoney(stats.avgRatePerMile)} hint="Across this range" />
      </div>

      {/* Earnings by month */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Earnings by month</h3>
        </div>
        {byMonth.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No completed loads yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left px-5 py-2.5 font-medium">Month</th>
                <th className="text-right px-5 py-2.5 font-medium">Loads</th>
                <th className="text-right px-5 py-2.5 font-medium">Miles</th>
                <th className="text-right px-5 py-2.5 font-medium">Earnings</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.map(row => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5 font-medium">{row.label}</td>
                  <td className="px-5 py-2.5 text-right">{fmtNum(row.loads)}</td>
                  <td className="px-5 py-2.5 text-right">{fmtNum(row.miles)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-green-600">{fmtMoney(row.earnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
