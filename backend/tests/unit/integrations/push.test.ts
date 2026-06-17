import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { sendNotificationMock, setVapidDetailsMock, sendDocClientMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn().mockResolvedValue(undefined),
  setVapidDetailsMock: vi.fn(),
  sendDocClientMock: vi.fn().mockResolvedValue({ Item: { subscription: { endpoint: 'https://example.com/push' } } }),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

vi.mock('../../../src/config/aws', () => ({
  docClient: { send: sendDocClientMock },
}));

import { sendPush } from '../../../src/services/integrations/push';
import { CaptureStore } from '../../../src/services/integrations/captureStore';

const ENV_VARS = ['APP_ENV', 'PUSH_MODE'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  sendNotificationMock.mockClear();
  sendDocClientMock.mockClear();
  CaptureStore.clear();
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sendPush — capture mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'staging';
    process.env.PUSH_MODE = 'capture';
  });

  it('never calls webpush.sendNotification', async () => {
    await sendPush('user1', 'Title', 'Body', 'https://example.com');
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('never even looks up the subscription in DynamoDB', async () => {
    await sendPush('user1', 'Title', 'Body');
    expect(sendDocClientMock).not.toHaveBeenCalled();
  });

  it('records the push to the capture store', async () => {
    await sendPush('user1', 'Title', 'Body', 'https://example.com/x');
    const pushes = CaptureStore.getPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ userId: 'user1', title: 'Title', body: 'Body', url: 'https://example.com/x' });
  });
});

describe('sendPush — live mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'production';
  });

  it('looks up the subscription and calls webpush.sendNotification', async () => {
    await sendPush('user1', 'Title', 'Body');
    expect(sendDocClientMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('does not write to the capture store in live mode', async () => {
    await sendPush('user1', 'Title', 'Body');
    expect(CaptureStore.getPushes()).toHaveLength(0);
  });

  it('does nothing if the user has no saved subscription', async () => {
    sendDocClientMock.mockResolvedValueOnce({ Item: undefined });
    await sendPush('user-no-sub', 'Title', 'Body');
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
