import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function PostLoad() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    equipment: "DRY_VAN",
    origin: "100 W Randolph St, Chicago, IL 60601",
    destination: "",
    weightLbs: "28400",
    ratePerMile: "2.85",
    totalMiles: "355",
    notes: "",
    radiusMiles: "100",
    minMcMaturity: "0",
    minInsurance: "1",
    pickupTime: "",
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
        equipmentType: form.equipment,
        loadSize: "FULL",
        totalWeightLbs: Number(form.weightLbs),
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
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Equipment">
                <Select value={form.equipment} onValueChange={(v) => set("equipment", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRY_VAN">Dry Van</SelectItem>
                    <SelectItem value="REEFER">Reefer</SelectItem>
                    <SelectItem value="FLATBED">Flatbed</SelectItem>
                    <SelectItem value="STEP_DECK">Step Deck</SelectItem>
                    <SelectItem value="BOX_TRUCK">Box Truck</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Total weight (lbs)">
                <Input type="number" value={form.weightLbs} onChange={(e) => set("weightLbs", e.target.value)} />
              </Field>
              <Field label="Rate per mile ($)">
                <Input type="number" step="0.01" value={form.ratePerMile} onChange={(e) => set("ratePerMile", e.target.value)} />
              </Field>
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
