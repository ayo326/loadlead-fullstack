// AttestationChain - read-only ordered chain view for a load.
//
// Shown on the load detail page to ALL load parties (shipper, carrier,
// OO, driver, receiver) and to platform ADMIN (read-only - no admin
// sign UI). Each row surfaces: who, when, what, hash, photo count, any
// exceptions captured at signing.
//
// The full signatureData (base64 PNG / typed name) is NOT shown in the
// list to keep the view scannable. A future drilldown can fetch a single
// signature's full payload for a render-on-demand audit packet.

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, Camera } from "lucide-react";
import { api } from "@/lib/api";

interface ChainRow {
  signatureId: string;
  action: string;
  signerUserId: string;
  signerRole: string;
  signedAt: string;
  documentHash: string;
  proofPhotoIds: string[];
  attestationVersion: string;
  canonicalSchemaVersion: string;
  exceptions?: { code: string; description: string };
}

const ACTION_LABEL: Record<string, string> = {
  BOL_SUBMIT:       'BOL submitted',
  CARRIER_ACCEPT:   'Carrier accepted',
  DRIVER_PICKUP:    'Driver pickup',
  DRIVER_DELIVER:   'Driver delivery',
  RECEIVER_CONFIRM: 'Receiver confirmed',
};

interface AttestationChainProps {
  loadId: string;
  /** Compact = no header, smaller padding. For embed inside a card. */
  compact?: boolean;
}

export function AttestationChain({ loadId, compact = false }: AttestationChainProps) {
  const [rows, setRows] = useState<ChainRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.attestationChain(loadId)
      .then((r) => { if (!cancelled) setRows(r.chain ?? []); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Failed to load attestation chain'); });
    return () => { cancelled = true; };
  }, [loadId]);

  if (error) {
    return (
      <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading attestation chain…
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-border bg-card ${compact ? '' : 'p-5'}`} data-cy="attestation-chain">
      {!compact && (
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Attestation chain</h3>
          <span className="text-xs text-muted-foreground">{rows.length} signature{rows.length === 1 ? '' : 's'}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signatures recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.signatureId}
              className="rounded border border-border bg-background px-3 py-2 text-sm"
              data-cy="attestation-chain-row"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium">{ACTION_LABEL[row.action] ?? row.action}</span>
                  <span className="text-xs text-muted-foreground"> · {row.signerRole}</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {new Date(row.signedAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium">Signer:</span>{' '}
                  <span className="font-mono">{row.signerUserId}</span>
                </span>
                <span>
                  <span className="font-medium">documentHash:</span>{' '}
                  <span className="font-mono" title={row.documentHash}>{row.documentHash.slice(0, 16)}…</span>
                </span>
                <span>
                  v{row.attestationVersion} · schema {row.canonicalSchemaVersion}
                </span>
                {row.proofPhotoIds.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Camera className="h-3 w-3" /> {row.proofPhotoIds.length}
                  </span>
                )}
              </div>
              {row.exceptions && (
                <div className="mt-2 inline-flex items-center gap-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="font-medium">{row.exceptions.code}</span>
                  <span>· {row.exceptions.description}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
