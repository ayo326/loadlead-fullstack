// REL — podPhotoService.finalizeUpload is idempotent under retry.
//
// The docstring claims "Idempotent: a second call returns the existing
// READY row." Nothing tests it. Idempotency matters because:
//   - The client UI retries finalize on network blip
//   - A driver could double-tap "Done" and fire two calls
//   - The whole attestation sign step REQUIRES finalize to have run
//     first (otherwise canonicalize throws CANONICALIZE_PHOTO_NOT_FINALIZED)
//
// What "idempotent" must mean here:
//   1. Second call returns the SAME contentHash (no re-hashing of bytes
//      that could have been overwritten by an attacker between calls —
//      Object Lock on v2 buckets blocks this, but the invariant should
//      hold even on v1)
//   2. Second call does NOT re-trigger an S3 GetObject (network cost +
//      avoids the FINALIZE_BYTES_MISSING race if S3 has any propagation lag)
//   3. Second call does NOT re-apply Object Lock retention (PutObject-
//      Retention has its own extend-only semantics, but we want the
//      service to short-circuit before reaching it)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const docClientSend = vi.hoisted(() => vi.fn());
const s3Send         = vi.hoisted(() => vi.fn());

vi.mock('../../src/config/aws', () => ({ docClient: { send: docClientSend } }));
vi.mock('@aws-sdk/client-s3', () => {
  class S3ClientMock { send = s3Send; }
  return {
    S3Client: S3ClientMock,
    GetObjectCommand:        class { constructor(public input: any) {} },
    PutObjectCommand:        class { constructor(public input: any) {} },
    PutObjectRetentionCommand: class { constructor(public input: any) {} },
  };
});
vi.mock('../../src/config/environment', () => ({
  default: { dynamodb: { podPhotosTable: 'LoadLead_PodPhotos' } },
}));

import { finalizeUpload } from '../../src/services/attestation/podPhotoService';

const READY_PHOTO = {
  photoId:          'photo_ready_1',
  loadId:           'load_test_1',
  stage:            'PICKUP',
  s3Key:            'pod/pickup/load_test_1/photo_ready_1.jpg',
  uploadedByUserId: 'user_alice',
  contentType:      'image/jpeg',
  status:           'READY',
  contentHash:      'deadbeef'.repeat(8), // 64 hex chars
  byteSize:         70,
  finalizedAt:      1700000001000,
  createdAt:        1700000000000,
};

beforeEach(() => {
  docClientSend.mockReset();
  s3Send.mockReset();
});

describe('REL: finalizeUpload idempotency', () => {
  it('second call on an already-READY photo returns same row WITHOUT re-reading S3 OR re-locking', async () => {
    docClientSend.mockResolvedValue({ Item: { ...READY_PHOTO } });

    const r1 = await finalizeUpload('photo_ready_1', 'user_alice');
    const r2 = await finalizeUpload('photo_ready_1', 'user_alice');

    expect(r1.contentHash).toBe(READY_PHOTO.contentHash);
    expect(r2.contentHash).toBe(READY_PHOTO.contentHash);
    expect(r1.contentHash).toBe(r2.contentHash);

    // Crucial: S3 client was never called. Only DDB GetCommand fired
    // (twice — once per finalize call). No GetObject, no PutObjectRetention.
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('READY photo without a contentHash is NOT treated as idempotent (would re-process)', async () => {
    // Defensive check: the idempotency branch is `status === READY AND
    // contentHash truthy`. A row stuck in READY without a hash (data
    // corruption / partial write) must NOT short-circuit — it should
    // re-attempt to compute the hash so the row converges.
    const half = { ...READY_PHOTO, contentHash: undefined };
    docClientSend.mockResolvedValueOnce({ Item: half });
    // S3 will get called; mock it to fail with NoSuchKey to keep the test bounded.
    s3Send.mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));

    await expect(finalizeUpload('photo_ready_1', 'user_alice'))
      .rejects.toThrow(/FINALIZE_BYTES_MISSING/);

    expect(s3Send).toHaveBeenCalled(); // proves it did NOT short-circuit
  });

  it('PENDING photo proceeds past the short-circuit (re-finalize works for an interrupted upload)', async () => {
    const pending = { ...READY_PHOTO, status: 'PENDING', contentHash: undefined };
    docClientSend.mockResolvedValueOnce({ Item: pending });
    // Stop early at the S3 read so the test stays bounded.
    s3Send.mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));

    await expect(finalizeUpload('photo_ready_1', 'user_alice'))
      .rejects.toThrow(/FINALIZE_BYTES_MISSING/);
    expect(s3Send).toHaveBeenCalled();
  });

  it('idempotency check fires AFTER the WRONG_FINALIZER check — an attacker can\'t bypass authz by waiting for READY', async () => {
    // Even if the photo is READY, a different user finalizing it must
    // 403 — the authz check is before the idempotency short-circuit.
    docClientSend.mockResolvedValueOnce({ Item: { ...READY_PHOTO } });
    await expect(finalizeUpload('photo_ready_1', 'user_bob_attacker'))
      .rejects.toThrow(/WRONG_FINALIZER/);
    // Importantly, S3 was not called and no DDB UpdateCommand was attempted.
    expect(s3Send).not.toHaveBeenCalled();
    // Only the initial GetCommand
    expect(docClientSend).toHaveBeenCalledTimes(1);
  });
});
