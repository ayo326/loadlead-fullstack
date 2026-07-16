/**
 * H9 residual (audit v6): POD serving seam.
 * - signedPodGetUrl signs a GET against the private POD bucket.
 * - recordPodAccess appends to the POD access log (write-before-URL, fail-closed).
 * - driverService signs the headshot at profile-read time (private bucket).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { putItem, getItem, scan } = vi.hoisted(() => ({
  putItem: vi.fn().mockResolvedValue(undefined),
  getItem: vi.fn(),
  scan: vi.fn().mockResolvedValue([]),
}));
const getSignedUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue('https://signed.example/pod?sig=abc'));

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem: vi.fn(), query: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../src/utils/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { Logger: l, default: l };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: getSignedUrlMock }));
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class {}, GetObjectCommand: class {}, PutObjectCommand: class {} }));

import config from '../../../src/config/environment';
import { signedPodGetUrl, recordPodAccess } from '../../../src/services/attestation/podStorage';

beforeEach(() => {
  putItem.mockClear();
  getItem.mockReset();
  getSignedUrlMock.mockClear().mockResolvedValue('https://signed.example/pod?sig=abc');
});

describe('signedPodGetUrl', () => {
  it('signs a GET for the POD bucket at the configured TTL', async () => {
    const url = await signedPodGetUrl('pod/DELIVERY/load-1/photo-1.jpg');
    expect(url).toContain('signed.example');
    const opts = getSignedUrlMock.mock.calls[0][2];
    expect(opts.expiresIn).toBe(config.pod.signedGetTtlSeconds);
  });

  it('honors an explicit (headshot) TTL', async () => {
    await signedPodGetUrl('headshots/u1.jpg', config.pod.headshotSignedGetTtlSeconds);
    expect(getSignedUrlMock.mock.calls[0][2].expiresIn).toBe(config.pod.headshotSignedGetTtlSeconds);
  });
});

describe('recordPodAccess', () => {
  it('appends an access-log row (who/what/when/basis) to the POD access-log table', async () => {
    const row = await recordPodAccess('photo-1', 'load-1', 'user-9', 'CHAIN_PARTY');
    expect(putItem).toHaveBeenCalledTimes(1);
    const [table, item] = putItem.mock.calls[0];
    expect(table).toBe(config.dynamodb.podAccessLogTable);
    expect(item).toMatchObject({ photoId: 'photo-1', loadId: 'load-1', viewerAccountId: 'user-9', basis: 'CHAIN_PARTY' });
    expect(item.accessId).toMatch(/^podacc_/);
    expect(typeof item.createdAt).toBe('number');
    expect(row.accessId).toBe(item.accessId);
  });
});
