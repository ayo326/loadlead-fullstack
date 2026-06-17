/**
 * LoadHistoryList — shared filter + pagination view for driver and OO history.
 *
 * Filters: status (BOOKED / IN_TRANSIT / DELIVERED / CANCELLED / All) and
 * date range (7d / 30d / 90d / All). Filtering is client-side because the
 * /history endpoint returns the full list; if that becomes too heavy we'll
 * push paging down into DynamoDB queries.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Package, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PodUploadButton } from "@/components/PodUploadButton";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  BOOKED:     { label: "Booked",     className: "bg-blue-100 text-blue-700"    },
  IN_TRANSIT: { label: "In Transit", className: "bg-amber-100 text-amber-700"  },
  DELIVERED:  { label: "Delivered",  className: "bg-green-100 text-green-700"  },
  CANCELLED:  { label: "Cancelled",  className: "bg-red-100 text-red-700"      },
};

const PAGE_SIZE = 20;
const STATUS_FILTERS = ["ALL", "BOOKED", "IN_TRANSIT", "DELIVERED"] as const;
const DATE_FILTERS  = ["7", "30", "90", "ALL"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];
type DateFilter   = typeof DATE_FILTERS[number];

const DATE_LABEL: Record<DateFilter, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "ALL": "All time",
};

function fmt(n: number | undefined) {
  return n != null ? n.toLocaleString() : "—";
}

interface LoadHistoryListProps {
  items: Array<{ load: any; offer?: any }>;
  emptyText?: string;
  /** Where the "View" button links to — given the load object */
  loadDetailHref: (load: any) => string;
  /** Show inline POD upload button on each row (driver-only — OO can't sign PODs for fleet drivers) */
  showPodUpload?: boolean;
}

export function LoadHistoryList({ items, emptyText = "No load history yet.", loadDetailHref, showPodUpload = false }: LoadHistoryListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [dateFilter, setDateFilter] = useState<DateFilter>("ALL");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const cutoff = dateFilter === "ALL" ? 0 : Date.now() - parseInt(dateFilter) * 86_400_000;
    return items.filter(({ load, offer }) => {
      if (statusFilter !== "ALL" && load?.status !== statusFilter) return false;
      const ts = offer?.acceptedAt ?? load?.createdAt ?? 0;
      if (cutoff && ts < cutoff) return false;
      return true;
    });
  }, [items, statusFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function setFilter(s: StatusFilter | null, d: DateFilter | null) {
    if (s != null) setStatusFilter(s);
    if (d != null) setDateFilter(d);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Status:</span>
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s, null)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              {s === "ALL" ? "All" : STATUS_CONFIG[s]?.label ?? s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Period:</span>
          {DATE_FILTERS.map(d => (
            <button
              key={d}
              onClick={() => setFilter(null, d)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                dateFilter === d ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              {DATE_LABEL[d]}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "load" : "loads"}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Package className="h-10 w-10 opacity-40" />
          <p className="text-sm font-medium">{items.length === 0 ? emptyText : "No loads match the current filters."}</p>
          {items.length > 0 && (
            <button onClick={() => { setStatusFilter("ALL"); setDateFilter("ALL"); setPage(1); }} className="text-xs text-primary hover:underline">
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {paged.map(({ load, offer }: any) => {
            const cfg = STATUS_CONFIG[load?.status] ?? { label: load?.status ?? "—", className: "bg-secondary text-muted-foreground" };
            const acceptedDate = offer?.acceptedAt
              ? new Date(offer.acceptedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
              : null;
            const rate = offer?.rate ?? load?.rateAmount;

            return (
              <div key={load.loadId} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.className}`}>
                      {cfg.label}
                    </span>
                    {acceptedDate && (
                      <span className="text-[11px] text-muted-foreground">Accepted {acceptedDate}</span>
                    )}
                  </div>
                  <p className="font-medium text-sm truncate">
                    {load.pickupCity}, {load.pickupState} → {load.deliveryCity}, {load.deliveryState}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {load.equipmentType} · {fmt(load.totalWeightLbs)} lbs
                    {load.totalMiles ? ` · ${fmt(Math.round(load.totalMiles))} mi` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {rate != null && (
                    <span className="text-sm font-semibold text-green-600">${fmt(rate)}</span>
                  )}
                  {showPodUpload && <PodUploadButton loadId={load.loadId} loadStatus={load.status} />}
                  <Button size="sm" variant="outline" asChild>
                    <Link to={loadDetailHref(load)}>View</Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Page {safePage} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
