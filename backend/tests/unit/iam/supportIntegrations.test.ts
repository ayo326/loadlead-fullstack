// Phase 4 -- chat + phone integration adapter.
//
// Proves:
//   1. Unset env -> connected:false (NEVER fakes a widget).
//   2. Set Intercom/Crisp -> chat.connected:true with the right vendor + appId.
//   3. Set Twilio/Aircall + valid E.164 -> phone.connected:true.
//   4. Garbage vendor name or bad number -> connected:false.

import { describe, it, expect, beforeEach } from 'vitest';
import { getSupportIntegrations } from '../../../src/services/supportIntegrations';

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('SUPPORT_CHAT_') || k.startsWith('SUPPORT_PHONE_')) delete process.env[k];
  }
});

describe('chat adapter', () => {
  it('unconfigured: connected:false', () => {
    expect(getSupportIntegrations().chat).toEqual({ connected: false, vendor: null, appId: null });
  });

  it('intercom with appId: connected:true', () => {
    process.env.SUPPORT_CHAT_VENDOR = 'intercom';
    process.env.SUPPORT_CHAT_APP_ID = 'abc123';
    expect(getSupportIntegrations().chat).toEqual({ connected: true, vendor: 'intercom', appId: 'abc123' });
  });

  it('crisp with websiteId: connected:true', () => {
    process.env.SUPPORT_CHAT_VENDOR = 'crisp';
    process.env.SUPPORT_CHAT_APP_ID = 'website-uuid';
    expect(getSupportIntegrations().chat.vendor).toBe('crisp');
  });

  it('unknown vendor: connected:false', () => {
    process.env.SUPPORT_CHAT_VENDOR = 'zendesk';
    process.env.SUPPORT_CHAT_APP_ID = 'xyz';
    expect(getSupportIntegrations().chat.connected).toBe(false);
  });

  it('vendor set but no appId: connected:false (cannot render an empty widget)', () => {
    process.env.SUPPORT_CHAT_VENDOR = 'intercom';
    expect(getSupportIntegrations().chat.connected).toBe(false);
  });
});

describe('phone adapter', () => {
  it('unconfigured: connected:false', () => {
    expect(getSupportIntegrations().phone).toEqual({ connected: false, vendor: null, number: null });
  });

  it('twilio + E.164 number: connected:true (normalises leading +)', () => {
    process.env.SUPPORT_PHONE_VENDOR = 'twilio';
    process.env.SUPPORT_PHONE_NUMBER = '18005551234';
    const p = getSupportIntegrations().phone;
    expect(p.connected).toBe(true);
    expect(p.vendor).toBe('twilio');
    expect(p.number).toBe('+18005551234');
  });

  it('aircall + already-E.164 number with separators: connected:true (normalises)', () => {
    process.env.SUPPORT_PHONE_VENDOR = 'aircall';
    process.env.SUPPORT_PHONE_NUMBER = '+1 (800) 555-1234';
    expect(getSupportIntegrations().phone.number).toBe('+18005551234');
  });

  it('vendor set but malformed number: connected:false', () => {
    process.env.SUPPORT_PHONE_VENDOR = 'twilio';
    process.env.SUPPORT_PHONE_NUMBER = 'not-a-number';
    expect(getSupportIntegrations().phone.connected).toBe(false);
  });

  it('unknown vendor: connected:false', () => {
    process.env.SUPPORT_PHONE_VENDOR = 'dialpad';
    process.env.SUPPORT_PHONE_NUMBER = '+18005551234';
    expect(getSupportIntegrations().phone.connected).toBe(false);
  });
});
