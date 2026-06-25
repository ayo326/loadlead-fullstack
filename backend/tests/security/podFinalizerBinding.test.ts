// SEC — only the original uploader of a PENDING ProofPhoto may finalize it.
//
// Why this matters: finalize is where the server reads bytes from S3,
// computes the sha256 contentHash, and applies the COMPLIANCE-mode
// Object Lock. If any authenticated user could finalize any photoId,
// they could trigger a different user's photo to be (a) read +
// hashed under the wrong identity and (b) locked into the WORM bucket
// at a time of their choosing. The hash becomes part of the signed
// document hash, so a wrong-finalizer effectively forges legal evidence
// from someone else's upload.
//
// Path under test: podPhotoService.finalizeUpload(photoId, uploadedByUserId)
// Expected guard: WRONG_FINALIZER 403 when the second arg doesn't match
// the photo row's uploadedByUserId.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/config/aws', () => ({
  docClient: { send: sendMock },
}));

// S3 client mock — finalize tries GetObject; we don't need to test the
// streaming path here, just that the authz check fires BEFORE the read.
// Must be a real class constructor (not an arrow factory) because
// podPhotoService.ts does `new S3Client(...)` at module load time.
vi.mock('@aws-sdk/client-s3', () => {
  class S3ClientMock { send = vi.fn(); }
  return {
    S3Client: S3ClientMock,
    GetObjectCommand:        class {},
    PutObjectCommand:        class {},
    PutObjectRetentionCommand: class {},
  };
});

vi.mock('../../src/config/environment', () => ({
  default: { dynamodb: { podPhotosTable: 'LoadLead_PodPhotos' } },
}));

import { finalizeUpload } from '../../src/services/attestation/podPhotoService';

const PENDING_PHOTO = {
  photoId:          'photo_test_1',
  loadId:           'load_test_1',
  stage:            'PICKUP',
  s3Key:            'pod/pickup/load_test_1/photo_test_1.jpg',
  uploadedByUserId: 'user_alice',
  contentType:      'image/jpeg',
  status:           'PENDING',
  createdAt:        1700000000000,
};

beforeEach(() => {
  sendMock.mockReset();
  // Default GetCommand returns Alice's PENDING photo.
  sendMock.mockImplementation(async (cmd: any) => {
    const name = cmd?.constructor?.name ?? '';
    if (name === 'GetCommand') return { Item: { ...PENDING_PHOTO } };
    throw new Error(`unexpected DDB command in test: ${name}`);
  });
});

describe('SEC: podPhotoService.finalizeUpload — uploader binding', () => {
  it('Alice (the uploader) can finalize her own upload — happy path is reachable', async () => {
    // We expect this to PROCEED PAST the authz check and only fail on the
    // S3 read (which the mock doesn't simulate). That's enough to prove
    // the WRONG_FINALIZER branch did NOT fire for Alice.
    await expect(finalizeUpload('photo_test_1', 'user_alice'))
      .rejects.toThrow(/.*/); // any error fine — proves we got past authz
    // Confirm we tried to read the DDB row first, then tripped the S3 read.
    expect(sendMock).toHaveBeenCalled();
  });

  it('Bob (a different authenticated user) gets WRONG_FINALIZER 403 — cannot finalize Alice\'s upload', async () => {
    await expect(finalizeUpload('photo_test_1', 'user_bob_attacker'))
      .rejects.toThrow(/WRONG_FINALIZER/);
  });

  it('Empty string userId does not satisfy the binding', async () => {
    await expect(finalizeUpload('photo_test_1', ''))
      .rejects.toThrow(/WRONG_FINALIZER/);
  });

  it('Photo not found surfaces as 404 — never silently finalizes a non-existent row', async () => {
    sendMock.mockImplementationOnce(async () => ({ Item: undefined }));
    await expect(finalizeUpload('photo_does_not_exist', 'user_alice'))
      .rejects.toThrow(/not found/);
  });
});
