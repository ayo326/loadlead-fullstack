// Support ticketing surface.
//
// Two mount points share this file:
//   - POST /api/support/inbound  -- Resend Inbound webhook. Verifies
//     signature, dedupes by email_id, threads via standard headers,
//     creates / appends to tickets. NEVER under requireAdmin -- it's
//     called by Resend.
//   - GET/POST/PATCH /api/support/...  -- staff API. Behind
//     authenticate + requireAdmin.

import express from 'express';
import { authenticate, requireAdmin, requireStaffTier, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { SupportTicketService } from '../services/supportTicket';
import { verifyResendSignature } from '../services/resendInbound';
import { computeSlaState, aggregateMonitor } from '../services/sla';
import { DESTRUCTIVE_TIER } from '../types/platformRole';
import { EmailService } from '../services/emailService';
import Logger from '../utils/logger';
import type { SupportTicket, TicketStatus, TicketPriority } from '../types/support';

const router = express.Router();

// ─── PUBLIC: Resend Inbound webhook ─────────────────────────────────────────
//
// Mounted BEFORE authenticate so Resend's webhook reaches us. The raw
// body is preserved by the express.json() verify hook in index.ts.
router.post('/inbound', asyncHandler(async (req, res) => {
  const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body);

  // 1. Signature -- prod must have the secret. We refuse unsigned mail.
  const verify = verifyResendSignature({
    rawBody,
    headers: req.headers as any,
    secret: process.env.RESEND_WEBHOOK_SECRET,
  });
  if (!verify.ok) {
    Logger.warn(`[support] inbound rejected: ${verify.reason}`);
    return res.status(400).json({ error: verify.reason ?? 'bad-signature' });
  }

  const payload = req.body;
  // Resend envelope:  { type: 'email.received', data: { id, from, to[], subject, html, text, headers[], ... } }
  if (payload?.type !== 'email.received' || !payload?.data) {
    return res.status(200).json({ ignored: 'not-email-received' });   // don't surface webhook noise as failure
  }
  const data = payload.data;

  // 2. Idempotency.
  const fresh = await SupportTicketService.claimInboundId(String(data.id));
  if (!fresh) {
    return res.status(200).json({ status: 'duplicate', emailId: data.id });
  }

  // 3. Parse headers.
  const hdrs = parseHeaders(data.headers);
  const messageId  = hdrs['message-id']   ?? null;
  const inReplyTo  = hdrs['in-reply-to']  ?? null;
  const references = hdrs['references']   ?? null;
  const toList     = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
  const fromEmail  = (data.from ?? '').toLowerCase();
  const subject    = data.subject ?? '(no subject)';

  // 4. Threading.
  let ticket = await SupportTicketService.resolveThread({
    to: toList, inReplyTo, references,
  });
  if (!ticket) {
    ticket = await SupportTicketService.createTicket({
      subject,
      requesterEmail: fromEmail,
      requesterName:  data.fromName ?? null,
    });
  }

  // 5. Persist the inbound message; service handles reopen + lastMessageAt.
  await SupportTicketService.appendMessage({
    ticketId:  ticket.ticketId,
    direction: 'INBOUND',
    fromEmail,
    toEmail:   toList[0] ?? '',
    bodyText:  data.text ?? null,
    bodyHtml:  data.html ?? null,
    emailMessageId: messageId,
    inReplyTo,
    references,
    authorStaffId: null,
  });

  return res.status(200).json({ status: 'ok', ticketId: ticket.ticketId });
}));

