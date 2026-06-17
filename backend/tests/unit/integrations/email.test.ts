import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'fake-id' }, error: null }),
}));

vi.mock('resend', () => ({
  // Resend is invoked as `new Resend(...)` — must be a real constructor, not an arrow function.
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send: sendMock } };
  }),
}));

import { sendEmail } from '../../../src/services/integrations/email';
import { CaptureStore } from '../../../src/services/integrations/captureStore';

const ENV_VARS = ['APP_ENV', 'EMAIL_MODE', 'EMAIL_TEST_INBOX', 'RESEND_API_KEY'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  sendMock.mockClear();
  CaptureStore.clear();
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sendEmail — test mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'staging';
    process.env.EMAIL_MODE = 'test';
    process.env.EMAIL_TEST_INBOX = 'delivered@resend.dev';
  });

  it('rewrites the recipient to the labeled test inbox, never the original address', async () => {
    await sendEmail('realuser@shipper.com', 'Subject', '<p>hi</p>');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentTo = sendMock.mock.calls[0][0].to;
    expect(sentTo).not.toBe('realuser@shipper.com');
    expect(sentTo).toBe('delivered+realuser@resend.dev');
  });

  it('records the attempt in the capture store, with the original recipient preserved', async () => {
    await sendEmail('realuser@shipper.com', 'Subject', '<p>hi</p>');
    const emails = CaptureStore.getEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].originalTo).toBe('realuser@shipper.com');
    expect(emails[0].to).toBe('delivered+realuser@resend.dev');
    expect(emails[0].mode).toBe('test');
  });

  it('falls back to a non-delivering placeholder if EMAIL_TEST_INBOX is unset', async () => {
    delete process.env.EMAIL_TEST_INBOX;
    await sendEmail('realuser@shipper.com', 'Subject', '<p>hi</p>');
    const sentTo = sendMock.mock.calls[0][0].to;
    expect(sentTo).toBe('unset-test-inbox@example.invalid');
  });
});

describe('sendEmail — live mode', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'production'; // live email is only reachable via APP_ENV=production in real usage
    process.env.RESEND_API_KEY = 'test-key';
  });

  it('sends to the real recipient unmodified', async () => {
    await sendEmail('realuser@shipper.com', 'Subject', '<p>hi</p>');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe('realuser@shipper.com');
  });

  it('does not write to the capture store in live mode', async () => {
    await sendEmail('realuser@shipper.com', 'Subject', '<p>hi</p>');
    expect(CaptureStore.getEmails()).toHaveLength(0);
  });
});
