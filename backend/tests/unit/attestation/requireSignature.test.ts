// Gate proof — requireSignature(loadId, action).
//
// Asserts every transition route's contract:
//   - no matching signature in chain → AppError 412 with the action's
//     structured code (BOL_SUBMIT_SIGNATURE_REQUIRED etc.)
//   - matching signature present → returns the row
//   - chain ASC ordered → the newest matching row wins (corrections)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Signature } from '../../../src/types/signatures';

const chain: Signature[] = [];

vi.mock('../../../src/services/attestation/signatureService', () => ({
  getChain: vi.fn(async () => chain),
}));

import { requireSignature } from '../../../src/services/attestation/requireSignature';

function mkSig(action: Signature['action'], opts: Partial<Signature> = {}): Signature {
  return {
    signatureId:            opts.signatureId ?? `sig_${action}_${Math.random()}`,
    loadId:                 'load_abc',
    signerUserId:           opts.signerUserId ?? 'user_default',
    signerRole:             opts.signerRole ?? 'DRIVER',
    action,
    attestationText:        'text',
    attestationVersion:     '1.0.0',
    canonicalSchemaVersion: '1',
    signatureType:          'click',
    signatureData:          'I AGREE',
    consentGiven:           true,
    signedAt:               opts.signedAt ?? new Date().toISOString(),
    documentHash:           opts.documentHash ?? 'hash_default',
    proofPhotoIds:          opts.proofPhotoIds ?? [],
    createdAt:              Date.now(),
  };
}

describe('Phase-1 gate proof — requireSignature', () => {
  beforeEach(() => { chain.length = 0; });

  it('throws 412 with BOL_SUBMIT_SIGNATURE_REQUIRED when chain is empty', async () => {
    await expect(requireSignature('load_abc', 'BOL_SUBMIT'))
      .rejects.toThrow(/BOL_SUBMIT_SIGNATURE_REQUIRED/);
  });

  it('throws 412 with CARRIER_ACCEPT_SIGNATURE_REQUIRED when only a BOL sig exists', async () => {
    chain.push(mkSig('BOL_SUBMIT'));
    await expect(requireSignature('load_abc', 'CARRIER_ACCEPT'))
      .rejects.toThrow(/CARRIER_ACCEPT_SIGNATURE_REQUIRED/);
  });

  it('returns the matching signature when present', async () => {
    chain.push(mkSig('BOL_SUBMIT'));
    const captured = mkSig('DRIVER_PICKUP', { signerUserId: 'user_drv_1', documentHash: 'hash_pickup' });
    chain.push(captured);

    const sig = await requireSignature('load_abc', 'DRIVER_PICKUP');
    expect(sig.signatureId).toBe(captured.signatureId);
    expect(sig.documentHash).toBe('hash_pickup');
  });

  it('returns the newest matching signature (corrections supersede)', async () => {
    chain.push(mkSig('DRIVER_DELIVER', { signatureId: 'sig_old', signedAt: '2026-06-20T00:00:00Z' }));
    chain.push(mkSig('BOL_SUBMIT'));
    chain.push(mkSig('DRIVER_DELIVER', { signatureId: 'sig_new', signedAt: '2026-06-24T00:00:00Z' }));

    const sig = await requireSignature('load_abc', 'DRIVER_DELIVER');
    expect(sig.signatureId).toBe('sig_new');
  });

  it('all 5 action codes are surfaced when their chain row is missing', async () => {
    const cases: Array<[Signature['action'], string]> = [
      ['BOL_SUBMIT',       'BOL_SUBMIT_SIGNATURE_REQUIRED'],
      ['CARRIER_ACCEPT',   'CARRIER_ACCEPT_SIGNATURE_REQUIRED'],
      ['DRIVER_PICKUP',    'DRIVER_PICKUP_SIGNATURE_REQUIRED'],
      ['DRIVER_DELIVER',   'DRIVER_DELIVER_SIGNATURE_REQUIRED'],
      ['RECEIVER_CONFIRM', 'RECEIVER_CONFIRM_SIGNATURE_REQUIRED'],
    ];
    for (const [action, code] of cases) {
      chain.length = 0;
      await expect(requireSignature('load_abc', action))
        .rejects.toThrow(new RegExp(code));
    }
  });
});
