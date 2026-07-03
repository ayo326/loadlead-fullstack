/**
 * NegotiationPanel - both sides of the engage/bid/counter flow on a load.
 *
 *   HAULER  (driver/OO load detail): Engage -> Accept load at the posted rate
 *           or Bid cents-per-mile; then Accept counter / Counter / Reject.
 *   SHIPPER (shipper load detail): sees the bid, then Accept bid / Counter /
 *           Reject bid.
 *
 * The server enforces turns, the exclusive lock, the window, and idempotent
 * assignment; this panel only renders the actions the API says are available
 * and polls for the counterparty's moves. Rates are integer cents per mile.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Handshake, Timer, CheckCircle2, XCircle, Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api, type NegotiationView } from "@/lib/api";

const POLL_MS = 10_000;

function rate(cents: number | null | undefined): string {
  return cents == null ? "posted rate" : `$${(cents / 100).toFixed(2)}/mi`;
}
function mmss(total: number): string {
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function NegotiationPanel({
  loadId,
  party,
  onAssigned,
}: {
  loadId: string;
  party: "HAULER" | "SHIPPER";
  onAssigned?: () => void;
}) {
  const [neg, setNeg] = useState<NegotiationView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [showRate, setShowRate] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.negotiation.forLoad(loadId);
      setNeg(r.negotiation);
      if (r.negotiation) setRemaining(r.negotiation.secondsRemaining);
    } catch { /* panel is best-effort; page still works */ }
    setLoaded(true);
  }, [loadId]);

  useEffect(() => {
    refresh();
    const p = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(p);
  }, [refresh]);

  // local 1s countdown between polls
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [neg?.negotiationId]);

  async function act(fn: () => Promise<{ negotiation: NegotiationView }>, ok: string) {
    setBusy(true);
    try {
      const r = await fn();
      setNeg(r.negotiation);
      setShowRate(false);
      setRateInput("");
      toast.success(ok);
      if (r.negotiation.status === "ACCEPTED") onAssigned?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function parsedRateCents(): number | null {
    const dollars = parseFloat(rateInput);
    if (!Number.isFinite(dollars) || dollars <= 0) return null;
    return Math.round(dollars * 100);
  }

  function submitRate() {
    const cents = parsedRateCents();
    if (cents == null) { toast.error("Enter a rate per mile like 2.75"); return; }
    if (!neg) return;
    if (neg.status === "ENGAGED") return act(() => api.negotiation.bid(neg.negotiationId, cents), "Bid sent to the shipper");
    if (party === "SHIPPER") return act(() => api.negotiation.shipperCounter(neg.negotiationId, cents), "Counter sent to the hauler");
    return act(() => api.negotiation.counter(neg.negotiationId, cents), "Counter sent to the shipper");
  }

  if (!loaded) return null;

  // No negotiation yet: only the hauler sees the entry point.
  if (!neg) {
    if (party !== "HAULER") return null;
    return (
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Negotiate this load</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Engage to hold the load exclusively for 20 minutes. You can accept it at the posted rate or bid your own rate per mile. While you hold it, no other hauler can see it.
        </p>
        <Button size="sm" disabled={busy} onClick={() => act(() => api.negotiation.engage(loadId), "Load engaged - it is yours for 20 minutes")}>
          <Handshake className="h-4 w-4 mr-1.5" aria-hidden /> Engage to negotiate
        </Button>
      </div>
    );
  }

  const active = ["ENGAGED", "PENDING_SHIPPER", "PENDING_HAULER"].includes(neg.status);
  const has = (a: string) => neg.actions.includes(a);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Negotiation</h3>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            neg.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800"
            : neg.status === "REJECTED" || neg.status === "EXPIRED" ? "bg-rose-100 text-rose-800"
            : "bg-amber-100 text-amber-800"}`}>
            {neg.display}
          </span>
        </div>
        {active && (
          <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground" aria-label="Time remaining">
            <Timer className="h-3.5 w-3.5" aria-hidden /> {mmss(remaining)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
          <div className="text-muted-foreground">Posted</div>
          <div className="font-semibold tabular-nums">{rate(neg.postedRatePerMileCents)}</div>
        </div>
        <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
          <div className="text-muted-foreground">On the table</div>
          <div className="font-semibold tabular-nums">
            {neg.currentOfferRatePerMileCents != null ? rate(neg.currentOfferRatePerMileCents) : "-"}
            {neg.currentOfferParty ? <span className="font-normal text-muted-foreground"> ({neg.currentOfferParty === "HAULER" ? "hauler" : "shipper"})</span> : null}
          </div>
        </div>
        <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
          <div className="text-muted-foreground">Round</div>
          <div className="font-semibold tabular-nums">{neg.roundCount}</div>
        </div>
      </div>

      {neg.status === "ACCEPTED" && (
        <p className="text-xs text-emerald-700 flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Assigned at {rate(neg.agreedRatePerMileCents)}{neg.agreedLinehaulCents != null ? ` - linehaul $${(neg.agreedLinehaulCents / 100).toFixed(2)}` : ""}.
        </p>
      )}
      {(neg.status === "REJECTED" || neg.status === "EXPIRED") && (
        <p className="text-xs text-rose-700 flex items-center gap-1">
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          {neg.status === "REJECTED" ? "Rejected." : "The window expired."} The load returned to the board at its posted rate.
        </p>
      )}

      {active && neg.actions.length === 0 && (
        <p className="text-xs text-muted-foreground">Waiting on the {party === "HAULER" ? "shipper" : "hauler"} to respond.</p>
      )}

      {active && neg.actions.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {has("ACCEPT_LOAD") && (
              <Button size="sm" disabled={busy} onClick={() => act(() => api.negotiation.acceptLoad(neg.negotiationId), "Load accepted at the posted rate")}>
                Accept load
              </Button>
            )}
            {has("ACCEPT_BID") && (
              <Button size="sm" disabled={busy} onClick={() => act(() => api.negotiation.shipperAccept(neg.negotiationId), "Bid accepted - load assigned")}>
                Accept bid
              </Button>
            )}
            {has("ACCEPT_COUNTER") && (
              <Button size="sm" disabled={busy} onClick={() => act(() => api.negotiation.accept(neg.negotiationId), "Counter accepted - load assigned")}>
                Accept counter
              </Button>
            )}
            {(has("BID") || has("COUNTER")) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowRate((v) => !v)}>
                {has("BID") ? "Bid" : "Counter offer"}
              </Button>
            )}
            {has("REJECT") && (
              <Button size="sm" variant="ghost" disabled={busy}
                onClick={() => act(
                  () => (party === "SHIPPER" ? api.negotiation.shipperReject(neg.negotiationId) : api.negotiation.reject(neg.negotiationId)),
                  "Negotiation ended - the load rebroadcasts"
                )}>
                {party === "SHIPPER" ? "Reject bid" : "Reject"}
              </Button>
            )}
          </div>
          {showRate && (
            <div className="flex items-center gap-2">
              <label htmlFor="neg-rate" className="text-xs text-muted-foreground whitespace-nowrap">Rate per mile ($)</label>
              <Input id="neg-rate" inputMode="decimal" placeholder="2.75" className="h-8 w-28"
                value={rateInput} onChange={(e) => setRateInput(e.target.value)} />
              <Button size="sm" disabled={busy} onClick={submitRate}>Send</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
