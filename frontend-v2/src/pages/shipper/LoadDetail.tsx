import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock,
  FileText, MapPin, Navigation, Package, PackagePlus, Truck, User,
} from "lucide-react";
import { PageHeader, StatusPill } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { RouteMapCard } from "@/components/RouteMapCard";
import { AttestationChain } from "@/components/attestation/AttestationChain";
import { api } from "@/lib/api";
import { toast } from "sonner";

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? "—"}</span>
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

const STATUS_PROGRESS: Record<string, number> = {
  DRAFT: 0, OPEN: 10, OFFERED: 25, BOOKED: 40,
  IN_TRANSIT: 72, DELIVERED: 100, CANCELLED: 0, EXPIRED: 0,
};

export default function ShipperLoadDetail() {
  const { loadId } = useParams<{ loadId: string }>();
  const navigate = useNavigate();
  const [load, setLoad] = useState<any>(null);
  const [tracking, setTracking] = useState<any>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loadId) return;
    api.getShipperLoad(loadId)
      .then((r) => { setLoad(r.load); setTracking(r.tracking ?? null); })
      .catch((e: any) => toast.error(e.message ?? "Load not found"))
      .finally(() => setFetching(false));
  }, [loadId]);

  if (fetching) {
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

  const miles = load.totalMiles ?? 0;
  const rate = load.rateAmount ?? 0;
  const total = load.rateType === "PER_MILE" ? (miles * rate).toFixed(0) : Number(rate).toFixed(0);
  const progress = STATUS_PROGRESS[load.status] ?? 0;
  const isLive = ["IN_TRANSIT", "BOOKED"].includes(load.status);

  return (
    <>
      <PageHeader
        eyebrow="Shipper · Load Detail"
        title={`${load.pickupCity}, ${load.pickupState} → ${load.deliveryCity}, ${load.deliveryState}`}
        subtitle={`${load.referenceNumber} · ${miles} mi · ${load.equipmentType?.replace(/_/g, " ")}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {["BOOKED", "IN_TRANSIT", "DELIVERED"].includes(load.status) && (
              <Button variant="outline" asChild>
                <Link to={`/bol/${loadId}`}>
                  <FileText className="h-4 w-4" /> Bill of Lading
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link to="/shipper/post">
                <PackagePlus className="h-4 w-4" /> Post new load
              </Link>
            </Button>
          </div>
        }
      />

      {/* Status bar */}
      <div className="rounded-md border border-border bg-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">{load.pickupCity}, {load.pickupState} → {load.deliveryCity}, {load.deliveryState}</div>
              <div className="text-xs text-muted-foreground">{load.referenceNumber} · {miles} mi · {load.equipmentType?.replace(/_/g, " ")}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={load.status} />
            {isLive && (
              <span className="flex items-center gap-1.5 text-xs text-success font-medium">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> Live
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-sm transition-all duration-slow ease-soft"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{load.pickupCity}, {load.pickupState}</span>
          {load.status === "DELIVERED" && (
            <span className="flex items-center gap-1 text-success font-semibold">
              <CheckCircle2 className="h-3 w-3" /> Delivered
            </span>
          )}
          {load.status === "IN_TRANSIT" && tracking?.etaToDelivery && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <Clock className="h-3 w-3" /> ETA {tracking.etaToDelivery.durationText}
            </span>
          )}
          <span>{load.deliveryCity}, {load.deliveryState}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Live tracking card — only when IN_TRANSIT with location */}
          {load.status === "IN_TRANSIT" && tracking?.driverLocation && (
            <Section title="Live driver location" icon={Navigation}>
              <RouteMapCard
                pickupAddress={load.pickupAddress ? `${load.pickupAddress}, ${load.pickupCity}, ${load.pickupState} ${load.pickupZip}` : null}
                deliveryAddress={load.deliveryAddress ? `${load.deliveryAddress}, ${load.deliveryCity}, ${load.deliveryState} ${load.deliveryZip}` : null}
                currentLat={tracking.driverLocation.lat}
                currentLng={tracking.driverLocation.lng}
                currentCity={tracking.driverLocation.city}
                currentState={tracking.driverLocation.state}
              />
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-secondary p-2.5">
                  <div className="text-muted-foreground">Current city</div>
                  <div className="font-semibold mt-0.5">{tracking.driverLocation.city ?? "—"}, {tracking.driverLocation.state ?? ""}</div>
                </div>
                <div className="rounded-lg bg-secondary p-2.5">
                  <div className="text-muted-foreground">Miles remaining</div>
                  <div className="font-semibold mt-0.5">{tracking.etaToDelivery?.miles ?? "—"} mi</div>
                </div>
                <div className="rounded-lg bg-secondary p-2.5">
                  <div className="text-muted-foreground">ETA</div>
                  <div className="font-semibold mt-0.5">{tracking.etaToDelivery?.durationText ?? "—"}</div>
                </div>
              </div>
            </Section>
          )}

          <Section title="Route" icon={MapPin}>
            <div className="flex gap-4 mb-4">
              <div className="flex flex-col items-center pt-1">
                <div className="h-3 w-3 rounded-full bg-primary" />
                <div className="w-px flex-1 bg-border my-1.5 min-h-[40px]" />
                <div className="h-3 w-3 rounded-full bg-accent" />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <div className="font-semibold">{load.pickupCity}, {load.pickupState} {load.pickupZip ?? ""}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{load.pickupAddress}</div>
                  <div className="text-xs text-muted-foreground">Pickup · {load.pickupTime} · {load.pickupType?.replace(/_/g, " ")}</div>
                </div>
                <div>
                  <div className="font-semibold">{load.deliveryCity}, {load.deliveryState} {load.deliveryZip ?? ""}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{load.deliveryAddress}</div>
                  <div className="text-xs text-muted-foreground">Delivery · {load.deliveryTime} · {load.deliveryType?.replace(/_/g, " ")}</div>
                </div>
              </div>
            </div>
            <Row label="Total miles" value={`${miles} mi`} />
            <Row label="Pickup date" value={load.pickupDate ? new Date(load.pickupDate).toLocaleDateString() : null} />
            <Row label="Delivery date" value={load.deliveryDate ? new Date(load.deliveryDate).toLocaleDateString() : null} />
          </Section>

          <Section title="Freight details" icon={Package}>
            <Row label="Equipment" value={load.equipmentType?.replace(/_/g, " ")} />
            <Row label="Load size" value={load.loadSize} />
            <Row label="Total weight" value={load.totalWeightLbs ? `${Number(load.totalWeightLbs).toLocaleString()} lbs` : null} />
            <Row label="Commodity" value={load.commodityDescription} />
            <Row label="Stackable" value={load.stackable != null ? (load.stackable ? "Yes" : "No") : null} />
            <Row label="Fragile" value={load.fragile != null ? (load.fragile ? "Yes" : "No") : null} />
            <Row label="Hazmat" value={load.hazmat != null ? (load.hazmat ? "Yes" : "No") : null} />
          </Section>

          {load.pickupInstructions && (
            <Section title="Pickup instructions" icon={FileText}>
              <p className="text-sm text-muted-foreground">{load.pickupInstructions}</p>
            </Section>
          )}
        </div>

        <aside className="space-y-6">
          {/* Driver */}
          <Section title="Assigned driver" icon={User}>
            {load.assignedDriverId ? (
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-sm bg-secondary text-primary flex items-center justify-center text-overline font-mono"
                  aria-hidden
                >
                  DR
                </div>
                <div>
                  <div className="font-medium text-sm">Driver assigned</div>
                  <div className="text-xs text-muted-foreground font-mono">{load.assignedDriverId}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
                Broadcasting to drivers…
              </div>
            )}
          </Section>

          {/* Rate */}
          <Section title="Rate & payment" icon={Truck}>
            <Row label="Rate type" value={load.rateType?.replace("_", " ")} />
            <Row label="Rate" value={`$${Number(rate).toFixed(2)}${load.rateType === "PER_MILE" ? "/mi" : ""}`} />
            <Row label="Total payout" value={<span className="font-bold">${Number(total).toLocaleString()}</span>} />
            <Row label="Payment terms" value={load.paymentTerms?.replace(/_/g, " ")} />
          </Section>

          {/* Broadcast rules */}
          <Section title="Broadcast rules" icon={FileText}>
            <Row label="Radius" value={load.broadcastRadiusMiles ? `${load.broadcastRadiusMiles} mi` : null} />
            <Row label="Offer TTL" value={load.offerTtlMinutes ? `${load.offerTtlMinutes} min` : null} />
            <Row label="Min MC maturity" value={load.minMcMaturityDays ? `${Math.round(load.minMcMaturityDays / 30)} months` : null} />
            <Row label="Min cargo ins." value={load.minCargoInsurance ? `$${(load.minCargoInsurance / 1_000_000).toFixed(1)}M` : null} />
            <Row label="Endorsements" value={load.requiredEndorsements?.length ? load.requiredEndorsements.join(", ") : "None"} />
          </Section>

          {/* References */}
          <Section title="References" icon={FileText}>
            <Row label="Load ID" value={<span className="font-mono text-xs">{load.loadId}</span>} />
            <Row label="Reference #" value={load.referenceNumber} />
            <Row label="Status" value={<StatusPill status={load.status} />} />
          </Section>

          {/* Read-only attestation chain — visible to the load's parties + admin. */}
          <AttestationChain loadId={load.loadId} />
        </aside>
      </div>
    </>
  );
}
