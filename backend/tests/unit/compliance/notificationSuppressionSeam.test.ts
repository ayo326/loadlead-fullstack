/**
 * Live-path seam: PushService.send suppresses a routine notification about a load
 * under a lawful non-disclosure order, and delivers normally otherwise.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { record, sendPush, isEntityRestricted } = vi.hoisted(() => ({
  record: vi.fn(async () => undefined),
  sendPush: vi.fn(async () => undefined),
  isEntityRestricted: vi.fn(async () => false),
}));
vi.mock('../../../src/services/notificationService', () => ({ NotificationService: { record } }));
vi.mock('../../../src/services/integrations/push', () => ({ sendPush }));
vi.mock('../../../src/services/lawEnforcementService', () => ({ LawEnforcementService: { isEntityRestricted } }));
vi.mock('../../../src/config/aws', () => ({ docClient: { send: vi.fn() } }));
vi.mock('../../../src/utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }, Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { PushService } from '../../../src/services/pushService';

beforeEach(() => { record.mockClear(); sendPush.mockClear(); isEntityRestricted.mockReset(); });

describe('notification suppression under non-disclosure', () => {
  it('suppresses a load notification when the load is restricted (neither inbox nor push)', async () => {
    isEntityRestricted.mockResolvedValue(true);
    await PushService.send('user-1', 'New load offered', 'body', '/driver/loads/load-1');
    expect(isEntityRestricted).toHaveBeenCalledWith('LOAD', 'load-1');
    expect(record).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('delivers normally when the load is not restricted', async () => {
    isEntityRestricted.mockResolvedValue(false);
    await PushService.send('user-1', 'New load offered', 'body', '/driver/loads/load-2');
    expect(record).toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalled();
  });

  it('delivers notifications with no load subject without a restriction check path blocking them', async () => {
    await PushService.send('user-1', 'Verification update', 'body', '/settings');
    expect(record).toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalled();
  });
});
