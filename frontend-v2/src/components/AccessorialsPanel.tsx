import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Calculator, Loader2 } from "lucide-react";
import { api, formatCents, type AccessorialChargeDTO } from "@/lib/api";

const STOPS = ["PICKUP", "DELIVERY"] as const;

const STATUS_STYLE: Record<string, string> = {
  ACCRUING: "bg-slate-100 text-slate-700",
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  SETTLED: "bg-emerald-100 text-emerald-800",
  DISPUTED: "bg-red-100 text-red-800",
  ADJUSTED: "bg-blue-100 text-blue-800",
};

/**
 * Detention/layover accessorials on a load. A mover (driver / owner-operator)
 * records stop check-in/check-out and computes the charge; a shipper reviews
 * (approve / adjust / dispute). Read-only for anyone else.
 */
export function AccessorialsPanel({ loadId, role }: { loadId: string; role: "SHIPPER" | "MOVER" | "VIEW" }) {
  const [charges, setCharges] = useState<AccessorialChargeDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustDollars, setAdjustDollars] = useState("");

  async function refresh() {
    try { setCharges((await api.accessorials.listCharges(loadId)).charges); } catch { /* table may be empty */ }
  }
  useEffect(() => { refresh(); }, [loadId]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast.success(ok); await refresh(); }
    catch (e: any) { toast.error(e.message ?? "Action failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="rounded-md border border-border bg-card p-6 space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" /> Accessorials (detention / layover)
      </h3>

      {role === "MOVER" && (
        <div className="space-y-2">
          {STOPS.map((stop) => (
            <div key={stop} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-sm font-medium">{stop}</span>
              <Button size="sm" variant="secondary" disabled={busy !== null}
                onClick={() => run(`${stop}-in`, () => api.accessorials.checkIn(loadId, stop, { geofenceMatch: true }), `Checked in at ${stop}`)}>
                <LogIn className="mr-1 h-3.5 w-3.5" /> Check in
              </Button>
              <Button size="sm" variant="secondary" disabled={busy !== null}
                onClick={() => run(`${stop}-out`, () => api.accessorials.checkOut(loadId, stop, { geofenceMatch: true }), `Checked out at ${stop}`)}>
                <LogOut className="mr-1 h-3.5 w-3.5" /> Check out
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null}
                onClick={() => run(`${stop}-calc`, () => api.accessorials.compute(loadId, stop), `Computed ${stop} charge`)}>
                <Calculator className="mr-1 h-3.5 w-3.5" /> Compute
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Check in on arrival and out on departure. Detention accrues past the free time; over 24h it becomes layover.
          </p>
        </div>
      )}

      {charges.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accessorial charges yet.</p>
      ) : (
        <div className="space-y-2">
          {charges.map((c) => (
            <div key={c.chargeId} className="rounded-lg border p-3 text-sm space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.type}</span>
                  <span className="text-muted-foreground">{c.stopId}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? "bg-slate-100"}`}>{c.status}</span>
                </div>
                <span className="font-semibold tabular-nums">{formatCents(c.amountCents)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                dwell {Math.round(c.dwellMinutes)} min
                {c.type === "DETENTION" ? ` · billable ${c.billableMinutes} min · ${c.rateClass}` : ` · ${c.layoverDays} day(s)`}
              </div>

              {role === "SHIPPER" && c.status !== "SETTLED" && c.status !== "ACCRUING" && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" disabled={busy !== null}
                    onClick={() => run(`ap-${c.chargeId}`, () => api.accessorials.approve(c.chargeId), "Charge approved")}>
                    {busy === `ap-${c.chargeId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
                  </Button>
                  {adjustId === c.chargeId ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs">$</span>
                      <Input value={adjustDollars} onChange={(e) => setAdjustDollars(e.target.value)}
                        placeholder="new amount" className="h-8 w-28" inputMode="decimal" />
                      <Button size="sm" variant="secondary" disabled={busy !== null}
                        onClick={() => {
                          const cents = Math.round(parseFloat(adjustDollars) * 100);
                          if (!Number.isFinite(cents) || cents < 0) { toast.error("Enter a valid amount"); return; }
                          run(`adj-${c.chargeId}`, () => api.accessorials.adjust(c.chargeId, cents), "Charge adjusted")
                            .then(() => { setAdjustId(null); setAdjustDollars(""); });
                        }}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAdjustId(null); setAdjustDollars(""); }}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy !== null}
                      onClick={() => { setAdjustId(c.chargeId); setAdjustDollars((c.amountCents / 100).toFixed(2)); }}>Adjust</Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null}
                    onClick={() => {
                      const reason = window.prompt("Reason for dispute (optional):") ?? undefined;
                      run(`dis-${c.chargeId}`, () => api.accessorials.dispute(c.chargeId, reason || undefined), "Charge disputed");
                    }}>Dispute</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
