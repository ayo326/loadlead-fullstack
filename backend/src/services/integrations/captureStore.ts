// services/integrations/captureStore.ts
//
// In-memory inspectable store for what the email/push adapters captured
// instead of dispatching live, in test/capture mode. Backs GET /_test/outbox
// (routes/_test) so E2E runs can assert "an email/push WOULD have gone out"
// without anything reaching a real inbox or device. Process-lifetime only -
// no durability needed; a dev/staging EB instance restart clearing it is
// fine and arguably desirable (no stale captures across deploys).
//
// This module itself is NOT test-only code: it's referenced by the email.ts
// and push.ts adapters, which run in every environment (just never doing
// anything in 'live'/production mode). Only the route that exposes it
// (routes/_test/outbox.ts) is non-production-only.

export interface CapturedEmail {
  to: string;
  originalTo: string;
  subject: string;
  html: string;
  mode: string;
  capturedAt: string;
}

export interface CapturedPush {
  userId: string;
  title: string;
  body: string;
  url: string;
  capturedAt: string;
}

const MAX_ENTRIES = 200;

const emails: CapturedEmail[] = [];
const pushes: CapturedPush[] = [];

export const CaptureStore = {
  recordEmail(entry: CapturedEmail): void {
    emails.unshift(entry);
    emails.length = Math.min(emails.length, MAX_ENTRIES);
  },

  recordPush(entry: CapturedPush): void {
    pushes.unshift(entry);
    pushes.length = Math.min(pushes.length, MAX_ENTRIES);
  },

  getEmails(): CapturedEmail[] {
    return emails.slice();
  },

  getPushes(): CapturedPush[] {
    return pushes.slice();
  },

  clear(): void {
    emails.length = 0;
    pushes.length = 0;
  },
};
