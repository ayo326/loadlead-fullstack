import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock } from "lucide-react";
import { api, formatCents, type AccessorialDisclosureDTO, type AccessorialBoundsDTO, type ShipperAccessorialAgreementValue } from "@/lib/api";

function fmtMinutes(m: number): string {
  if (m % 60 === 0) { const h = m / 60; return `${h} hour${h === 1 ? "" : "s"}`; }
  return `${m} minutes`;
}
const RATE_CLASS_LABEL: Record<string, string> = { STANDARD: "standard", SPECIALIZED: "specialized", HAZMAT: "hazmat" };

/**
 * Shipper's detention/layover confirmation at load posting. Reads the prefilled
 * rate card for the load's freight class (derived from equipment + hazmat), lets
 * the shipper adjust the terms through the per-load override within bounds, and
 * captures an agreement. What they agree to is frozen onto the load as the same
 * snapshot the carrier later sees and acknowledges. Payer framing throughout.
 */
export function ShipperAccessorialAgreement({
  equipmentType,
  hazmat,
  value,
  onChange,
}: {
  equipmentType: string;
  hazmat: boolean;
  value: ShipperAccessorialAgreementValue;
  onChange: (v: ShipperAccessorialAgreementValue) => void;
}) {
  const [base, setBase] = useState<AccessorialDisclosureDTO | null>(null);
  const [bounds, setBounds] = useState<AccessorialBoundsDTO | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  // edit state in display units (dollars, minutes)
  const [detentionUsd, setDetentionUsd] = useState("");
  const [freeMin, setFreeMin] = useState("");
  const [layoverUsd, setLayoverUsd] = useState("");

  useEffect(() => {
    let live = true;
    api.accessorials.rateCard(equipmentType || "DRY_VAN", hazmat)
      .then((r) => {
        if (!live) return;
        setBase(r.disclosure); setBounds(r.bounds);
        setDetentionUsd((r.disclosure.detentionHourlyRateCents / 100).toString());
        setFreeMin(String(r.disclosure.freeTimeMinutes));
        setLayoverUsd((r.disclosure.layoverDailyRateCents / 100).toString());
        // a freight-class change resets any prior agreement/override
        onChange({ agreed: false });
        setAdjusting(false);
      })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentType, hazmat]);

  // Build the override patch from the edited values when adjusting.
  function emit(agreed: boolean, adjust: boolean) {
    if (!base) { onChange({ agreed }); return; }
    if (!adjust) { onChange({ agreed }); return; }
    const cents = Math.round(parseFloat(detentionUsd) * 100);
    const layoverCents = Math.round(parseFloat(layoverUsd) * 100);
    const free = parseInt(freeMin, 10);
    const override: ShipperAccessorialAgreementValue["override"] = {};
    if (Number.isFinite(cents)) override.detentionHourlyRateCents = { [base.rateClass]: cents };
    if (Number.isFinite(free)) override.freeTimeMinutes = free;
    if (Number.isFinite(layoverCents)) override.layoverDailyRateCents = layoverCents;
    onChange({ agreed, override });
  }

  if (!base || !bounds) return null;

  const detBound = bounds.detentionHourlyRateCents[base.rateClass];
  // Shown values reflect edits when adjusting, otherwise the prefill.
  const shownDetentionCents = adjusting ? Math.round((parseFloat(detentionUsd) || 0) * 100) : base.detentionHourlyRateCents;
  const shownFree = adjusting ? (parseInt(freeMin, 10) || 0) : base.freeTimeMinutes;
  const shownLayoverCents = adjusting ? Math.round((parseFloat(layoverUsd) || 0) * 100) : base.layoverDailyRateCents;

  return (
    <div className="rounded-md border border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Clock className="h-4 w-4 text-primary" /> Detention and layover terms
      </div>

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>The carrier gets {fmtMinutes(shownFree)} of free time at each stop before detention starts.</li>
        <li>
          After that you pay <span className="font-semibold text-foreground">{formatCents(shownDetentionCents)} per hour</span>,
          billed in {base.billingIncrementMinutes}-minute increments ({RATE_CLASS_LABEL[base.rateClass] ?? base.rateClass} freight).
        </li>
        <li>
          After {fmtMinutes(base.layoverThresholdMinutes)} of dwell it becomes layover at {formatCents(shownLayoverCents)} per day.
          Layover replaces detention rather than stacking.
        </li>
        <li>You pay only if the load is actually held, and only past the free window. The times come from the carrier's check-in and check-out.</li>
      </ul>

      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline"
        onClick={() => { const next = !adjusting; setAdjusting(next); emit(value.agreed, next); }}>
        {adjusting ? "Use the standard rate card" : "Adjust these terms"}
      </button>

      {adjusting && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Free time (minutes)</Label>
            <Input type="number" min={bounds.freeTimeMinutes.min} max={bounds.freeTimeMinutes.max}
              value={freeMin} onChange={(e) => { setFreeMin(e.target.value); emit(value.agreed, true); }} />
            <p className="text-[11px] text-muted-foreground">{bounds.freeTimeMinutes.min} to {bounds.freeTimeMinutes.max}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Detention ($/hour)</Label>
            <Input type="number" min={detBound.min / 100} max={detBound.max / 100}
              value={detentionUsd} onChange={(e) => { setDetentionUsd(e.target.value); emit(value.agreed, true); }} />
            <p className="text-[11px] text-muted-foreground">{formatCents(detBound.min)} to {formatCents(detBound.max)}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Layover ($/day)</Label>
            <Input type="number" min={bounds.layoverDailyRateCents.min / 100} max={bounds.layoverDailyRateCents.max / 100}
              value={layoverUsd} onChange={(e) => { setLayoverUsd(e.target.value); emit(value.agreed, true); }} />
            <p className="text-[11px] text-muted-foreground">{formatCents(bounds.layoverDailyRateCents.min)} to {formatCents(bounds.layoverDailyRateCents.max)}</p>
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <Checkbox checked={value.agreed} onCheckedChange={(v) => emit(v === true, adjusting)} className="mt-0.5" />
        <span>I agree to these detention and layover terms for this load.</span>
      </label>
    </div>
  );
}
