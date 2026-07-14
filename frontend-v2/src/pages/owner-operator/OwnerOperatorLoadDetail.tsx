import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Clock, MapPin, Package, Truck, FileText, DollarSign } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { AccessorialsPanel } from "@/components/AccessorialsPanel";
import { NegotiationPanel } from "@/components/NegotiationPanel";
import { api } from "@/lib/api";
import { LoadPolicySignCard } from "@/components/LoadPolicySignCard";
import { CapacityChip, useCapacity } from "@/components/capacity/CapacityChip";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  BOOKED:     { label: "Booked",     className: "bg-blue-100 text-blue-700"    },
  IN_TRANSIT: { label: "In Transit", className: "bg-amber-100 text-amber-700"  },
  DELIVERED:  { label: "Delivered",  className: "bg-green-100 text-green-700"  },
  CANCELLED:  { label: "Cancelled",  className: "bg-red-100 text-red-700"      },
  OPEN:       { label: "Open",       className: "bg-secondary text-foreground" },
  OFFERED:    { label: "Offered",    className: "bg-purple-100 text-purple-700"},
};

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? "-"}</span>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  );
}

function fmt(n: number | undefined | null) {
  return n != null ? n.toLocaleString() : "-";
}

function fmtDate(ts: number | string | undefined) {
  if (!ts) return "-";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function OwnerOperatorLoadDetail() {
  const { loadId } = useParams<{ loadId: string }>();
  const navigate = useNavigate();
  const [load, setLoad] = useState<any>(null);
  const [offer, setOffer] = useState<any>(null);
  const [driverId, setDriverId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const { capacity } = useCapacity();

  const loadOffer = useCallback(() => {
    if (!loadId) return;
    api.getOwnerOperatorOffer(loadId)
      .then((r) => { setLoad(r.load); setOffer(r.offer); setDriverId(r.driverId); })
      .catch(() => toast.error("Could not load load details."))
      .finally(() => setLoading(false));
  }, [loadId]);

  useEffect(() => {
    if (!loadId) return;
    loadOffer();
  }, [loadId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!load) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Load not found" />
        <div className="max-w-2xl mx-auto p-6">
          <p className="text-sm text-muted-foreground">This load no longer exists or isn't accessible.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/owner-operator/history")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to history
          </Button>
        </div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[load.status] ?? { label: load.status, className: "bg-secondary text-muted-foreground" };
  const rate = offer?.rate ?? load.rateAmount;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Load Detail" subtitle={`#${load.loadId?.slice(-6).toUpperCase()}`} />

      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Link to="/owner-operator/history" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" />Back to history
        </Link>

        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${cfg.className}`}>{cfg.label}</span>
          {offer?.acceptedAt && (
            <span className="text-xs text-muted-foreground">Accepted {fmtDate(offer.acceptedAt)}</span>
          )}
        </div>

        {capacity && (
          <>
            <CapacityChip capacity={capacity} />
            {load.totalWeightLbs != null && (
              <p className="text-xs text-muted-foreground">
                {load.totalWeightLbs <= capacity.remainingWeightLbs
                  ? `Fits: ${fmt(load.totalWeightLbs)} lbs of your ${fmt(capacity.remainingWeightLbs)} available.`
                  : `Over your available capacity: this load is ${fmt(load.totalWeightLbs)} lbs and you have ${fmt(capacity.remainingWeightLbs)} available. You can still open and haul it.`}
              </p>
            )}
          </>
        )}

        {loadId && <LoadPolicySignCard loadId={loadId} />}

        <Section title="Route" icon={MapPin}>
          <Row label="Pickup"   value={`${load.pickupCity}, ${load.pickupState}`} />
          <Row label="Delivery" value={`${load.deliveryCity}, ${load.deliveryState}`} />
          <Row label="Pickup date"   value={fmtDate(load.pickupDate)} />
          <Row label="Delivery date" value={fmtDate(load.deliveryDate)} />
          <Row label="Total miles"   value={load.totalMiles ? `${fmt(Math.round(load.totalMiles))} mi` : undefined} />
        </Section>

        <Section title="Freight" icon={Package}>
          <Row label="Commodity"   value={load.commodityDescription} />
          <Row label="Weight"      value={`${fmt(load.totalWeightLbs)} lbs`} />
          <Row label="Equipment"   value={load.equipmentType} />
          <Row label="Load size"   value={load.loadSize} />
          {load.hazmat && <Row label="Hazmat" value="Yes" />}
          {load.temperatureMin != null && load.temperatureMax != null && (
            <Row label="Temp range" value={`${load.temperatureMin}° - ${load.temperatureMax}°F`} />
          )}
        </Section>

        <Section title="Pay" icon={DollarSign}>
          <Row label="Rate"         value={rate != null ? `$${fmt(rate)}` : undefined} />
          <Row label="Rate type"    value={load.rateType} />
          <Row label="Payment terms" value={load.paymentTerms} />
        </Section>

        <Section title="Driver assignment" icon={Truck}>
          <Row label="Driver" value={driverId ? <span className="font-mono text-xs">{driverId.slice(-10)}</span> : "Unassigned"} />
        </Section>

        {load.referenceNumber && (
          <Section title="References" icon={FileText}>
            <Row label="Shipper ref #" value={load.referenceNumber} />
          </Section>
        )}

        {/* Stop check-in/out + detention/layover accessorials for the mover. */}
        <NegotiationPanel loadId={loadId!} party="HAULER" driverId={driverId} onAssigned={loadOffer} />
        <AccessorialsPanel loadId={loadId!} role="MOVER" />
      </div>
    </div>
  );
}
