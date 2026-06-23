// services/integrations/email.ts
//
// Resend adapter. Ships to every environment, including production. Moved
// the actual Resend call out of services/emailService.ts — emailService.ts
// keeps every public method (welcome, loadMatched, offerAccepted, ...)
// exactly as-is; only its internal send() helper now delegates here.
//
// Test mode rewrites the recipient to a safe @resend.dev test address and
// records what was attempted into the capture store for GET /_test/outbox
// to expose. It STILL makes a real Resend API call — to the safe rewritten
// address, using a separate staging Resend key — never to the original
// recipient. resend.dev addresses are Resend's own sandbox inboxes: mail
// shows as delivered in the Resend dashboard but is never actually sent
// anywhere.

import { Resend } from 'resend';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const sesClient = new SESv2Client({ region: process.env.AWS_REGION || 'us-east-1' });

// SES raw email send. Builds a complete RFC-822 message with the
// threading headers in the right places so customer email clients
// stitch the reply into the original conversation.
async function sendRawViaSes(params: {
  to: string;
  from?: string;
  subject: string;
  bodyHtml: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const from    = params.from ?? process.env.SUPPORT_FROM_ADDRESS ?? FROM;
  const boundary = `bnd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // Strip empty header values; an empty In-Reply-To upsets Gmail.
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers ?? {})) if (v) extra[k] = v;

  const headerLines = [
    `From: ${from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.bodyHtml,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const raw = headerLines.join('\r\n') + '\r\n\r\n' + body;

  await sesClient.send(new SendEmailCommand({
    Content: { Raw: { Data: Buffer.from(raw, 'utf8') } },
  }));
}
import { resolveMode } from './modeResolver';
import { CaptureStore } from './captureStore';
import Logger from '../../utils/logger';

const FROM = 'LoadLead <noreply@loadleadapp.com>';

/**
 * Build the safe test recipient. The real inbox address (e.g.
 * delivered@resend.dev) lives ONLY in env config (.env.staging / CI
 * secrets), never as a literal here — this file ships to production, and
 * hardcoding it would also trip deploy-backend.sh's deploy-time scan, which
 * treats that address as a forbidden marker precisely so it can never appear
 * in a production artifact.
 */
function buildTestRecipient(originalTo: string): string {
  const inbox = process.env.EMAIL_TEST_INBOX?.trim();
  if (!inbox) {
    Logger.warn(
      '[integrations/email] test mode but EMAIL_TEST_INBOX is not set — using a placeholder that delivers nowhere',
    );
    return 'unset-test-inbox@example.invalid';
  }

  const atIndex = inbox.indexOf('@');
  if (atIndex === -1) return inbox;

  // Label per original recipient so multiple sends in one run are
  // distinguishable in the Resend dashboard / GET /_test/outbox.
  const label = encodeURIComponent(originalTo.split('@')[0] || 'unknown').slice(0, 40);
  return `${inbox.slice(0, atIndex)}+${label}${inbox.slice(atIndex)}`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const mode = resolveMode('email');
  const actualTo = mode === 'live' ? to : buildTestRecipient(to);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to: actualTo, subject, html });
  } catch (err: any) {
    Logger.error(`[integrations/email] send failed (mode=${mode}): ${err?.message ?? err}`);
  }

  if (mode !== 'live') {
    CaptureStore.recordEmail({
      to: actualTo,
      originalTo: to,
      subject,
      html,
      mode,
      capturedAt: new Date().toISOString(),
    });
  }
}

// Raw-headers variant for support replies: we must set Message-ID,
// In-Reply-To, and References so the reply stitches into the requester's
// existing email thread.
//
// Provider selection:
//   - When SUPPORT_OUTBOUND_PROVIDER=ses (default for support replies),
//     send via AWS SES SDK. SES has inbound.loadleadapp.com verified
//     for sending, which Resend's free plan does not.
//   - Otherwise (or as fallback), send via Resend.
//
// The customer's email client threads on Message-ID / In-Reply-To /
// References, which we set per-message regardless of provider.
export async function sendRawEmail(params: {
  to: string;
  from?: string;
  subject: string;
  bodyHtml: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const mode     = resolveMode('email');
  const actualTo = mode === 'live' ? params.to : buildTestRecipient(params.to);
  const provider = (process.env.SUPPORT_OUTBOUND_PROVIDER || 'ses').toLowerCase();

  try {
    if (provider === 'ses') {
      await sendRawViaSes({ ...params, to: actualTo });
    } else {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from:    params.from ?? FROM,
        to:      actualTo,
        subject: params.subject,
        html:    params.bodyHtml,
        headers: params.headers ?? {},
      });
    }
  } catch (err: any) {
    Logger.error(`[integrations/email] sendRaw failed (provider=${provider}, mode=${mode}): ${err?.message ?? err}`);
    throw err;
  }
  if (mode !== 'live') {
    CaptureStore.recordEmail({
      to: actualTo,
      originalTo: params.to,
      subject: params.subject,
      html: params.bodyHtml,
      mode,
      capturedAt: new Date().toISOString(),
    });
  }
}
