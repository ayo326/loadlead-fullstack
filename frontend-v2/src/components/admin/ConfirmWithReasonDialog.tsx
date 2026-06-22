// Destructive-action confirmation per IAM spec: every platform override
// (suspend, reinstate, revoke-admin) must capture a free-text reason that
// becomes part of the audit row.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  /** Label for the confirm button (e.g. "Suspend org", "Revoke admin"). */
  confirmLabel: string;
  /** Visual cue for the action's severity. */
  destructive?: boolean;
  /** Called with the captured reason. Must throw to indicate failure. */
  onConfirm: (reason: string) => Promise<void> | void;
}

export function ConfirmWithReasonDialog({
  open, onOpenChange, title, description, confirmLabel, destructive, onConfirm,
}: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 6 && !submitting;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      await onConfirm(trimmed);
      setReason("");
      onOpenChange(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to apply change");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && <AlertTriangle className="h-4 w-4 text-destructive" />}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="reason" className="text-xs">
            Reason <span className="text-muted-foreground">(captured in the audit log, minimum 6 characters)</span>
          </Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Fraud investigation - 2026-06-22 ticket #LL-1234"
            rows={3}
            disabled={submitting}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
