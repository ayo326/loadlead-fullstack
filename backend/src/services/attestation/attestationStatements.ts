// Versioned attestation statements.
//
// The text the human signed is reproducible forever because both the
// text AND its version travel on every Signature record. Bumping a
// version NEVER edits an old entry; add a new entry below.

import type { AttestationAction, AttestationStatement } from '../../types/signatures';

/** Latest version per action. New rows record this version + the matching text. */
const LATEST: Record<AttestationAction, string> = {
  BOL_SUBMIT:       '1.0.0',
  CARRIER_ACCEPT:   '1.0.0',
  DRIVER_PICKUP:    '1.0.0',
  DRIVER_DELIVER:   '1.0.0',
  RECEIVER_CONFIRM: '1.0.0',
};

const STATEMENTS: AttestationStatement[] = [
  {
    action: 'BOL_SUBMIT',
    version: '1.0.0',
    text:
      "I, the authorized representative of the shipper, certify that the bill of lading details — " +
      "commodity, weight, origin, destination, equipment requirements, and any hazardous-materials " +
      "declarations — are accurate, complete, and submitted in good faith. I consent to sign this " +
      "tender electronically and to be bound by my electronic signature, which carries the same legal " +
      "effect as a handwritten signature under ESIGN (15 U.S.C. ch. 96) and UETA.",
  },
  {
    action: 'CARRIER_ACCEPT',
    version: '1.0.0',
    text:
      "I, the authorized representative of the carrier of record, accept this load tender and certify " +
      "that the assigned driver is qualified, identity-verified, and authorized to haul under our " +
      "operating authority. I consent to sign electronically; this signature has the same legal effect " +
      "as a handwritten signature under ESIGN and UETA.",
  },
  {
    action: 'DRIVER_PICKUP',
    version: '1.0.0',
    text:
      "I, the assigned driver, certify that I picked up the shipment described above in the condition " +
      "shown in the attached photographs and at the place and time recorded. I consent to sign " +
      "electronically; this signature has the same legal effect as a handwritten signature under " +
      "ESIGN and UETA.",
  },
  {
    action: 'DRIVER_DELIVER',
    version: '1.0.0',
    text:
      "I, the assigned driver, certify that I delivered the shipment described above at the place " +
      "and time recorded, and that the attached photographs depict the load on delivery. I consent " +
      "to sign electronically; this signature has the same legal effect as a handwritten signature " +
      "under ESIGN and UETA.",
  },
  {
    action: 'RECEIVER_CONFIRM',
    version: '1.0.0',
    text:
      "I, the authorized representative of the consignee, confirm receipt of the shipment described " +
      "above. If exceptions are noted below (damage, shortage, refusal, or other), the attached " +
      "photographs are submitted as evidence of condition at receipt. I consent to sign electronically; " +
      "this signature has the same legal effect as a handwritten signature under ESIGN and UETA.",
  },
];

export function latestStatement(action: AttestationAction): AttestationStatement {
  const version = LATEST[action];
  const found = STATEMENTS.find((s) => s.action === action && s.version === version);
  if (!found) throw new Error(`ATTESTATION_STATEMENT_MISSING: ${action}@${version}`);
  return found;
}

export function statementVersion(action: AttestationAction, version: string): AttestationStatement | undefined {
  return STATEMENTS.find((s) => s.action === action && s.version === version);
}
