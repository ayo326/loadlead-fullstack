import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Clock, MapPin, Package,
  Truck, User, FileText, AlertTriangle,
} from "lucide-react";
import { PageHeader, StatusPill } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { receiverShipments } from "@/lib/mockData";
import { toast } from "sonner";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] p-6">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  );
}

export default function LoadDetail() {
  const { loadId } = useParams<{ loadId: string }>();
  const navigate = useNavigate();
  const [load, setLoad] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!loadId) return;

    // Try real API first
    api.getReceiverLoad(loadId)
      .then((r) => setLoad(r.load))
      .catch(() => {
        // Fall back to mock data (for demo IDs like L-10410)
        const mock = receiverShipments.find((s) => s.id === loadId);
        if (mock) {
          setLoad({
            loadId: mock.id,
            referenceNumber: mock.id,
            status: mock.status,
            pickupCity: mock.origin.split(",")[0]?.trim(),
            pickupState: mock.origin.split(",")[1]?.trim(),
            deliveryCity: mock.destination.split(",")[0]?.trim(),
            deliveryState: mock.destination.split(",")[1]?.trim(),
            totalMiles: mock.miles,
            totalWeightLbs: mock.weightLbs,
            equipmentType: mock.equipment,
            rateAmount: mock.ratePerMile,
            rateType: "PER_MILE",
            assignedDriverName: mock.driver,
            shipperName: mock.shipper,
            pickupTime: mock.pickupAt,
            _isMock: true,
          });
        } else {
          toast.error("Load not found");
        }
      })
      .finally(() => setLoading(false));
  }, [loadId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 text-muted-foreground text-sm">
        Loading load details…
      </div>
    );
  }

  if (!load) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground">Load not found.</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const totalPayout = load.rateType === "PER_MILE"
    ? (load.totalMiles * load.rateAmount).toFixed(0)
    : Number(load.rateAmount).toFixed(0);

  const progressPct = load.status === "DELIVERED" ? 100 : load.status === "IN_TRANSIT" ? 72 : 0;

  return (
    <>
      <PageHeader
        eyebrow="Receiver · Load Detail"
        title={`${load.pickupCity}, ${load.pickupState} → ${load.deliveryCity}, ${load.deliveryState}`}
        subtitle={`${load.referenceNumber ?? load.loadId} · ${load.shipperName ?? "Shipper"}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {["IN_TRANSIT", "DELIVERED"].includes(load.status) && (
              <Button variant="outline" asChild>
                <Link to={`/bol/${loadId}`}>
                  <FileText className="h-4 w-4" /> Bill of Lading
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {/* Status + progress bar */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">{load.pickupCity}, {load.pickupState} → {load.deliveryCity}, {load.deliveryState}</div>
              <div className="text-xs text-muted-foreground">{load.totalMiles} mi · {load.equipmentType?.replace(/_/g, " ")}</div>
            </div>
          </div>
          <StatusPill status={load.status} />
        </div>

        {load.status === "DELIVERED" ? (
          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Delivered successfully
          </div>
        ) : load.status === "IN_TRANSIT" ? (
          <>
            <div className="relative h-2.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-muted-foreground">{load.pickupCity}, {load.pickupState}</span>
              <span className="font-medium text-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> {progressPct}% · ETA 6:15 PM
              </span>
              <span className="text-muted-foreground">{load.deliveryCity}, {load.deliveryState}</span>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Route" icon={MapPin}>
            <Row label="Origin" value={`${load.pickupCity}, ${load.pickupState} ${load.pickupZip ?? ""}`} />
            <Row label="Destination" value={`${load.deliveryCity}, ${load.deliveryState} ${load.deliveryZip ?? ""}`} />
            <Row label="Pickup address" value={load.pickupAddress} />
            <Row label="Delivery address" value={load.deliveryAddress} />
            <Row label="Pickup time" value={load.pickupTime} />
            <Row label="Delivery time" value={load.deliveryTime} />
            <Row label="Total miles" value={load.totalMiles ? `${load.totalMiles} mi` : null} />
          </Section>

          <Section title="Freight" icon={Package}>
            <Row label="Equipment" value={load.equipmentType?.replace(/_/g, " ")} />
            <Row label="Weight" value={load.totalWeightLbs ? `${Number(load.totalWeightLbs).toLocaleString()} lbs` : null} />
            <Row label="Load size" value={load.loadSize} />
            <Row label="Commodity" value={load.commodityDescription} />
            <Row label="Stackable" value={load.stackable != null ? (load.stackable ? "Yes" : "No") : null} />
            <Row label="Hazmat" value={load.hazmat != null ? (load.hazmat ? "Yes" : "No") : null} />
          </Section>

          <Section title="Pickup instructions" icon={FileText}>
            <p className="text-sm text-muted-foreground">
              {load.pickupInstructions || "No special instructions provided."}
            </p>
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Driver" icon={User}>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground flex items-center justify-center text-sm font-semibold">
                {(load.assignedDriverName ?? "D").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-sm">{load.assignedDriverName ?? "Not assigned"}</div>
                <div className="text-xs text-muted-foreground">Assigned driver</div>
              </div>
            </div>
            <Row label="Driver ID" value={load.assignedDriverId} />
          </Section>

          <Section title="Rate & Payment" icon={FileText}>
            <Row label="Rate type" value={load.rateType?.replace("_", " ")} />
            <Row label="Rate" value={load.rateAmount ? `$${Number(load.rateAmount).toFixed(2)}${load.rateType === "PER_MILE" ? "/mi" : ""}` : null} />
            <Row label="Total payout" value={totalPayout ? `$${Number(totalPayout).toLocaleString()}` : null} />
            <Row label="Payment terms" value={load.paymentTerms?.replace("_", " ")} />
          </Section>

          <Section title="References" icon={FileText}>
            <Row label="Load ID" value={load.loadId} />
            <Row label="Reference #" value={load.referenceNumber} />
            <Row label="Shipper" value={load.shipperName} />
          </Section>
        </aside>
      </div>
    </>
  );
}
