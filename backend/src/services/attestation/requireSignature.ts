// requireSignature(loadId, action) — gate helper.
//
// Every transition route uses this to assert the right signature exists
// in the chain BEFORE applying the state change. Throws AppError 412
// with a structured code if missing so the client can show a clear UX.
//
// Returns the most-recent signature for the action so the caller can
// pull projection data the sign endpoint already captured (e.g. the
// assignedDriverId encoded into the CARRIER_ACCEPT signature).

import { AppError } from '../../middleware/errorHandler';
import { getChain } from './signatureService';
import type { AttestationAction, Signature } from '../../types/signatures';

const CODES: Record<AttestationAction, string> = {
  BOL_SUBMIT:       'BOL_SUBMIT_SIGNATURE_REQUIRED',
  CARRIER_ACCEPT:   'CARRIER_ACCEPT_SIGNATURE_REQUIRED',
  DRIVER_PICKUP:    'DRIVER_PICKUP_SIGNATURE_REQUIRED',
  DRIVER_DELIVER:   'DRIVER_DELIVER_SIGNATURE_REQUIRED',
  RECEIVER_CONFIRM: 'RECEIVER_CONFIRM_SIGNATURE_REQUIRED',
};

export async function requireSignature(
  loadId: string,
  action: AttestationAction,
): Promise<Signature> {
  const chain = await getChain(loadId);
  // Newest matching signature wins — corrections are NEW rows; the
  // chain orders ASC so we pick the last one.
  const matches = chain.filter((s) => s.action === action);
  const sig = matches[matches.length - 1];
  if (!sig) {
    throw new AppError(
      JSON.stringify({
        error: `${action} signature is required for this transition`,
        code:  CODES[action],
      }),
      412,
    );
  }
  return sig;
}
