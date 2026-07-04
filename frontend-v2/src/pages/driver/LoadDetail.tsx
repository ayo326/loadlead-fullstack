import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, AlertTriangle, Clock,
  FileText, MapPin, Package, Truck,
} from "lucide-react";
import { PageHeader, StatusPill } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/Countdown";
import { AttestationDialog, ATTESTATION_TEXT, ATTESTATION_VERSION } from "@/components/attestation/AttestationDialog";
import { AttestationChain } from "@/components/attestation/AttestationChain";
import { AccessorialsPanel } from "@/components/AccessorialsPanel";
import { NegotiationPanel } from "@/components/NegotiationPanel";
import { AccessorialTermsSummary, AccessorialDisclosureModal } from "@/components/AccessorialTerms";
import { api } from "@/lib/api";
import { toast } from "sonner";

// New transition endpoints (post-Phase-1 server). Wrapper here keeps
// the per-page wiring small.
async function postJson(path: string, body: unknown = {}) {
  const apiUrl = (import.meta as any).env?.VITE_API_URL ?? "";
  const res = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

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

export default function DriverLoadDetail() {
  const { loadId } = useParams<{ loadId: string }>();
  const navigate = useNavigate();

  const [load, setLoad] = useState<any>(null);
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  // Phase-1 attestation dialog state. Each lifecycle action opens the
  // same neutral block with a different `action` prop. The transition
  // endpoint is server-gated to fail without the matching signature.
  const [attestation, setAttestation] = useState<null | 'CARRIER_ACCEPT' | 'DRIVER_PICKUP' | 'DRIVER_DELIVER'>(null);
  const [showDisclosure, setShowDisclosure] = useState(false);

  useEffect(() => {
    if (!loadId) return;
    api.getDriverOffer(loadId)
      .then((r) => { setLoad(r.load); setOffer(r.offer); })
      .catch(() => toast.error("Could not load offer details."))
      .finally(() => setLoading(false));
  }, [loadId]);

  // Tail-action handlers - after the attestation lands the transition endpoint fires.
  const onAttestationSigned = async (action: 'CARRIER_ACCEPT' | 'DRIVER_PICKUP' | 'DRIVER_DELIVER') => {
    if (!loadId) return;
    try {
      if (action === 'CARRIER_ACCEPT') {
        await api.acceptOffer(loadId);
        toast.success("Load accepted! It's yours.");
        navigate("/driver");
      } else if (action === 'DRIVER_PICKUP') {
        await postJson(`/api/driver/loads/${loadId}/pickup`);
        toast.success("Pickup recorded · load in transit.");
        setAttestation(null);
        // refetch so the UI reflects IN_TRANSIT
        const r = await api.getDriverOffer(loadId); setLoad(r.load); setOffer(r.offer);
      } else if (action === 'DRIVER_DELIVER') {
        await postJson(`/api/driver/loads/${loadId}/deliver`);
        toast.success("Delivery recorded · load delivered.");
        setAttestation(null);
        const r = await api.getDriverOffer(loadId); setLoad(r.load); setOffer(r.offer);
      }
    } catch (e: any) {
      toast.error(e?.message ?? `${action} failed`);
    }
  };

  // Accepting first opens the detention/layover disclosure. Its acknowledgment
  // records the e-sign policy acceptance, then hands off to the load-tender
  // attestation. Backing out of the disclosure writes nothing.
  const accept = () => setShowDisclosure(true);

  const decline = async () => {
    if (!loadId) return;
    setActing(true);
    try {
      await api.declineOffer(loadId);
      toast.success("Offer declined.");
      navigate("/driver");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64 text-muted-foreground text-sm">
        Loading offer details…
      </div>
    );
  }

  if (!load) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground">Offer not found or already expired.</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const miles = load.totalMiles ?? 0;
  const rate = load.rateAmount ?? 0;
  const total = load.rateType === "PER_MILE" ? (miles * rate).toFixed(0) : Number(rate).toFixed(0);
  const offerActive = offer?.status === "OFFERED";

  return (
    <>
      <PageHeader
        eyebrow="Driver · Offer Detail"
        title={`${load.pickupCity}, ${load.pickupState} → ${load.deliveryCity}, ${load.deliveryState}`}
        subtitle={`${load.referenceNumber} · ${miles} mi · ${load.equipmentType?.replace(/_/g, " ")}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {!offerActive && offer && (
              <Button variant="outline" asChild>
                <Link to={`/bol/${loadId}`}>
                  <FileText className="h-4 w-4" /> Bill of Lading
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {/* Offer header bar */}
      <div className="rounded-md border border-border bg-card px-5 py-4 mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <StatusPill status={offerActive ? "BROADCAST" : offer?.status ?? "OPEN"} />
          <span className="text-xs text-muted-foreground font-mono">{load.referenceNumber}</span>
        </div>
        {offer?.expiresAt && offerActive && (
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <Clock className="h-4 w-4" />
            <Countdown expiresAt={offer.expiresAt * 1000} />
          </div>
        )}
      </div>

      {/* Payout hero */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-6 mb-6 flex flex-wrap items-center justify-between gap-6">
        <div className="flex gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Weight</div>
            <div className="text-2xl font-bold mt-1">{(load.totalWeightLbs / 1000).toFixed(1)}k lbs</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">$/mile</div>
            <div className="text-2xl font-bold mt-1">${Number(rate).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total payout</div>
            <div className="text-2xl font-bold mt-1 text-success">${Number(total).toLocaleString()}</div>
          </div>
        </div>

        {offerActive && (
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="min-w-28"
              disabled={acting}
              onClick={decline}
            >
              Decline
            </Button>
            <Button
              size="lg"
              className="min-w-28 bg-success text-success-foreground hover:bg-success/90"
              disabled={acting}
              onClick={accept}
            >
              Accept <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Route" icon={MapPin}>
            {/* Route dots */}
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
            <Row label="Total weight" value={`${Number(load.totalWeightLbs).toLocaleString()} lbs`} />
            <Row label="Commodity" value={load.commodityDescription} />
            <Row label="Stackable" value={load.stackable != null ? (load.stackable ? "Yes" : "No") : null} />
            <Row label="Fragile" value={load.fragile != null ? (load.fragile ? "Yes" : "No") : null} />
            <Row label="Hazmat" value={load.hazmat != null ? (load.hazmat ? "Yes" : "No") : null} />
            <Row label="High value" value={load.highValue != null ? (load.highValue ? "Yes" : "No") : null} />
          </Section>

          {load.pickupInstructions && (
            <Section title="Pickup instructions" icon={FileText}>
              <p className="text-sm text-muted-foreground">{load.pickupInstructions}</p>
            </Section>
          )}
        </div>

        <aside className="space-y-6">
          <Section title="Rate & payment" icon={Truck}>
            <Row label="Rate type" value={load.rateType?.replace("_", " ")} />
            <Row label="Rate" value={`$${Number(rate).toFixed(2)}${load.rateType === "PER_MILE" ? "/mi" : ""}`} />
            <Row label="Total payout" value={<span className="text-success font-bold">${Number(total).toLocaleString()}</span>} />
            <Row label="Payment terms" value={load.paymentTerms?.replace(/_/g, " ")} />
          </Section>

          <Section title="Requirements" icon={FileText}>
            <Row label="Min MC maturity" value={load.minMcMaturityDays ? `${Math.round(load.minMcMaturityDays / 30)} months` : null} />
            <Row label="Min cargo insurance" value={load.minCargoInsurance ? `$${(load.minCargoInsurance / 1_000_000).toFixed(1)}M` : null} />
            <Row label="Min liability" value={load.minLiabilityInsurance ? `$${(load.minLiabilityInsurance / 1_000).toFixed(0)}k` : null} />
            <Row label="Experience required" value={load.experienceRequired ? `${load.experienceRequired} yr` : null} />
            <Row label="Endorsements" value={load.requiredEndorsements?.length ? load.requiredEndorsements.join(", ") : "None"} />
          </Section>

          {offerActive && <AccessorialTermsSummary loadId={load.loadId} />}

          {offerActive && (
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full bg-success text-success-foreground hover:bg-success/90"
                disabled={acting}
                onClick={accept}
              >
                Accept load <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                disabled={acting}
                onClick={decline}
              >
                Decline
              </Button>
            </div>
          )}

          {/* Lifecycle transitions for an accepted load. Each opens the
              same neutral AttestationBlock with a different action. The
              server transition endpoints (/pickup, /deliver) reject
              without the matching signature, so cancelling here cleanly
              keeps the load in its previous state. */}
          {!offerActive && load.assignedDriverId && (
            <div className="flex flex-col gap-2">
              {load.status === 'BOOKED' && (
                <Button size="lg" className="w-full" onClick={() => setAttestation('DRIVER_PICKUP')}>
                  Mark picked up
                </Button>
              )}
              {load.status === 'IN_TRANSIT' && (
                <Button size="lg" className="w-full" onClick={() => setAttestation('DRIVER_DELIVER')}>
                  Mark delivered
                </Button>
              )}
            </div>
          )}

          {/* Read-only attestation chain for this load */}
          <AttestationChain loadId={load.loadId} />

          {/* Stop check-in/out + detention/layover accessorials for the mover. */}
          <NegotiationPanel loadId={load.loadId} party="HAULER" onAssigned={() => window.location.reload()} />
          <AccessorialsPanel loadId={load.loadId} role="MOVER" />
        </aside>
      </div>

      {/* Single attestation dialog driven by the `attestation` action state */}
      <AttestationDialog
        open={attestation !== null}
        onOpenChange={(o) => { if (!o) setAttestation(null); }}
        title={
          attestation === 'CARRIER_ACCEPT' ? 'Sign acceptance' :
          attestation === 'DRIVER_PICKUP' ? 'Sign pickup attestation' :
          attestation === 'DRIVER_DELIVER' ? 'Sign delivery attestation' : ''
        }
        subtitle={load?.referenceNumber}
        loadId={loadId ?? ''}
        action={attestation ?? 'CARRIER_ACCEPT'}
        attestationText={attestation ? ATTESTATION_TEXT[attestation] : ''}
        attestationVersion={ATTESTATION_VERSION}
        stage={
          attestation === 'DRIVER_PICKUP' ? 'PICKUP' :
          attestation === 'DRIVER_DELIVER' ? 'DELIVERY' : undefined
        }
        requirePhotos={attestation === 'DRIVER_PICKUP' || attestation === 'DRIVER_DELIVER'}
        allowExceptions={attestation === 'DRIVER_DELIVER'}
        assignedDriverId={attestation === 'CARRIER_ACCEPT' ? (load?.assignedDriverId ?? undefined) : undefined}
        onSigned={() => { if (attestation) onAttestationSigned(attestation); }}
      />

      {/* Detention/layover disclosure gate. On acknowledge it records the e-sign
          policy acceptance, then proceeds to the load-tender attestation. */}
      <AccessorialDisclosureModal
        loadId={load.loadId}
        open={showDisclosure}
        onOpenChange={setShowDisclosure}
        onAccepted={() => setAttestation('CARRIER_ACCEPT')}
      />
    </>
  );
}