function parseHeaders(arr: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(arr)) return out;
  for (const h of arr) {
    if (h?.name && typeof h.value === 'string') out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

// ─── STAFF API (all routes below require admin authentication) ─────────────
router.use(authenticate);
router.use(requireAdmin);

/** GET /api/support/tickets?status=&assignee= */
router.get('/tickets', asyncHandler(async (req: AuthRequest, res) => {
  const all = await SupportTicketService.listTickets();
  const { status, assignee } = req.query as Record<string, string | undefined>;
  const filtered = all.filter((t) => {
    if (status   && t.status          !== status)   return false;
    if (assignee && t.assigneeStaffId !== assignee) return false;
    return true;
  });
  const enriched = filtered
    .map((t) => ({ ...t, sla: computeSlaState(t) }))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  res.json({ items: enriched });
}));

/** GET /api/support/tickets/:id  -- full thread + ticket */
router.get('/tickets/:ticketId', asyncHandler(async (req: AuthRequest, res) => {
  const t = await SupportTicketService.getTicket(req.params.ticketId);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const thread = await SupportTicketService.getThread(t.ticketId);
  res.json({ ticket: t, sla: computeSlaState(t), thread });
}));

/** POST /api/support/tickets  -- staff creates a ticket (from drawer) */
router.post('/tickets', asyncHandler(async (req: AuthRequest, res) => {
  const { subject, requesterEmail, requesterName, priority, linkedOrgId, linkedDriverId } = req.body ?? {};
  if (!subject || !requesterEmail) return res.status(400).json({ error: 'subject and requesterEmail required' });
  const t = await SupportTicketService.createTicket({
    subject, requesterEmail, requesterName, priority, linkedOrgId, linkedDriverId,
  });
  res.status(201).json({ ticket: t });
}));

/** PATCH /api/support/tickets/:id  -- assign, status, priority, links */
router.patch('/tickets/:ticketId', asyncHandler(async (req: AuthRequest, res) => {
  const t = await SupportTicketService.getTicket(req.params.ticketId);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const patch: Partial<SupportTicket> = {};
  const allowed = ['status', 'priority', 'assigneeStaffId', 'linkedOrgId', 'linkedDriverId'] as const;
  for (const k of allowed) if (k in req.body) (patch as any)[k] = req.body[k];
  if (patch.status === 'SOLVED' && !t.resolvedAt) patch.resolvedAt = Date.now();
  if (patch.status && patch.status !== 'SOLVED') patch.resolvedAt = null;
  await SupportTicketService.updateTicket(t.ticketId, patch);
  res.json({ ok: true });
}));

/** POST /api/support/tickets/:id/messages  -- staff reply via Resend, threaded */
router.post('/tickets/:ticketId/messages', asyncHandler(async (req: AuthRequest, res) => {
  const t = await SupportTicketService.getTicket(req.params.ticketId);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });

  const { bodyText, bodyHtml } = req.body ?? {};
  if (!bodyText && !bodyHtml) return res.status(400).json({ error: 'bodyText or bodyHtml required' });

  // Build the threading headers from the most recent inbound message
  // so the reply lands in the requester's existing email chain.
  const thread = await SupportTicketService.getThread(t.ticketId);
  const lastIn = [...thread].reverse().find((m) => m.direction === 'INBOUND');

  const messageId  = `<${t.ticketId}.${Date.now()}@support.loadleadapp.com>`;
  const inReplyTo  = lastIn?.emailMessageId ?? null;
  const references = [lastIn?.references, lastIn?.emailMessageId].filter(Boolean).join(' ') || null;
  const fromAddr   = process.env.SUPPORT_FROM_ADDRESS || 'support@loadleadapp.com';

  // Send via the existing Resend send (raw HTML body wrapper isn't
  // necessary -- threaded email lives or dies on the headers, not the
  // markup).
  await EmailService.sendRawSupportReply?.({
    to: t.requesterEmail,
    from: fromAddr,
    subject: t.subject.toLowerCase().startsWith('re:') ? t.subject : `Re: ${t.subject}`,
    bodyHtml: bodyHtml || `<p>${(bodyText ?? '').replace(/\n/g, '<br/>')}</p>`,
    headers: {
      'Message-ID':  messageId,
      'In-Reply-To': inReplyTo  ?? '',
      'References':  references ?? '',
    },
  }).catch((err: any) => Logger.error('[support] outbound send failed', err));

  const m = await SupportTicketService.appendMessage({
    ticketId: t.ticketId,
    direction: 'OUTBOUND',
    fromEmail: fromAddr,
    toEmail:   t.requesterEmail,
    bodyText:  bodyText ?? null,
    bodyHtml:  bodyHtml ?? null,
    emailMessageId: messageId,
    inReplyTo,
    references,
    authorStaffId: req.user!.userId,
  });
  res.status(201).json({ message: m });
}));

/** GET /api/support/settings -- SLA policy */
router.get('/settings', asyncHandler(async (_req: AuthRequest, res) => {
  res.json({ settings: await SupportTicketService.getSettings() });
}));

/** PUT /api/support/settings -- STAFF_ADMIN only sets SLA policy */
router.put('/settings', requireStaffTier(...DESTRUCTIVE_TIER), asyncHandler(async (req: AuthRequest, res) => {
  const { slaTargetMinutes, slaFirstResponseMinutes, perPriority } = req.body ?? {};
  if (!Number.isFinite(slaTargetMinutes) || slaTargetMinutes <= 0) {
    return res.status(400).json({ error: 'slaTargetMinutes must be a positive number' });
  }
  const saved = await SupportTicketService.setSettings({
    slaTargetMinutes,
    slaFirstResponseMinutes: slaFirstResponseMinutes ?? null,
    perPriority: perPriority ?? {},
    updatedBy: req.user!.userId,
  });
  res.json({ settings: saved });
}));

/** GET /api/support/monitor -- aggregate counts + % within SLA */
router.get('/monitor', asyncHandler(async (_req: AuthRequest, res) => {
  const all = await SupportTicketService.listTickets();
  res.json(aggregateMonitor(all));
}));

export default router;
