/**
 * H9 residual (audit v6): GET /api/attestation/photos/:photoId/url security
 * contract - a load party (or admin) gets a short-lived signed URL and the open
 * is access-logged BEFORE the URL is issued; an unrelated account is refused
 * with no URL and no log entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { getLoadById } = vi.hoisted(() => ({ getLoadById: vi.fn() }));
const { getPhoto } = vi.hoisted(() => ({ getPhoto: vi.fn() }));
const { assertChainReadAccess } = vi.hoisted(() => ({ assertChainReadAccess: vi.fn() }));
const { signedPodGetUrl, recordPodAccess } = vi.hoisted(() => ({ signedPodGetUrl: vi.fn(), recordPodAccess: vi.fn() }));
const holder = vi.hoisted(() => ({ user: { userId: 'shipper-1', role: 'SHIPPER' } as { userId: string; role: string } }));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = holder.user; next(); },
}));
vi.mock('../../../src/services/loadService', () => ({ LoadService: { getLoadById } }));
vi.mock('../../../src/services/attestation/podPhotoService', () => ({
  getPhoto, requestUploadUrl: vi.fn(), finalizeUpload: vi.fn(), listReadyPhotos: vi.fn(),
}));
vi.mock('../../../src/services/attestation/assertSignerIsLoadParty', () => ({
  assertChainReadAccess, assertSignerIsLoadParty: vi.fn(),
}));
vi.mock('../../../src/services/attestation/podStorage', () => ({ signedPodGetUrl, recordPodAccess }));
vi.mock('../../../src/services/attestation/signatureService', () => ({ recordSignature: vi.fn(), getChain: vi.fn() }));
vi.mock('../../../src/services/carrierOfRecord', () => ({ resolveCarrierOfRecord: vi.fn() }));
vi.mock('../../../src/services/driverService', () => ({ DriverService: {} }));
vi.mock('../../../src/services/shipperService', () => ({ ShipperService: {} }));
vi.mock('../../../src/utils/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { Logger: l, default: l };
});

import attestationRouter from '../../../src/routes/attestation';
import { errorHandler, AppError } from '../../../src/middleware/errorHandler';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/attestation', attestationRouter);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  getLoadById.mockReset();
  getPhoto.mockReset();
  assertChainReadAccess.mockReset();
  signedPodGetUrl.mockReset().mockResolvedValue('https://signed.example/pod?sig=x');
  recordPodAccess.mockReset().mockResolvedValue({});
  holder.user = { userId: 'shipper-1', role: 'SHIPPER' };
});

describe('GET /api/attestation/photos/:photoId/url', () => {
  it('an authorized load party gets a signed URL and the open is access-logged', async () => {
    getPhoto.mockResolvedValue({ photoId: 'p1', loadId: 'L1', s3Key: 'pod/DELIVERY/L1/p1.jpg' });
    getLoadById.mockResolvedValue({ loadId: 'L1', shipperId: 'S1' });
    assertChainReadAccess.mockResolvedValue({ allowedUserIds: new Set(['shipper-1']), matchedAsAdmin: false });

    const res = await request(app()).get('/api/attestation/photos/p1/url');

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://signed.example/pod?sig=x');
    expect(recordPodAccess).toHaveBeenCalledWith('p1', 'L1', 'shipper-1', 'CHAIN_PARTY');
    expect(signedPodGetUrl).toHaveBeenCalledWith('pod/DELIVERY/L1/p1.jpg');
  });

  it('records an ADMIN basis when matched as admin', async () => {
    holder.user = { userId: 'admin-1', role: 'ADMIN' };
    getPhoto.mockResolvedValue({ photoId: 'p1', loadId: 'L1', s3Key: 'k' });
    getLoadById.mockResolvedValue({ loadId: 'L1' });
    assertChainReadAccess.mockResolvedValue({ allowedUserIds: new Set(['admin-1']), matchedAsAdmin: true });

    const res = await request(app()).get('/api/attestation/photos/p1/url');
    expect(res.status).toBe(200);
    expect(recordPodAccess).toHaveBeenCalledWith('p1', 'L1', 'admin-1', 'ADMIN');
  });

  it('refuses an unrelated account 403 with NO url and NO access-log entry', async () => {
    getPhoto.mockResolvedValue({ photoId: 'p1', loadId: 'L1', s3Key: 'k' });
    getLoadById.mockResolvedValue({ loadId: 'L1' });
    assertChainReadAccess.mockRejectedValue(new AppError('WRONG_READER', 403));

    const res = await request(app()).get('/api/attestation/photos/p1/url');
    expect(res.status).toBe(403);
    expect(signedPodGetUrl).not.toHaveBeenCalled();
    expect(recordPodAccess).not.toHaveBeenCalled();
  });

  it('404s when the photo does not exist (no log, no url)', async () => {
    getPhoto.mockResolvedValue(null);
    const res = await request(app()).get('/api/attestation/photos/nope/url');
    expect(res.status).toBe(404);
    expect(recordPodAccess).not.toHaveBeenCalled();
    expect(signedPodGetUrl).not.toHaveBeenCalled();
  });
});
