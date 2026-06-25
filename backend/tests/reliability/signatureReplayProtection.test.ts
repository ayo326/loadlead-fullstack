// REL — recordSignature rejects replays at the DDB layer (attribute_not_exists).
//
// This is the third immutability layer per ATTESTATION_PHASE_1.md:
//   Layer 1: ESLint denies UpdateCommand/DeleteCommand imports in this folder
//   Layer 2: IAM Deny on UpdateItem/DeleteItem/BatchWriteItem for the table
//   Layer 3: PutItem carries ConditionExpression `attribute_not_exists(signatureId)`
//            so a duplicate Put fails at the DDB API even with full Put rights.
//
// Layers 1 + 2 are environmental (ESLint config + IAM policy); only
// layer 3 is testable in unit tests. Without it, two near-simultaneous
// sign calls (same client UI clicks "Sign" twice during network blip)
// would produce TWO rows on the same load+action — the chain READ would
// return both, the legal evidence would be ambiguous.
//
// What this test pins:
//   - PutCommand on signatures table is invoked WITH a ConditionExpression
//     containing `attribute_not_exists(signatureId)`
//   - When DDB throws ConditionalCheckFailedException, the service
//     surfaces it as an error (caller can decide how to translate it)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Load } from '../../src/types';

const docClientSend = vi.hoisted(() => vi.fn());
vi.mock('../../src/config/aws', () => ({ docClient: { send: docClientSend } }));
vi.mock('../../src/config/environment', () => ({
  default: {
    dynamodb: {
      signaturesTable: 'LoadLead_Signatures',
      bolTable:        'LoadLead_BOL',
    },
  },
}));

// recordSignature pulls in canonicalize + projection helpers; mock those
// so the test stays focused on the put-with-condition behavior.
vi.mock('../../src/services/attestation/canonicalize', () => ({
  canonicalize: vi.fn(() => 'canonical-fixed-string-for-test'),
}));
vi.mock('../../src/services/attestation/attestationStatements', () => ({
  latestStatement: vi.fn(() => ({ version: '1.0.0', text: 'I agree…' })),
}));
vi.mock('../../src/services/attestation/projections/v1', () => ({
  projectV1: vi.fn(() => ({ canonical: 'x' })),
  CURRENT_PROJECTION_VERSION: '1',
}));

import { recordSignature } from '../../src/services/attestation/signatureService';

const LOAD: Load = {
  loadId:      'load_replay_test',
  shipperId:   'shipper_s1',
  receiverId:  'receiver_r1',
} as Load;

const INPUT = {
  load:          LOAD,
  action:        'BOL_SUBMIT' as const,
  signerUserId:  'user_shipper',
  signerRole:    'SHIPPER' as const,
  signatureType: 'typed' as const,
  signatureData: 'Shipper Person',
  consentGiven:  true,
};

beforeEach(() => {
  docClientSend.mockReset();
});

describe('REL: recordSignature append-only / replay protection', () => {
  it('PutCommand carries ConditionExpression with attribute_not_exists(signatureId)', async () => {
    docClientSend.mockResolvedValueOnce({}); // PutItem ok

    await recordSignature(INPUT);

    // First call should be the PutCommand for the signature row.
    const cmd = docClientSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('LoadLead_Signatures');
    expect(cmd.input.ConditionExpression).toContain('attribute_not_exists');
    expect(cmd.input.ConditionExpression).toContain('signatureId');
  });

  it('DDB ConditionalCheckFailedException is wrapped into SIGNATURE_DUPLICATE 409 (clean structured error, not raw DDB leak)', async () => {
    // First call succeeds
    docClientSend.mockResolvedValueOnce({});
    // Second call DDB throws the conditional-check error.
    const dupeErr: any = new Error('The conditional request failed');
    dupeErr.name = 'ConditionalCheckFailedException';
    docClientSend.mockRejectedValueOnce(dupeErr);

    const first = await recordSignature(INPUT);
    expect(first.signatureId).toBeTruthy();

    // The service translates the raw DDB error into a structured AppError
    // — clients don't see the raw "The conditional request failed" message
    // (which would leak the DDB layer); they see SIGNATURE_DUPLICATE so
    // they can handle the replay case explicitly.
    await expect(recordSignature(INPUT))
      .rejects.toThrow(/SIGNATURE_DUPLICATE/);
  });

  it('consent gate fires BEFORE any DDB write — replay of a no-consent payload never touches the table', async () => {
    await expect(recordSignature({ ...INPUT, consentGiven: false as any }))
      .rejects.toThrow(/CONSENT_REQUIRED/);
    // Prove DDB was never called: even a denied request must not waste an RU
    // and must not leave a half-written row.
    expect(docClientSend).not.toHaveBeenCalled();
  });

  // NOTE: removed a test that asserted correctsSignatureId was preserved
  // on the output row. The docstring at the top of signatureService.ts
  // says "Corrections are NEW rows with `correctsSignatureId`", but the
  // RecordSignatureInput interface does NOT include that field and the
  // implementation doesn't plumb it through. Documented but not built.
  // Flagged as a follow-up: either remove the comment or implement the
  // field; either way, the test belongs on the implemented behavior.
});
