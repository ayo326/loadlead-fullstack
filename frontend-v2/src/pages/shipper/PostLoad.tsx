import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info, Radio } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "sonner";

const ALL_TRAILER_TYPES = [
  { value: "DRY_VAN",    label: "Dry Van",                   group: "Enclosed" },
  { value: "REEFER",     label: "Refrigerated (Reefer)",     group: "Enclosed" },
  { value: "BOX_TRUCK",  label: "Box Truck",                 group: "Enclosed" },
  { value: "FLATBED",    label: "Flatbed",                   group: "Open-Deck" },
  { value: "STEP_DECK",  label: "Step Deck",                 group: "Open-Deck" },
  { value: "RGN",        label: "Removable Gooseneck (RGN)", group: "Open-Deck" },
  { value: "CONESTOGA",  label: "Conestoga",                 group: "Open-Deck" },
  { value: "TANKER",     label: "Tanker",                    group: "Specialized" },
  { value: "CAR_HAULER", label: "Car Hauler",                group: "Specialized" },
  { value: "POWER_ONLY", label: "Power Only",                group: "Specialized" },
];

const FREIGHT_FORMATS = [
  { value: "PALLETIZED",  label: "Palletized" },
  { value: "FLOOR_LOADED",label: "Floor-loaded" },
  { value: "CRATED",      label: "Crated" },
  { value: "DRIVE_ON",    label: "Drive-on (vehicles/machinery)" },
  { value: "LIQUID_BULK", label: "Liquid / Bulk" },
];

