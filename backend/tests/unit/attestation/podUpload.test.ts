/**
 * H9 phase 3: size-capped uploads. The presigned POST policy - not the UI - is
 * the enforcement. These prove the policy is built correctly (S3 then rejects an
 * oversize/off-type upload against it) and that the MIME gate rejects off-list
 * types server-side even if the UI is bypassed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createPresignedPostMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ url: 'https://s3.example/bucket', fields: { key: 'k', Policy: 'p' } }),
);

vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: createPresignedPostMock }));
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class {}, GetObjectCommand: class {} }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));
vi.mock('../../../src/config/database', () => ({ Database: { putItem: vi.fn(), getItem: vi.fn(), scan: vi.fn() } }));
vi.mock('../../../src/utils/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { Logger: l, default: l };
});

import config from '../../../src/config/environment';
import { presignedPodPost, pinUploadMime } from '../../../src/services/attestation/podStorage';

beforeEach(() => createPresignedPostMock.mockClear());

describe('presignedPodPost policy (audit v6 H9)', () => {
  it('enforces the content-length range [1, POD_MAX_UPLOAD_BYTES] in the policy', async () => {
    await presignedPodPost('pod/DELIVERY/L1/p.jpg', 'image/jpeg');
    const params = createPresignedPostMock.mock.calls[0][1];
    const lenCond = params.Conditions.find((c: unknown) => Array.isArray(c) && c[0] === 'content-length-range');
    expect(lenCond).toEqual(['content-length-range', 1, config.pod.maxUploadBytes]);
  });

  it('pins the exact Content-Type in the policy + fields, and sets the key server-side', async () => {
    await presignedPodPost('headshots/u1.jpg', 'image/png');
    const params = createPresignedPostMock.mock.calls[0][1];
    expect(params.Key).toBe('headshots/u1.jpg');
    expect(params.Fields['Content-Type']).toBe('image/png');
    expect(params.Conditions).toContainEqual({ 'Content-Type': 'image/png' });
    expect(params.Expires).toBeGreaterThan(0);
  });
});

describe('pinUploadMime (server-side allowlist, audit v6 H9)', () => {
  it('accepts the allowlist and strips parameters', () => {
    expect(pinUploadMime('image/jpeg')).toBe('image/jpeg');
    expect(pinUploadMime('image/png')).toBe('image/png');
    expect(pinUploadMime('image/webp')).toBe('image/webp');
    expect(pinUploadMime('IMAGE/JPEG; charset=binary')).toBe('image/jpeg');
  });

  it('rejects an off-list type with a 415 even though a UI bypass could send it', () => {
    expect(() => pinUploadMime('application/pdf')).toThrowError(/Unsupported file type/);
    expect(() => pinUploadMime('text/html')).toThrow();
    try {
      pinUploadMime('application/octet-stream');
    } catch (e: any) {
      expect(e.statusCode).toBe(415);
    }
  });

  it('defaults a non-string to image/jpeg', () => {
    expect(pinUploadMime(undefined)).toBe('image/jpeg');
  });
});
