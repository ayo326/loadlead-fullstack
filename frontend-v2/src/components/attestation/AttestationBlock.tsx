// AttestationBlock — neutral, persona-agnostic primitive.
//
// One component covers all five handoffs (shipper BOL submit, carrier/OO
// accept, driver pickup, driver delivery, receiver receipt). The caller
// passes the action + display config; this component owns:
//   - Photo upload + finalize (sequential, synchronous; PENDING → READY)
//   - Consent capture
//   - Signature input (typed | drawn | click; caller picks allowed modes)
//   - Optional exceptions block (for RECEIVER_CONFIRM)
//   - The single POST /attestation/sign call on submit
//
// Internal-staff personas (ADMIN/MANAGER/SUPERVISOR/TEAM_LEAD) are excluded
// at the server (assertSignerIsLoadParty never maps them to a load party).
// This component must NOT be mounted in the admin console.
//
// Reuses:
//   - <SignaturePad /> for drawn mode (existing draw-canvas)
//   - api.attestationPhotoUploadUrl + attestationFinalizePhoto + attestationSign

import { useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/SignaturePad";
import { api } from "@/lib/api";

export type AttestationAction =
  | 'BOL_SUBMIT' | 'CARRIER_ACCEPT' | 'DRIVER_PICKUP' | 'DRIVER_DELIVER' | 'RECEIVER_CONFIRM';

export type SignatureMode = 'typed' | 'drawn' | 'click';
export type PhotoStage = 'ORIGIN' | 'PICKUP' | 'DELIVERY' | 'RECEIPT';

interface AttestationBlockProps {
  loadId: string;
  action: AttestationAction;
  /** Legal text the human is asked to attest to. Caller passes this in
   * so the projection version stays in lockstep with the server's text. */
  attestationText: string;
  /** Caller-passed version used for display + audit. The server records
   * its own canonical version on the row — this is just the displayed
   * value the human sees. */
  attestationVersion: string;

  /** Modes the user may pick. Default: typed + drawn. */
  allowedSignatureTypes?: SignatureMode[];
  /** Photo stage tied to the action. Omit to disable the photo control. */
  stage?: PhotoStage;
  /** Whether ≥1 photo is REQUIRED before the user can sign. */
  requirePhotos?: boolean;
  /** Show the exceptions block (RECEIVER_CONFIRM, optionally DRIVER_DELIVER). */
  allowExceptions?: boolean;

  /** For CARRIER_ACCEPT only — the driverId being assigned. Server uses
   * this for resolveCarrierOfRecord() and embeds it in the documentHash. */
  assignedDriverId?: string;

  onSigned?: (result: { signatureId: string; documentHash: string; signedAt: string }) => void;
  onCancel?: () => void;
}

type UploadedPhoto = { photoId: string; uploadUrl: string; finalizing?: boolean; contentHash?: string };

const EXCEPTION_CODES = ['OSD', 'DAMAGE', 'SHORT', 'REFUSED', 'OTHER'] as const;

export function AttestationBlock(props: AttestationBlockProps) {
  const {
    loadId, action,
    attestationText, attestationVersion,
    allowedSignatureTypes = ['typed', 'drawn'],
    stage, requirePhotos = false, allowExceptions = false,
    assignedDriverId,
    onSigned, onCancel,
  } = props;

  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [consent, setConsent] = useState(false);
  const [signatureType, setSignatureType] = useState<SignatureMode>(allowedSignatureTypes[0]);
  const [typedName, setTypedName] = useState('');
  const [drawnData, setDrawnData] = useState<string | undefined>();
  const [excCode, setExcCode] = useState<typeof EXCEPTION_CODES[number] | ''>('');
  const [excText, setExcText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── upload helper: presign → PUT → finalize (synchronous) ────────────
  async function onFileSelected(file: File) {
    if (!stage) return;
    setError(null);
    try {
      const presign = await api.attestationPhotoUploadUrl({
        loadId, stage,
        contentType: file.type || 'image/jpeg',
      });
      // 1. PUT directly to S3
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file,
      });
      if (!put.ok) throw new Error(`S3 PUT failed: ${put.status}`);

      // 2. Finalize: server reads bytes, sha256, sets contentHash.
      //    Only after this does the photo become bindable by a signature.
      setPhotos((p) => [...p, { photoId: presign.photoId, uploadUrl: presign.uploadUrl, finalizing: true }]);
      const fin = await api.attestationFinalizePhoto(presign.photoId);
      setPhotos((p) => p.map((x) =>
        x.photoId === presign.photoId ? { ...x, finalizing: false, contentHash: fin.contentHash } : x,
      ));
    } catch (e: any) {
      setError(e?.message || 'Photo upload failed');
    }
  }

  function removePhoto(photoId: string) {
    // Note: removing here only forgets it client-side. The PENDING row
    // remains in DDB until expiry; the bucket policy prevents deletion.
    setPhotos((p) => p.filter((x) => x.photoId !== photoId));
  }

  // ── submit ───────────────────────────────────────────────────────────
  const photoReady    = photos.length > 0 && photos.every((p) => !!p.contentHash);
  const photoOk       = requirePhotos ? photoReady : (photos.length === 0 || photoReady);
  const signatureData = signatureType === 'typed' ? typedName
                      : signatureType === 'drawn' ? (drawnData ?? '')
                      : 'I AGREE';
  const signatureOk   = signatureType === 'click'
                      ? consent
                      : signatureData.length > 0;
  const canSubmit     = consent && signatureOk && photoOk && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true); setError(null);
    try {
      const r = await api.attestationSign({
        loadId, action,
        signatureType, signatureData,
        consentGiven: true,
        photoIds: photos.map((p) => p.photoId),
        exceptions: allowExceptions && excCode ? { code: excCode, description: excText } : undefined,
        assignedDriverId,
      });
      onSigned?.({ signatureId: r.signatureId, documentHash: r.documentHash, signedAt: r.signedAt });
    } catch (e: any) {
      const body = (() => { try { return JSON.parse(e?.message ?? '{}'); } catch { return {}; } })();
      setError(body.error || e?.message || 'Signing failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-5 space-y-4" data-cy="attestation-block">
      {/* Attestation legal text */}
      <div>
        <h3 className="text-sm font-semibold">Attestation</h3>
        <p className="mt-1 text-xs text-muted-foreground">v{attestationVersion} · action: {action}</p>
        <p className="mt-3 text-sm leading-relaxed text-foreground">{attestationText}</p>
      </div>

      {/* Photos */}
      {stage && (
        <div className="space-y-2">
          <Label>Photos {requirePhotos ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}</Label>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <div key={p.photoId} className="relative rounded border bg-muted/40 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  {p.finalizing
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : p.contentHash
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                  <span className="font-mono">{p.photoId.slice(0, 8)}</span>
                  {p.contentHash && <span className="text-muted-foreground">· hash {p.contentHash.slice(0, 8)}…</span>}
                </div>
                <button className="absolute -right-1 -top-1 rounded-full bg-background p-0.5"
                        onClick={() => removePhoto(p.photoId)} aria-label="remove">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <label className="inline-flex items-center gap-2 rounded border border-dashed border-border px-3 py-2 text-xs cursor-pointer hover:bg-muted/30">
              <Upload className="h-3.5 w-3.5" />
              Add photo
              <input
                type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.currentTarget.value = ''; }}
              />
            </label>
          </div>
          {requirePhotos && !photoOk && (
            <p className="text-xs text-muted-foreground">≥1 finalized photo required before signing.</p>
          )}
        </div>
      )}

      {/* Exceptions (OS&D) */}
      {allowExceptions && (
        <div className="space-y-2">
          <Label>Exceptions (optional)</Label>
          <div className="grid grid-cols-3 gap-2">
            <select
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={excCode}
              onChange={(e) => setExcCode(e.target.value as any)}
            >
              <option value="">— none —</option>
              {EXCEPTION_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Textarea
              className="col-span-2 text-sm"
              placeholder="Describe condition / damage / shortage (photos serve as evidence)"
              value={excText}
              onChange={(e) => setExcText(e.target.value)}
              disabled={!excCode}
              rows={2}
            />
          </div>
        </div>
      )}

      {/* Consent */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox" className="mt-0.5"
          checked={consent} onChange={(e) => setConsent(e.target.checked)}
          data-cy="attestation-consent"
        />
        <span>
          I consent to sign this attestation electronically. I understand
          my electronic signature carries the same legal effect as a
          handwritten signature under ESIGN (15 U.S.C. ch. 96) and UETA.
        </span>
      </label>

      {/* Signature input */}
      <div className="space-y-2">
        <div className="flex gap-2">
          {allowedSignatureTypes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSignatureType(mode)}
              className={`text-xs rounded-full px-3 py-1 border ${
                signatureType === mode
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {signatureType === 'typed' && (
          <Input
            placeholder="Type your full legal name"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            data-cy="attestation-typed-name"
          />
        )}
        {signatureType === 'drawn' && (
          <SignaturePad label="Draw your signature" onSave={setDrawnData} existingSignature={drawnData} />
        )}
        {signatureType === 'click' && (
          <p className="text-xs text-muted-foreground">
            Clicking "Sign" with consent checked records your click as your signature.
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button onClick={submit} disabled={!canSubmit} data-cy="attestation-submit">
          {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing…</> : 'Sign'}
        </Button>
      </div>
    </div>
  );
}