export default function PostLoad() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  // Multi-select accepted equipment types
  const [acceptedTypes, setAcceptedTypes] = useState<string[]>(["DRY_VAN"]);
  const toggleType = (v: string) =>
    setAcceptedTypes((p) => p.includes(v) ? (p.length > 1 ? p.filter((x) => x !== v) : p) : [...p, v]);

  // Facility profiles
  const [pickupFacility, setPickupFacility] = useState({ dockAvailable: true, forkliftAvailable: true, freightFormat: "PALLETIZED" });
  const [deliveryFacility, setDeliveryFacility] = useState({ dockAvailable: true, forkliftAvailable: true, freightFormat: "PALLETIZED" });

  const [form, setForm] = useState({
    origin: "100 W Randolph St, Chicago, IL 60601",
    destination: "",
    weightLbs: "28400",
    dimLengthIn: "",
    dimWidthIn: "",
    dimHeightIn: "",
    ratePerMile: "2.85",
    totalMiles: "355",
    notes: "",
    radiusMiles: "100",
    minMcMaturity: "0",
    minInsurance: "1",
    pickupTime: "",
    tempRequiredMin: "",
    tempRequiredMax: "",
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const totalPayout = (Number(form.ratePerMile) * Number(form.totalMiles)).toFixed(2);
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const refNo = `REF-${Date.now()}`;
      const draft = await api.createLoadDraft({
        referenceNumber: refNo,
        equipmentType: acceptedTypes[0],
        acceptedEquipmentTypes: acceptedTypes,
        loadSize: "FULL",
        pickupFacility,
        deliveryFacility,
        ...(form.tempRequiredMin && { tempRequiredMin: Number(form.tempRequiredMin) }),
        ...(form.tempRequiredMax && { tempRequiredMax: Number(form.tempRequiredMax) }),
        totalWeightLbs: Number(form.weightLbs),
        dimLengthIn: form.dimLengthIn ? Number(form.dimLengthIn) : undefined,
        dimWidthIn: form.dimWidthIn ? Number(form.dimWidthIn) : undefined,
        dimHeightIn: form.dimHeightIn ? Number(form.dimHeightIn) : undefined,
        loadVolumeCuIn: (form.dimLengthIn && form.dimWidthIn && form.dimHeightIn)
          ? Number(form.dimLengthIn) * Number(form.dimWidthIn) * Number(form.dimHeightIn)
          : undefined,
        pickupCity: "Chicago",
        pickupState: "IL",
        pickupZip: "60601",
        pickupAddress: form.origin,
        pickupLat: 41.8839,
        pickupLng: -87.6319,
        pickupDate: tomorrow,
        pickupTime: form.pickupTime || "09:00",
        pickupType: "FCFS",
        pickupInstructions: form.notes,
        deliveryCity: form.destination.split(",")[0]?.trim() || "Indianapolis",
        deliveryState: form.destination.split(",")[1]?.trim() || "IN",
        deliveryZip: "46201",
        deliveryAddress: form.destination || "100 S Capitol Ave, Indianapolis, IN 46201",
        deliveryLat: 39.7684,
        deliveryLng: -86.1581,
        deliveryDate: tomorrow,
        deliveryTime: "17:00",
        deliveryType: "LIVE_UNLOAD",
        totalMiles: Number(form.totalMiles),
        rateAmount: Number(form.ratePerMile),
        rateType: "PER_MILE",
        paymentTerms: "QUICK_PAY",
        commodityDescription: "General freight",
        stackable: true,
        fragile: false,
        highValue: false,
        hazmat: false,
        minMcMaturityDays: Number(form.minMcMaturity) * 30,
        minCargoInsurance: Number(form.minInsurance) * 1_000_000,
        minLiabilityInsurance: 500_000,
        requiredEndorsements: [],
        experienceRequired: 1,
        broadcastRadiusMiles: Number(form.radiusMiles),
        offerTtlMinutes: 60,
      });

      await api.submitLoad(draft.load.loadId);
      toast.success("Load broadcasting", { description: `${refNo} · drivers being notified` });
      navigate("/shipper");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Shipper"
        title="Post a new load"
        subtitle="Submit triggers an instant broadcast to drivers who meet your eligibility rules."
        actions={<Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Route">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Origin address">
                <Input value={form.origin} onChange={(e) => set("origin", e.target.value)} />
              </Field>
              <Field label="Destination city, state">
                <Input placeholder="e.g. Indianapolis, IN" value={form.destination} onChange={(e) => set("destination", e.target.value)} />
              </Field>
              <Field label="Pickup time">
                <Input type="time" value={form.pickupTime} onChange={(e) => set("pickupTime", e.target.value)} />
              </Field>
              <Field label="Total miles">
                <Input type="number" value={form.totalMiles} onChange={(e) => set("totalMiles", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Freight">
            {/* Multi-select equipment types (spec §11.2) */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Accepted Equipment Type(s) — select all that fit your load</Label>
              <div className="space-y-1">
                {["Enclosed", "Open-Deck", "Specialized"].map((group) => (
                  <div key={group}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 mt-2">{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {ALL_TRAILER_TYPES.filter((t) => t.group === group).map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => toggleType(t.value)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            acceptedTypes.includes(t.value)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-secondary text-foreground hover:bg-secondary/80"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {acceptedTypes.includes("REEFER") && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Field label="Min temp required (°F)">
                    <Input type="number" placeholder="-20" value={form.tempRequiredMin} onChange={(e) => set("tempRequiredMin", e.target.value)} />
                  </Field>
                  <Field label="Max temp required (°F)">
                    <Input type="number" placeholder="40" value={form.tempRequiredMax} onChange={(e) => set("tempRequiredMax", e.target.value)} />
                  </Field>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Field label="Total weight (lbs)">
                <Input type="number" value={form.weightLbs} onChange={(e) => set("weightLbs", e.target.value)} />
              </Field>
              <Field label="Rate per mile ($)">
                <Input type="number" step="0.01" value={form.ratePerMile} onChange={(e) => set("ratePerMile", e.target.value)} />
              </Field>
            </div>

            {/* Load dimensions for volume matching */}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Load Dimensions (inches) — optional, enables volume matching</p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Length (in)" id="dimL">
                  <Input id="dimL" type="number" placeholder="e.g. 96" value={form.dimLengthIn} onChange={(e) => set("dimLengthIn", e.target.value)} />
                </Field>
                <Field label="Width (in)" id="dimW">
                  <Input id="dimW" type="number" placeholder="e.g. 48" value={form.dimWidthIn} onChange={(e) => set("dimWidthIn", e.target.value)} />
                </Field>
                <Field label="Height (in)" id="dimH">
                  <Input id="dimH" type="number" placeholder="e.g. 60" value={form.dimHeightIn} onChange={(e) => set("dimHeightIn", e.target.value)} />
                </Field>
              </div>
              {form.dimLengthIn && form.dimWidthIn && form.dimHeightIn && (
                <p className="text-xs text-muted-foreground">
                  Load volume: <span className="font-medium text-foreground">
                    {((Number(form.dimLengthIn) * Number(form.dimWidthIn) * Number(form.dimHeightIn)) / 1728).toFixed(1)} cu ft
                  </span>
                </p>
              )}
            </div>

            {/* Facility profiles → drives derived loading requirements (spec §11.2–11.3) */}
            <div className="mt-4 space-y-4">
              {[
                { label: "Pickup facility", state: pickupFacility, setState: setPickupFacility },
                { label: "Delivery facility", state: deliveryFacility, setState: setDeliveryFacility },
              ].map(({ label, state, setState }) => (
                <div key={label} className="rounded-xl border border-border p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { key: "dockAvailable",    label: "Dock available" },
                      { key: "forkliftAvailable", label: "Forklift on site" },
                    ].map(({ key, label: lbl }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={!!(state as any)[key]}
                          onChange={(e) => setState((p: any) => ({ ...p, [key]: e.target.checked }))}
                        />
                        {lbl}
                      </label>
                    ))}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Freight format</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {FREIGHT_FORMATS.map((f) => (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => setState((p: any) => ({ ...p, freightFormat: f.value }))}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                            state.freightFormat === f.value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-secondary hover:bg-secondary/80"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {/* Show derived requirements as a confirmation hint */}
              {(() => {
                const reqs: string[] = [];
                if (!pickupFacility.dockAvailable && !pickupFacility.forkliftAvailable &&
                    pickupFacility.freightFormat !== "DRIVE_ON" && pickupFacility.freightFormat !== "LIQUID_BULK")
                  reqs.push("Liftgate required at pickup");
                if (!deliveryFacility.dockAvailable && !deliveryFacility.forkliftAvailable &&
                    deliveryFacility.freightFormat !== "DRIVE_ON" && deliveryFacility.freightFormat !== "LIQUID_BULK")
                  reqs.push("Liftgate required at delivery");
                if (pickupFacility.freightFormat === "DRIVE_ON" || deliveryFacility.freightFormat === "DRIVE_ON")
                  reqs.push("RGN or Car Hauler required");
                if (pickupFacility.freightFormat === "LIQUID_BULK" || deliveryFacility.freightFormat === "LIQUID_BULK")
                  reqs.push("Tanker required");
                if (!reqs.length) return null;
                return (
                  <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>System will require: {reqs.join(" · ")}</span>
                  </div>
                );
              })()}
            </div>

            <div className="mt-4">
              <Field label="Notes for driver">
                <Textarea rows={3} placeholder="Dock number, lift gate, check-in instructions…" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Pricing">
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Rate per mile"><Input type="number" step="0.01" value={form.ratePerMile} onChange={(e) => set("ratePerMile", e.target.value)} /></Field>
              <Field label="Total miles"><Input type="number" value={form.totalMiles} onChange={(e) => set("totalMiles", e.target.value)} /></Field>
              <Field label="Total payout"><Input value={`$${totalPayout}`} disabled /></Field>
            </div>
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Broadcast rules">
            <div className="space-y-4">
              <Field label="Radius (miles)"><Input type="number" value={form.radiusMiles} onChange={(e) => set("radiusMiles", e.target.value)} /></Field>
              <Field label="Min MC maturity (months)"><Input type="number" value={form.minMcMaturity} onChange={(e) => set("minMcMaturity", e.target.value)} /></Field>
              <Field label="Min insurance ($M)"><Input type="number" step="0.5" value={form.minInsurance} onChange={(e) => set("minInsurance", e.target.value)} /></Field>
            </div>
          </Section>

          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-sm">
            <div className="flex items-center gap-2 font-semibold text-primary"><Radio className="h-4 w-4" /> Estimated reach</div>
            <p className="mt-2 text-muted-foreground text-xs">
              Drivers within <span className="font-semibold text-foreground">{form.radiusMiles} miles</span> matching your equipment and requirements will be notified instantly.
            </p>
          </div>

          <Button type="submit" className="w-full h-11" disabled={submitting}>
            {submitting ? "Broadcasting…" : "Submit & broadcast"}
          </Button>
        </aside>
      </form>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
