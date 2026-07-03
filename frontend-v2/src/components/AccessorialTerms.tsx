import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, Loader2 } from "lucide-react";
import { api, formatCents, type AccessorialDisclosureDTO } from "@/lib/api";
import { toast } from "sonner";

// Whole minutes to plain language, e.g. 120 -> "2 hours", 90 -> "90 minutes".
function fmtMinutes(m: number): string {
  if (m % 60 === 0) { const h = m / 60; return `${h} hour${h === 1 ? "" : "s"}`; }
  return `${m} minutes`;
}
const RATE_CLASS_LABEL: Record<string, string> = { STANDARD: "standard", SPECIALIZED: "specialized", HAZMAT: "hazmat" };

/**
 * Compact detention/layover terms for the offer/detail view. Read from the load's
 * policy snapshot; shows the single freight-class detention rate, free time, and
 * layover terms so the carrier sees them before deciding to claim.
 */
export function AccessorialTermsSummary({ loadId }: { loadId: string }) {
  const [d, setD] = useState<AccessorialDisclosureDTO | null>(null);
  useEffect(() => {
    let live = true;
    api.accessorials.getPolicy(loadId).then((r) => { if (live) setD(r.disclosure); }).catch(() => {});
    return () => { live = false; };
  }, [loadId]);

  if (!d) return null;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <Clock className="h-4 w-4 text-primary" /> Detention and layover terms
      </div>
      <ul className="space-y-0.5 text-muted-foreground">
        <li>{fmtMinutes(d.freeTimeMinutes)} free per stop, then {formatCents(d.detentionHourlyRateCents)} per hour ({RATE_CLASS_LABEL[d.rateClass] ?? d.rateClass})</li>
        <li>Layover after {fmtMinutes(d.layoverThresholdMinutes)}: {formatCents(d.layoverDailyRateCents)} per day</li>
      </ul>
    </div>
  );
}

/**
 * Disclosure and acknowledgment modal shown when the carrier moves to accept a
 * load. Shows the load-specific terms from the policy snapshot, requires an
 * acknowledgment, and on accept records the e-sign policy acceptance plus the
 * acknowledgment (append-only) before onAccepted proceeds. Backing out writes
 * nothing.
 */
export function AccessorialDisclosureModal({
  loadId,
  open,
  onOpenChange,
  onAccepted,
}: {
  loadId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAccepted: () => void;
}) {
  const [d, setD] = useState<AccessorialDisclosureDTO | null>(null);
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setAck(false); return; }
    setD(null);
    api.accessorials.getPolicy(loadId).then((r) => setD(r.disclosure)).catch(() => toast.error("Could not load the terms"));
  }, [open, loadId]);

  async function accept() {
    if (!ack) return;
    setSaving(true);
    try {
      // Records the e-sign policy acceptance and the acknowledgment on one row.
      await api.accessorials.acceptPolicy(loadId, true);
      onOpenChange(false);
      onAccepted();
    } catch (e: any) {
      toast.error(e.message ?? "Could not record your acknowledgment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Detention and layover terms</DialogTitle>
          <DialogDescription>Please review these terms for this load before you accept.</DialogDescription>
        </DialogHeader>

        {!d ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <ul className="space-y-2">
              <li>You get {fmtMinutes(d.freeTimeMinutes)} of free time at each stop before detention starts.</li>
              <li>
                After free time, detention is <span className="font-semibold text-foreground">{formatCents(d.detentionHourlyRateCents)} per hour</span>,
                billed in {d.billingIncrementMinutes}-minute increments (this is a {RATE_CLASS_LABEL[d.rateClass] ?? d.rateClass} freight rate).
              </li>
              <li>
                After {fmtMinutes(d.layoverThresholdMinutes)} of dwell it becomes layover at {formatCents(d.layoverDailyRateCents)} per day.
                Layover replaces detention rather than stacking on top of it.
              </li>
              <li>The shipper pays these charges and you keep 100 percent.</li>
              <li>Your check-in and check-out times are the record used to calculate them.</li>
            </ul>

            <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
              <span>I have reviewed and acknowledge these detention and layover terms.</span>
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Back</Button>
          <Button onClick={accept} disabled={!ack || saving || !d}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Acknowledge and accept"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
