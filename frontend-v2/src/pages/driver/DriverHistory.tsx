import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  BOOKED:     { label: "Booked",     className: "bg-blue-100 text-blue-700"    },
  IN_TRANSIT: { label: "In Transit", className: "bg-amber-100 text-amber-700"  },
  DELIVERED:  { label: "Delivered",  className: "bg-green-100 text-green-700"  },
  CANCELLED:  { label: "Cancelled",  className: "bg-red-100 text-red-700"      },
};

function fmt(n: number | undefined) {
  return n != null ? n.toLocaleString() : "—";
}

export default function DriverHistory() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDriverHistory()
      .then((res) => setItems(res.loads ?? []))
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Load History"
        subtitle="Loads you've accepted, are hauling, or have delivered"
      />

      <div className="max-w-4xl mx-auto p-6">
        {items.length === 0 ? (
          <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Package className="h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">No load history yet.</p>
            <p className="text-xs">Loads you accept will appear here.</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card divide-y">
            {items.map(({ load, offer }: any) => {
              const cfg = STATUS_CONFIG[load?.status] ?? { label: load?.status ?? "—", className: "bg-secondary text-muted-foreground" };
              const acceptedDate = offer?.acceptedAt
                ? new Date(offer.acceptedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : null;
              const rate = offer?.rate ?? load?.rateAmount;

              return (
                <div key={load.loadId} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {/* Status + date */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.className}`}>
                        {cfg.label}
                      </span>
                      {acceptedDate && (
                        <span className="text-[11px] text-muted-foreground">
                          Accepted {acceptedDate}
                        </span>
                      )}
                    </div>

                    {/* Route */}
                    <p className="font-medium text-sm truncate">
                      {load.pickupCity}, {load.pickupState} → {load.deliveryCity}, {load.deliveryState}
                    </p>

                    {/* Details row */}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {load.equipmentType} · {fmt(load.totalWeightLbs)} lbs
                      {load.totalMiles ? ` · ${fmt(Math.round(load.totalMiles))} mi` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {rate != null && (
                      <span className="text-sm font-semibold text-green-600">
                        ${fmt(rate)}
                      </span>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/driver/loads/${load.loadId}`}>View</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
