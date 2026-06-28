// Admin-side attestation chain lookup.
//
// Per the attestation spec, the ordered signature chain on a load is
// "visible to the load's parties and read-only to platform admin." The
// load's parties already see the AttestationChain panel on their own
// LoadDetail pages. Platform staff need a read-only path too without
// joining the load as a party.
//
// This is the minimum-viable admin surface: paste a loadId, see the
// chain. A future polish would link from the FleetFeed / org panels
// directly into this lookup with the loadId pre-filled.
//
// AuthZ note: the GET /api/attestation/chain/:loadId endpoint accepts
// ANY authenticated user today. Tightening it to "platform staff OR
// load party" is a Phase-2 backlog item (logged in
// docs/ATTESTATION_PHASE_1.md). This UI does NOT widen access — it just
// makes the existing endpoint discoverable to staff who already have
// access by virtue of being authenticated.

import { useState } from "react";
import { Search, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttestationChain } from "@/components/attestation/AttestationChain";

export function AttestationLookup() {
  const [input, setInput]       = useState("");
  const [loadId, setLoadId]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  function lookup() {
    const trimmed = input.trim();
    setError(null);
    if (!trimmed) {
      setError("Enter a loadId to look up its attestation chain.");
      setLoadId(null);
      return;
    }
    // Light client-side shape check — server enforces real validation.
    if (!/^load_[A-Za-z0-9_-]+$/.test(trimmed)) {
      setError("loadId should look like load_<id>. Paste from the FleetFeed row.");
      setLoadId(null);
      return;
    }
    setLoadId(trimmed);
  }

  return (
    <section className="rounded-md border border-border bg-card p-5 edge-info" aria-label="Attestation lookup">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Attestation chain lookup</h2>
        <span className="text-xs text-muted-foreground">Read-only</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
          placeholder="load_… (paste from a FleetFeed row)"
          className="flex-1 min-w-[280px] font-mono text-xs"
          data-cy="attestation-lookup-input"
        />
        <Button onClick={lookup} data-cy="attestation-lookup-submit">
          <Search className="h-3.5 w-3.5 mr-1" /> Look up
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2 mb-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loadId && <AttestationChain loadId={loadId} compact />}
    </section>
  );
}
