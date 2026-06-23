// Support-channel integrations adapter.
//
// One thin abstraction over chat (Intercom / Crisp) and phone (Twilio /
// Aircall) so the vendor stays swappable. Env-driven configuration; if
// keys are missing the surface reports `connected: false` and the
// frontend renders a 'not connected' pill -- never a fake widget.
//
// No secret values are returned over the wire. Public widget IDs
// (Intercom app_id, Crisp website_id) are fine because they're already
// embedded in client-side script tags by every customer using those
// products. Click-to-call phone numbers are also public.
//
// To add a new vendor: add it to the union types below, extend the
// resolver, and the frontend renderer.

export type ChatVendor  = 'intercom' | 'crisp';
export type PhoneVendor = 'twilio'   | 'aircall';

export interface ChatConfig {
  connected: boolean;
  vendor:    ChatVendor | null;
  /** Public widget identifier safe to bundle into client-side JS. */
  appId:     string | null;
}

export interface PhoneConfig {
  connected: boolean;
  vendor:    PhoneVendor | null;
  /** E.164 click-to-call number, e.g. "+18005551234". */
  number:    string | null;
}

export interface SupportIntegrationsConfig {
  chat:  ChatConfig;
  phone: PhoneConfig;
}

function resolveChat(): ChatConfig {
  const vendor = (process.env.SUPPORT_CHAT_VENDOR ?? '').toLowerCase() as ChatVendor | '';
  const appId  = process.env.SUPPORT_CHAT_APP_ID ?? '';
  if ((vendor === 'intercom' || vendor === 'crisp') && appId.length > 0) {
    return { connected: true, vendor, appId };
  }
  return { connected: false, vendor: null, appId: null };
}

function resolvePhone(): PhoneConfig {
  const vendor = (process.env.SUPPORT_PHONE_VENDOR ?? '').toLowerCase() as PhoneVendor | '';
  const number = (process.env.SUPPORT_PHONE_NUMBER ?? '').trim();
  if ((vendor === 'twilio' || vendor === 'aircall') && /^\+?\d{6,15}$/.test(number.replace(/[-\s()]/g, ''))) {
    // Normalise to E.164 (leading + if missing).
    const digits = number.replace(/[-\s()]/g, '');
    const e164   = digits.startsWith('+') ? digits : `+${digits}`;
    return { connected: true, vendor, number: e164 };
  }
  return { connected: false, vendor: null, number: null };
}

export function getSupportIntegrations(): SupportIntegrationsConfig {
  return { chat: resolveChat(), phone: resolvePhone() };
}
