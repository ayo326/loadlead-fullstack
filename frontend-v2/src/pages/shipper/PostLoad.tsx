import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info, Loader2, MapPin, Radio } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  { value: "PALLETIZED",   label: "Palletized" },
  { value: "FLOOR_LOADED", label: "Floor-loaded" },
  { value: "CRATED",       label: "Crated" },
  { value: "DRIVE_ON",     label: "Drive-on (vehicles/machinery)" },
  { value: "LIQUID_BULK",  label: "Liquid / Bulk" },
];

// State code → name helper
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

interface AddressFields {
  street: string;
  city: string;
  state: string;
  zip: string;
}

const emptyAddress = (): AddressFields => ({ street: "", city: "", state: "", zip: "" });

export default function PostLoad() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [geocoding, setGeocoding] = useState<"pickup" | "delivery" | null>(null);

  // Equipment multi-select
  const [acceptedTypes, setAcceptedTypes] = useState<string[]>(["DRY_VAN"]);
  const toggleType = (v: string) =>
    setAcceptedTypes((p) => p.includes(v) ? (p.length > 1 ? p.filter((x) => x !== v) : p) : [...p, v]);

  // Facility profiles
  const [pickupFacility, setPickupFacility] = useState({ dockAvailable: true, forkliftAvailable: true, freightFormat: "PALLETIZED" });
  const [deliveryFacility, setDeliveryFacility] = useState({ dockAvailable: true, forkliftAvailable: true, freightFormat: "PALLETIZED" });

  const [pickup, setPickup] = useState<AddressFields>(emptyAddress());
  const [delivery, setDelivery] = useState<AddressFields>(emptyAddress());

  // Geocoded coordinates (set after successful geocoding)
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [form, setForm] = useState({
    commodityDescription: "",
    weightLbs: "",
    dimLengthIn: "",
    dimWidthIn: "",
    dimHeightIn: "",
    ratePerMile: "",
    totalMiles: "",
    notes: "",
    radiusMiles: "100",
    minMcMaturity: "0",
    minInsurance: "1",
    pickupDate: "",
    pickupTime: "09:00",
    deliveryDate: "",
    deliveryTime: "17:00",
    tempRequiredMin: "",
    tempRequiredMax: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // When address fields change, clear previously geocoded coords
  const setPickupField = (k: keyof AddressFields, v: string) => {
    setPickup((p) => ({ ...p, [k]: v }));
    setPickupCoords(null);
  };
  const setDeliveryField = (k: keyof AddressFields, v: string) => {
    setDelivery((p) => ({ ...p, [k]: v }));
    setDeliveryCoords(null);
  };

  /** Geocode an address via the backend proxy (key never exposed to browser). */
  async function geocodeAddress(
    addr: AddressFields,
    side: "pickup" | "delivery"
  ): Promise<{ lat: number; lng: number } | null> {
    const full = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`.trim();
    if (!full || !addr.street || !addr.city || !addr.state || !addr.zip) {
      toast.error(`Complete the full ${side} address before verifying`);
      return null;
    }
    setGeocoding(side);
    try {
      const result = await api.geocodeAddress(full);
      if (side === "pickup") setPickupCoords(result);
      else setDeliveryCoords(result);
      toast.success(`${side === "pickup" ? "Pickup" : "Delivery"} address verified ✓`);
      return result;
    } catch (err: any) {
      toast.error(`Could not geocode ${side} address: ${err.message}`);
      return null;
    } finally {
      setGeocoding(null);
    }
  }

  const totalPayout =
    form.ratePerMile && form.totalMiles
      ? `$${(Number(form.ratePerMile) * Number(form.totalMiles)).toFixed(2)}`
      : "—";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields client-side before geocoding
    if (!form.commodityDescription.trim()) {
      toast.error("Commodity description is required");
      return;
    }
    if (!form.pickupDate || !form.deliveryDate) {
      toast.error("Pickup and delivery dates are required");
      return;
    }
    if (new Date(form.deliveryDate) <= new Date(form.pickupDate)) {
      toast.error("Delivery date must be after pickup date");
      return;
    }
    if (!form.weightLbs || !form.ratePerMile) {
      toast.error("Weight and rate are required");
      return;
    }

    setSubmitting(true);
    try {
      // Geocode both addresses if not already done
      let pCoords = pickupCoords;
      let dCoords = deliveryCoords;

      if (!pCoords) {
        pCoords = await geocodeAddress(pickup, "pickup");
        if (!pCoords) { setSubmitting(false); return; }
      }
      if (!dCoords) {
        dCoords = await geocodeAddress(delivery, "delivery");
        if (!dCoords) { setSubmitting(false); return; }
      }

      const refNo = `REF-${Date.now()}`;
      const pickupDateMs = new Date(`${form.pickupDate}T${form.pickupTime || "09:00"}`).getTime();
      const deliveryDateMs = new Date(`${form.deliveryDate}T${form.deliveryTime || "17:00"}`).getTime();

      const pickupFullAddress = `${pickup.street}, ${pickup.city}, ${pickup.state} ${pickup.zip}`;
      const deliveryFullAddress = `${delivery.street}, ${delivery.city}, ${delivery.state} ${delivery.zip}`;

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
        dimWidthIn:  form.dimWidthIn  ? Number(form.dimWidthIn)  : undefined,
        dimHeightIn: form.dimHeightIn ? Number(form.dimHeightIn) : undefined,
        // Pickup
        pickupAddress: pickupFullAddress,
        pickupCity:    pickup.city,
        pickupState:   pickup.state,
        pickupZip:     pickup.zip,
        pickupLat:     pCoords.lat,
        pickupLng:     pCoords.lng,
        pickupDate:    pickupDateMs,
        pickupTime:    form.pickupTime || "09:00",
        pickupType:    "FCFS",
        pickupInstructions: form.notes,
        // Delivery
        deliveryAddress: deliveryFullAddress,
        deliveryCity:    delivery.city,
        deliveryState:   delivery.state,
        deliveryZip:     delivery.zip,
        deliveryLat:     dCoords.lat,
        deliveryLng:     dCoords.lng,
        deliveryDate:    deliveryDateMs,
        deliveryTime:    form.deliveryTime || "17:00",
        deliveryType:    "LIVE_UNLOAD",
        totalMiles:      form.totalMiles ? Number(form.totalMiles) : 0,
        rateAmount:      Number(form.ratePerMile),
        rateType:        "PER_MILE",
        paymentTerms:    "QUICK_PAY",
        commodityDescription: form.commodityDescription,
        stackable:  false,
        fragile:    false,
        highValue:  false,
        hazmat:     false,
        minMcMaturityDays:     Number(form.minMcMaturity) * 30,
        minCargoInsurance:     Number(form.minInsurance) * 1_000_000,
        minLiabilityInsurance: 500_000,
        requiredEndorsements:  [],
        experienceRequired:    1,
        broadcastRadiusMiles:  Number(form.radiusMiles),
        offerTtlMinutes:       60,
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
        actions={
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* ── Route ─────────────────────────────────────────────────────── */}
          <Section title="Pickup address">
            <AddressBlock
              values={pickup}
              setField={setPickupField}
              coords={pickupCoords}
              geocoding={geocoding === "pickup"}
              onGeocode={() => geocodeAddress(pickup, "pickup")}
              side="pickup"
            />
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Field label="Pickup date *">
                <Input type="date" value={form.pickupDate} onChange={(e) => set("pickupDate", e.target.value)} required />
              </Field>
              <Field label="Pickup time">
                <Input type="time" value={form.pickupTime} onChange={(e) => set("pickupTime", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Delivery address">
            <AddressBlock
              values={delivery}
              setField={setDeliveryField}
              coords={deliveryCoords}
              geocoding={geocoding === "delivery"}
              onGeocode={() => geocodeAddress(delivery, "delivery")}
              side="delivery"
            />
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Field label="Delivery date *">
                <Input type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} required />
              </Field>
              <Field label="Delivery time">
                <Input type="time" value={form.deliveryTime} onChange={(e) => set("deliveryTime", e.target.value)} />
              </Field>
            </div>
          </Section>

          {/* ── Freight ───────────────────────────────────────────────────── */}
          <Section title="Freight">
            <Field label="Commodity description *">
              <Input
                placeholder="e.g. Steel coils, 48 pallets of electronics, lumber…"
                value={form.commodityDescription}
                onChange={(e) => set("commodityDescription", e.target.value)}
                required
              />
            </Field>

            {/* Equipment multi-select */}
            <div className="space-y-2 mt-4">
              <Label className="text-xs text-muted-foreground">Accepted Equipment Type(s)</Label>
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
              {acceptedTypes.includes("REEFER") && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Field label="Min temp (°F)">
                    <Input type="number" placeholder="-20" value={form.tempRequiredMin} onChange={(e) => set("tempRequiredMin", e.target.value)} />
                  </Field>
                  <Field label="Max temp (°F)">
                    <Input type="number" placeholder="40" value={form.tempRequiredMax} onChange={(e) => set("tempRequiredMax", e.target.value)} />
                  </Field>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Field label="Total weight (lbs) *">
                <Input type="number" placeholder="28400" value={form.weightLbs} onChange={(e) => set("weightLbs", e.target.value)} required />
              </Field>
              <Field label="Rate per mile ($) *">
                <Input type="number" step="0.01" placeholder="2.85" value={form.ratePerMile} onChange={(e) => set("ratePerMile", e.target.value)} required />
              </Field>
            </div>

            {/* Dimensions */}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Load Dimensions (inches) — optional</p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Length (in)">
                  <Input type="number" placeholder="96" value={form.dimLengthIn} onChange={(e) => set("dimLengthIn", e.target.value)} />
                </Field>
                <Field label="Width (in)">
                  <Input type="number" placeholder="48" value={form.dimWidthIn} onChange={(e) => set("dimWidthIn", e.target.value)} />
                </Field>
                <Field label="Height (in)">
                  <Input type="number" placeholder="60" value={form.dimHeightIn} onChange={(e) => set("dimHeightIn", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Facility profiles */}
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
            </div>

            <div className="mt-4">
              <Field label="Driver notes">
                <Textarea rows={3} placeholder="Dock number, lift gate required, check-in instructions…" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </div>
          </Section>

          {/* ── Pricing summary ───────────────────────────────────────────── */}
          <Section title="Pricing">
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Rate per mile ($)">
                <Input type="number" step="0.01" placeholder="2.85" value={form.ratePerMile} onChange={(e) => set("ratePerMile", e.target.value)} />
              </Field>
              <Field label="Total miles (est.)">
                <Input type="number" placeholder="355" value={form.totalMiles} onChange={(e) => set("totalMiles", e.target.value)} />
              </Field>
              <Field label="Estimated payout">
                <Input value={totalPayout} disabled className="font-semibold" />
              </Field>
            </div>
          </Section>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="space-y-6">
          <Section title="Broadcast rules">
            <div className="space-y-4">
              <Field label="Radius (miles)">
                <Input type="number" value={form.radiusMiles} onChange={(e) => set("radiusMiles", e.target.value)} />
              </Field>
              <Field label="Min MC maturity (months)">
                <Input type="number" value={form.minMcMaturity} onChange={(e) => set("minMcMaturity", e.target.value)} />
              </Field>
              <Field label="Min insurance ($M)">
                <Input type="number" step="0.5" value={form.minInsurance} onChange={(e) => set("minInsurance", e.target.value)} />
              </Field>
            </div>
          </Section>

          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-sm">
            <div className="flex items-center gap-2 font-semibold text-primary">
              <Radio className="h-4 w-4" /> Estimated reach
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              Drivers within <span className="font-semibold text-foreground">{form.radiusMiles} miles</span> of the
              pickup address matching your equipment and requirements will be notified instantly.
            </p>
            {pickupCoords && (
              <p className="mt-2 text-[11px] text-green-600 dark:text-green-400 font-medium">
                ✓ Pickup coords locked: {pickupCoords.lat.toFixed(4)}, {pickupCoords.lng.toFixed(4)}
              </p>
            )}
            {deliveryCoords && (
              <p className="text-[11px] text-green-600 dark:text-green-400 font-medium">
                ✓ Delivery coords locked: {deliveryCoords.lat.toFixed(4)}, {deliveryCoords.lng.toFixed(4)}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full h-11" disabled={submitting}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Broadcasting…</>
            ) : "Submit & broadcast"}
          </Button>
        </aside>
      </form>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AddressBlock({
  values, setField, coords, geocoding, onGeocode, side,
}: {
  values: AddressFields;
  setField: (k: keyof AddressFields, v: string) => void;
  coords: { lat: number; lng: number } | null;
  geocoding: boolean;
  onGeocode: () => void;
  side: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-1 gap-3">
        <Field label="Street address *">
          <Input
            placeholder="e.g. 100 W Randolph St"
            value={values.street}
            onChange={(e) => setField("street", e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-3">
          <Field label="City *">
            <Input placeholder="Chicago" value={values.city} onChange={(e) => setField("city", e.target.value)} required />
          </Field>
        </div>
        <div className="col-span-1">
          <Field label="State *">
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={values.state}
              onChange={(e) => setField("state", e.target.value)}
              required
            >
              <option value="">—</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="ZIP *">
            <Input placeholder="60601" value={values.zip} onChange={(e) => setField("zip", e.target.value)} required />
          </Field>
        </div>
      </div>

      {/* Verify / geocode button */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant={coords ? "default" : "outline"}
          size="sm"
          onClick={onGeocode}
          disabled={geocoding}
          className="gap-1.5"
        >
          {geocoding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
          {coords ? "Re-verify address" : `Verify ${side} address`}
        </Button>
        {coords && (
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✓ {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </span>
        )}
      </div>
    </div>
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

function Field({ label, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
