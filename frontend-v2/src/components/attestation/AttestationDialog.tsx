// AttestationDialog - thin wrapper that renders an <AttestationBlock />
// inside a shadcn Dialog and exposes a small imperative API via props.
//
// Used by every persona's transition action: Driver accept / pickup /
// deliver, Receiver confirm. Same component, different `action` /
// `stage` / `requirePhotos` / `allowExceptions` / `assignedDriverId`.
//
// Behavior:
//   - `open=true` opens the dialog
//   - Cancelling closes; transition is NOT called
//   - On signed → onSigned() runs (callers chain the transition + nav)

import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AttestationBlock,
  type AttestationAction,
  type PhotoStage,
  type SignatureMode,
} from "@/components/attestation/AttestationBlock";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  loadId: string;
  action: AttestationAction;
  attestationText: string;
  attestationVersion: string;
  stage?: PhotoStage;
  requirePhotos?: boolean;
  allowExceptions?: boolean;
  allowedSignatureTypes?: SignatureMode[];
  assignedDriverId?: string;
  ratePerMileCents?: number;
  totalCents?: number;
  onSigned: (sig: { signatureId: string; documentHash: string; signedAt: string }) => void;
}

export function AttestationDialog(p: Props) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">{p.title}</h2>
          {p.subtitle && <p className="text-xs text-muted-foreground">{p.subtitle}</p>}
        </div>
        <AttestationBlock
          loadId={p.loadId}
          action={p.action}
          attestationText={p.attestationText}
          attestationVersion={p.attestationVersion}
          stage={p.stage}
          requirePhotos={p.requirePhotos}
          allowExceptions={p.allowExceptions}
          allowedSignatureTypes={p.allowedSignatureTypes}
          assignedDriverId={p.assignedDriverId}
          ratePerMileCents={p.ratePerMileCents}
          totalCents={p.totalCents}
          onCancel={() => p.onOpenChange(false)}
          onSigned={p.onSigned}
        />
      </DialogContent>
    </Dialog>
  );
}

// Server-mirrored attestation copy (v1.0.0). Keep in sync with
// backend/src/services/attestation/attestationStatements.ts. When the
// server bumps a version, bump this constant and the projection version
// stamp in the same PR.
export const ATTESTATION_TEXT: Record<AttestationAction, string> = {
  BOL_SUBMIT:
    "I, the authorized representative of the shipper, certify that the bill of lading details - " +
    "commodity, weight, origin, destination, equipment requirements, and any hazardous-materials " +
    "declarations - are accurate, complete, and submitted in good faith. I consent to sign this " +
    "tender electronically and to be bound by my electronic signature, which carries the same legal " +
    "effect as a handwritten signature under ESIGN (15 U.S.C. ch. 96) and UETA.",
  CARRIER_ACCEPT:
    "I, the authorized representative of the carrier of record, accept this load tender and certify " +
    "that the assigned driver is qualified, identity-verified, and authorized to haul under our " +
    "operating authority. I consent to sign electronically; this signature has the same legal effect " +
    "as a handwritten signature under ESIGN and UETA.",
  DRIVER_PICKUP:
    "I, the assigned driver, certify that I picked up the shipment described above in the condition " +
    "shown in the attached photographs and at the place and time recorded. I consent to sign " +
    "electronically; this signature has the same legal effect as a handwritten signature under " +
    "ESIGN and UETA.",
  DRIVER_DELIVER:
    "I, the assigned driver, certify that I delivered the shipment described above at the place " +
    "and time recorded, and that the attached photographs depict the load on delivery. I consent " +
    "to sign electronically; this signature has the same legal effect as a handwritten signature " +
    "under ESIGN and UETA.",
  RECEIVER_CONFIRM:
    "I, the authorized representative of the consignee, confirm receipt of the shipment described " +
    "above. If exceptions are noted below (damage, shortage, refusal, or other), the attached " +
    "photographs are submitted as evidence of condition at receipt. I consent to sign electronically; " +
    "this signature has the same legal effect as a handwritten signature under ESIGN and UETA.",
};

export const ATTESTATION_VERSION = "1.0.0";
