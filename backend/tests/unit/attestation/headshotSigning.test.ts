/**
 * H9 residual (audit v6): the driver headshot object lives in the private POD
 * bucket. DriverService signs it at profile-read time - never returns a stored
 * public URL. New rows carry headshotKey; legacy rows carry only headshotUrl and
 * the deterministic key is derived (headshots/<userId>.jpg) so they keep working.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getItem, updateItem } = vi.hoisted(() => ({ getItem: vi.fn(), updateItem: vi.fn() }));
const signedPodGetUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue('https://signed.example/headshot?sig=x'));

vi.mock('../../../src/config/database', () => ({
  Database: { getItem, scan: vi.fn().mockResolvedValue([]), updateItem, query: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../src/utils/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { Logger: l, default: l };
});
vi.mock('../../../src/services/attestation/podStorage', () => ({ signedPodGetUrl: signedPodGetUrlMock }));

import { DriverService } from '../../../src/services/driverService';

beforeEach(() => {
  getItem.mockReset();
  updateItem.mockReset();
  signedPodGetUrlMock.mockClear().mockResolvedValue('https://signed.example/headshot?sig=x');
});

describe('DriverService headshot sign-at-read (audit v6 H9)', () => {
  it('signs a fresh headshotUrl from the stored headshotKey', async () => {
    getItem.mockResolvedValueOnce({ driverId: 'drv-1', userId: 'u-1', headshotKey: 'headshots/u-1.jpg' });
    const driver = await DriverService.getProfileById('drv-1');
    expect(signedPodGetUrlMock).toHaveBeenCalledWith('headshots/u-1.jpg', expect.any(Number));
    expect(driver?.headshotUrl).toBe('https://signed.example/headshot?sig=x');
    expect(driver?.headshotKey).toBe('headshots/u-1.jpg');
  });

  it('derives the deterministic key for a legacy row that has only a stored headshotUrl', async () => {
    getItem.mockResolvedValueOnce({ driverId: 'drv-2', userId: 'u-2', headshotUrl: 'https://old-public/headshots/u-2.jpg' });
    const driver = await DriverService.getProfileById('drv-2');
    expect(signedPodGetUrlMock).toHaveBeenCalledWith('headshots/u-2.jpg', expect.any(Number));
    expect(driver?.headshotUrl).toBe('https://signed.example/headshot?sig=x'); // re-signed, not the stored public URL
  });

  it('leaves a driver with no headshot unchanged and never signs', async () => {
    getItem.mockResolvedValueOnce({ driverId: 'drv-3', userId: 'u-3' });
    const driver = await DriverService.getProfileById('drv-3');
    expect(signedPodGetUrlMock).not.toHaveBeenCalled();
    expect(driver?.headshotUrl).toBeUndefined();
  });

  it('never breaks a profile read if signing throws - returns the driver as stored', async () => {
    getItem.mockResolvedValueOnce({ driverId: 'drv-4', userId: 'u-4', headshotKey: 'headshots/u-4.jpg' });
    signedPodGetUrlMock.mockRejectedValueOnce(new Error('KMS down'));
    const driver = await DriverService.getProfileById('drv-4');
    expect(driver?.driverId).toBe('drv-4'); // still returned
  });
});

describe('DriverService.updateProfile headshot write guard (audit v6 H9 phase 5)', () => {
  it('persists headshotKey but never persists a client-supplied headshotUrl', async () => {
    await DriverService.updateProfile('drv-w1', {
      headshotKey: 'headshots/u-w1.jpg',
      // A client PUTs this straight into req.body; it must not be stored - the
      // read path signs a fresh URL from the key, never a stored URL.
      headshotUrl: 'https://attacker.example/evil.jpg',
    } as any);
    expect(updateItem).toHaveBeenCalledTimes(1);
    const persisted = updateItem.mock.calls[0][2];
    expect(persisted.headshotKey).toBe('headshots/u-w1.jpg');
    expect('headshotUrl' in persisted).toBe(false);
  });

  it('drops a lone headshotUrl too (no key supplied)', async () => {
    await DriverService.updateProfile('drv-w2', { headshotUrl: 'https://x/y.jpg' } as any);
    const persisted = updateItem.mock.calls[0][2];
    expect('headshotUrl' in persisted).toBe(false);
  });
});
