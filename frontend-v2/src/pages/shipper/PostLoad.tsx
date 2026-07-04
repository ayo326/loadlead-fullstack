import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info, Loader2, MapPin, Radio } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { RouteMapCard } from "@/components/RouteMapCard";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ShipperAccessorialAgreement } from "@/components/ShipperAccessorialAgreement";
import type { ShipperAccessorialAgreementValue } from "@/lib/api";
import { AttestationDialog, ATTESTATION_TEXT, ATTESTATION_VERSION } from "@/components/attestation/AttestationDialog";
import { toast } from "sonner";
import { Combobox, MultiCombobox, AsyncCombobox } from "@/components/ui/combobox";
import {
  useAccessorials,
  useEquipmentClasses,
  useHazmatClasses,
  useLoadModes,
  useServiceTypes,
  taxonomyApi,
  toAccessorialItems,
  toEquipmentItems,
  toHazmatItems,
  toModeItems,
  toServiceItems,
} from "@/services/taxonomy";

/**
 * Equipment-class code → legacy TrailerType enum (for backward compat with the
 * existing Load model). The backend also derives the reverse on writes, but the
 * legacy field still ships on the wire so existing consumers keep working.
 */
const CLASS_CODE_TO_TRAILER_TYPE: Record<string, string> = {
  V: "DRY_VAN", V48: "DRY_VAN", DOUBLES: "DRY_VAN",
  R: "REEFER", R48: "REEFER", RM: "REEFER", RBOX: "REEFER",
  F: "FLATBED", F53: "FLATBED", SD: "FLATBED", CN: "FLATBED", DECK: "FLATBED",
  RGN: "RGN", DD: "RGN", MX: "RGN", REMOVAL: "RGN",
  TF: "TANKER", TC: "TANKER", TFG: "TANKER", TR: "TANKER", PN: "TANKER", HB: "TANKER",
  CH: "CAR_HAULER", CHE: "CAR_HAULER",
  CHS: "DRY_VAN", CHS20: "DRY_VAN", CHS40: "DRY_VAN",
  DUMP: "FLATBED", LOG: "FLATBED", LIVE: "DRY_VAN",
  PO: "POWER_ONLY", POE: "POWER_ONLY",
  BOX26: "BOX_TRUCK", BOX24: "BOX_TRUCK", BOX16: "BOX_TRUCK",
  STEPVAN: "BOX_TRUCK", CARGOVAN: "BOX_TRUCK", SPRINTER: "BOX_TRUCK",
  HS: "FLATBED", HSE: "DRY_VAN",
};

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
  // Holds the draft loadId once the form passes validation+create; opens
  // the BOL_SUBMIT attestation dialog. Cleared on cancel or after broadcast.
  const [pendingDraft, setPendingDraft] = useState<{ loadId: string; refNo: string } | null>(null);


  const [geocoding, setGeocoding] = useState<"pickup" | "delivery" | null>(null);

  // ─── Taxonomy-driven selectors ───────────────────────────────────────────
  // Equipment is a multi-select of *class codes* (from /api/reference/equipment-classes).
  // Acceptable codes: ["V", "R", "F", "BOX26", ...]. The submit step also derives the
  // legacy TrailerType from the first selected class so existing consumers keep working.
  const [equipmentClasses, setEquipmentClasses] = useState<string[]>(["V"]);
  const [equipmentModel, setEquipmentModel]     = useState<{ value: string; label: string } | null>(null);

  // Orthogonal load-type fields (spec §2)
  const [mode, setMode]                   = useState<string | null>("FTL");
  const [serviceType, setServiceType]     = useState<string | null>("STANDARD");
  const [accessorials, setAccessorials]   = useState<string[]>([]);
  const [commodity, setCommodity]         = useState<{ value: string; label: string } | null>(null);
  const [isHazmat, setIsHazmat]           = useState<boolean>(false);
  const [hazmatClass, setHazmatClass]     = useState<string | null>(null);
  const [accAgreement, setAccAgreement]   = useState<ShipperAccessorialAgreementValue>({ agreed: false });

  // Reference data
  const eqClasses = useEquipmentClasses();
  const modes     = useLoadModes();
  const services  = useServiceTypes();
  const access    = useAccessorials();
  const hazmat    = useHazmatClasses();

  const equipmentItems   = useMemo(() => eqClasses.data ? toEquipmentItems(eqClasses.data) : [], [eqClasses.data]);
  const modeItems        = useMemo(() => modes.data     ? toModeItems(modes.data)         : [], [modes.data]);
  const serviceItems     = useMemo(() => services.data  ? toServiceItems(services.data)   : [], [services.data]);
  const accessorialItems = useMemo(() => access.data    ? toAccessorialItems(access.data) : [], [access.data]);
  const hazmatItems      = useMemo(() => hazmat.data    ? toHazmatItems(hazmat.data)      : [], [hazmat.data]);

  // Equipment-class-aware UI hints
  const requiresTempControl = equipmentClasses.some(c => {
    const cls = eqClasses.data?.find(x => x.code === c);
    return cls?.attributes.temperature_controlled === "Y";
  });

  // Facility profiles
  const [pickupFacility, setPickupFacility] = useState({ dockAvailable: true, forkliftAvailable: true, freightFormat: "PALLETIZED" });
  const [deliveryFacility, setDeliveryFacility] = useState({ dockAvailable: true, forkliftAvailable: true, freightFormat: "PALLETIZED" });

  const [pickup, setPickup] = useState<AddressFields>(emptyAddress());
  const [delivery, setDelivery] = useState<AddressFields>(emptyAddress());

  // Geocoded coordinates (set after successful geocoding)
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [form, setForm] = useState({
    // commodityNotes is genuine free text (special handling notes); the
    // canonical commodity code lives in `commodity` state above.
    commodityNotes: "",
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

  // Auto-estimate Total miles once both addresses are geocoded. Uses haversine
  // great-circle distance + a 1.2x road-meander factor — within ~5% of
  // Google Distance Matrix for most US lanes, and avoids an extra round-trip
  // before the load is submitted. The backend's RoutingService still overwrites
  // this with the real driving distance during enrichment, so this is purely a
  // UX hint while the operator is still typing the load.
  useEffect(() => {
    if (!pickupCoords || !deliveryCoords) return;
    const R = 3958.8; // Earth radius in miles
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(deliveryCoords.lat - pickupCoords.lat);
    const dLng = toRad(deliveryCoords.lng - pickupCoords.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(pickupCoords.lat)) *
        Math.cos(toRad(deliveryCoords.lat)) *
        Math.sin(dLng / 2) ** 2;
    const greatCircle = 2 * R * Math.asin(Math.sqrt(a));
    const estimated = Math.round(greatCircle * 1.2);
    if (estimated > 0) set("totalMiles", String(estimated));
    // We intentionally don't depend on form.totalMiles so the estimate
    // refreshes whenever an operator re-verifies an address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupCoords?.lat, pickupCoords?.lng, deliveryCoords?.lat, deliveryCoords?.lng]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields client-side before geocoding
    if (!commodity?.value) {
      toast.error("Pick a commodity from the list");
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

      // Translate selected class codes to legacy TrailerType for backward
      // compat; the backend also persists equipment_required from the new shape.
      const legacyAccepted = Array.from(new Set(
        equipmentClasses.map(c => CLASS_CODE_TO_TRAILER_TYPE[c]).filter(Boolean),
      ));

      const draft = await api.createLoadDraft({
        referenceNumber: refNo,
        equipmentType: legacyAccepted[0] ?? "DRY_VAN",
        acceptedEquipmentTypes: legacyAccepted,
        loadSize: mode === "PARTIAL" ? "PARTIAL" : mode === "LTL" ? "LTL" : "FULL",
        // ─── orthogonal load-type fields (spec §2-§3) ───
        equipment_required: equipmentClasses[0],
        equipment_model:    equipmentModel?.value,
        mode:               (mode ?? undefined) as any,
        service_type:       (serviceType ?? undefined) as any,
        commodity:          commodity?.value,
        accessorials,
        characteristics: {
          temperature_required: !!(form.tempRequiredMin || form.tempRequiredMax),
          ...(form.tempRequiredMin ? { min_temp: Number(form.tempRequiredMin) } : {}),
          ...(form.tempRequiredMax ? { max_temp: Number(form.tempRequiredMax) } : {}),
          hazmat: isHazmat,
          ...(hazmatClass ? { hazmat_class: hazmatClass } : {}),
        },
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
        commodityDescription: form.commodityNotes || commodity?.label || "",
        stackable:  false,
        fragile:    false,
        highValue:  false,
        hazmat:     isHazmat,
        ...(hazmatClass ? { hazmatClass } : {}),
        minMcMaturityDays:     Number(form.minMcMaturity) * 30,
        minCargoInsurance:     Number(form.minInsurance) * 1_000_000,
        minLiabilityInsurance: 500_000,
        requiredEndorsements:  [],
        experienceRequired:    1,
        broadcastRadiusMiles:  Number(form.radiusMiles),
        offerTtlMinutes:       60,
        // Shipper detention/layover agreement. Freezes the policy snapshot and
        // records an append-only agreement; ignored by the Load model itself.
        accessorial: {
          agreed: accAgreement.agreed,
          ...(accAgreement.override ? { override: accAgreement.override } : {}),
        },
      });

      // Phase-1 attestation gate: open the BOL_SUBMIT attestation block.
      // The server rejects submitLoad with 412 BOL_SUBMIT_SIGNATURE_REQUIRED
      // until the signature lands in the chain — so we capture it BEFORE
      // calling submitLoad. Cancelling leaves the load in DRAFT, safe.
      setPendingDraft({ loadId: draft.load.loadId, refNo });
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

          {/* ── Load type (Equipment & Load Type Taxonomy spec §2-§3) ───── */}
          <div data-tour="post-load-type">
          <Section title="Load type">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Load mode *">
                <Combobox items={modeItems}    value={mode}        onChange={setMode}        placeholder="Mode…" />
              </Field>
              <Field label="Service type *">
                <Combobox items={serviceItems} value={serviceType} onChange={setServiceType} placeholder="Service…" />
              </Field>
            </div>

            <Field label="Accepted equipment class(es) *" className="mt-4">
              <MultiCombobox
                items={equipmentItems}
                value={equipmentClasses}
                onChange={setEquipmentClasses}
                placeholder="Pick one or more equipment classes…"
              />
            </Field>

            <Field label="Preferred equipment model (optional)" className="mt-4">
              <AsyncCombobox
                value={equipmentModel}
                onChange={setEquipmentModel}
                disabled={!equipmentClasses[0]}
                placeholder={equipmentClasses[0] ? "Search models…" : "Pick an equipment class first"}
                fetchItems={async (q) => {
                  if (!equipmentClasses[0]) return [];
                  const items = await taxonomyApi.searchEquipmentModels(equipmentClasses[0], q || "", 25);
                  return items.map(it => ({
                    value: `${it.manufacturer}::${it.model}`,
                    label: it.model,
                    group: it.manufacturer,
                  }));
                }}
              />
            </Field>

            {requiresTempControl && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Field label="Min temp (°F)">
                  <Input type="number" placeholder="-20" value={form.tempRequiredMin} onChange={(e) => set("tempRequiredMin", e.target.value)} />
                </Field>
                <Field label="Max temp (°F)">
                  <Input type="number" placeholder="40" value={form.tempRequiredMax} onChange={(e) => set("tempRequiredMax", e.target.value)} />
                </Field>
              </div>
            )}
          </Section>

          </div>

          {/* ── Freight ───────────────────────────────────────────────────── */}
          <div data-tour="post-commodity">
          <Section title="Freight">
            <Field label="Commodity *">
              <AsyncCombobox
                value={commodity}
                onChange={setCommodity}
                placeholder="Search commodities (e.g. produce, fuel, steel)…"
                fetchItems={async (q) => {
                  const r = await taxonomyApi.searchCommodities(q || "", 30);
                  const catNames = Object.fromEntries(r.categories.map(c => [c.code, c.name]));
                  return r.items.map(c => ({
                    value: c.code,
                    label: c.name,
                    group: catNames[c.category] ?? c.category,
                    hint:  c.code,
                  }));
                }}
              />
            </Field>

            <Field label="Commodity handling notes (optional)" className="mt-4">
              <Textarea
                placeholder="Anything genuinely freeform — handling instructions, stacking notes, etc."
                value={form.commodityNotes}
                onChange={(e) => set("commodityNotes", e.target.value)}
                rows={2}
              />
            </Field>

            <Field label="Accessorials" className="mt-4">
              <MultiCombobox
                items={accessorialItems}
                value={accessorials}
                onChange={setAccessorials}
                placeholder="Add accessorials (detention, lumper, tarping…)"
              />
            </Field>

            <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isHazmat} onCheckedChange={(v) => { setIsHazmat(!!v); if (!v) setHazmatClass(null); }} />
                <span>Hazmat load</span>
              </label>
              {isHazmat && (
                <Field label="Hazmat class *">
                  <Combobox
                    items={hazmatItems}
                    value={hazmatClass}
                    onChange={setHazmatClass}
                    placeholder="Pick a DOT hazard class…"
                  />
                </Field>
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
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="space-y-6">
          {/* Route preview — same frame as other sidebar Sections. Shows a
              directions embed once both addresses are typed (re-uses the
              same RouteMapCard the shipper LoadDetail uses). Clicking the
              🔍 icon opens the existing fullscreen modal for zoom. */}
          <Section title="Route preview">
            {/* V6: only pass a composed address when it is actually complete
                (street + city + state), and no current-city fallback here, so the
                preview shows the neutral placeholder until BOTH ends resolve
                instead of a zoomed-out world map. */}
            <RouteMapCard
              pickupAddress={pickup?.street && pickup?.city && pickup?.state ? `${pickup.street}, ${pickup.city}, ${pickup.state} ${pickup.zip ?? ""}`.trim() : null}
              deliveryAddress={delivery?.street && delivery?.city && delivery?.state ? `${delivery.street}, ${delivery.city}, ${delivery.state} ${delivery.zip ?? ""}`.trim() : null}
              currentCity={null}
              currentState={null}
              mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
            />
          </Section>

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

          <div className="rounded-md border border-primary/30 bg-primary/5 p-5 text-sm">
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

          <ShipperAccessorialAgreement
            equipmentType={CLASS_CODE_TO_TRAILER_TYPE[equipmentClasses[0]] ?? "DRY_VAN"}
            hazmat={isHazmat}
            value={accAgreement}
            onChange={setAccAgreement}
          />

          <Button type="submit" className="w-full h-11" disabled={submitting || !accAgreement.agreed}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Broadcasting…</>
            ) : !accAgreement.agreed ? "Agree to the terms to post" : "Submit & broadcast"}
          </Button>
        </aside>
      </form>

      {/* BOL_SUBMIT attestation — captured BEFORE submit. Server gate
          rejects submitLoad without this signature; we only call it
          after the AttestationDialog reports success. */}
      <AttestationDialog
        open={pendingDraft !== null}
        onOpenChange={(open) => { if (!open) setPendingDraft(null); }}
        title="Sign tender to broadcast"
        subtitle={pendingDraft ? `${pendingDraft.refNo} · draft saved · broadcast requires your signed attestation.` : undefined}
        loadId={pendingDraft?.loadId ?? ""}
        action="BOL_SUBMIT"
        attestationText={ATTESTATION_TEXT.BOL_SUBMIT}
        attestationVersion={ATTESTATION_VERSION}
        stage="ORIGIN"
        requirePhotos={false}
        onSigned={async (sig) => {
          if (!pendingDraft) return;
          try {
            await api.submitLoad(pendingDraft.loadId);
            toast.success("Load broadcasting", {
              description: `${pendingDraft.refNo} · attestation ${sig.signatureId.slice(0, 8)}…`,
            });
            setPendingDraft(null);
            navigate("/shipper");
          } catch (e: any) {
            toast.error(e?.message ?? "Broadcast failed");
          }
        }}
      />
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
          <AddressAutocomplete
            placeholder="e.g. 100 W Randolph St"
            value={values.street}
            required
            onChange={(v) => setField("street", v)}
            onSelect={(p) => {
              setField("street", p.street);
              if (p.city) setField("city", p.city);
              if (p.state) setField("state", p.state);
              if (p.zip) setField("zip", p.zip);
            }}
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
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="text-sm font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
