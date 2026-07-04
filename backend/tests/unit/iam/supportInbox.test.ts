// Phase 3 — Email support inbox.
//
// Proves the five spec requirements end-to-end:
//   1. Email to support@ creates an OPEN ticket via the SIGNED webhook.
//   2. Same payload twice does not duplicate (claimInboundId).
//   3. Staff reply hits Resend send AND threads via In-Reply-To /
//      References / Message-ID.
//   4. firstResponseAt stamps on the first OUTBOUND; resolvedAt stamps
//      when status flips to SOLVED.
//   5. SLA computation: a past-due ticket is BREACHED and the monitor
//      surfaces % within SLA.
//
// Plus: bad signatures are rejected, stale timestamps are rejected,
// threading via In-Reply-To matches a prior message correctly, and
// re-opening a SOLVED ticket clears resolvedAt.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ─── mocks ──────────────────────────────────────────────────────────────
const sendRawMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../src/services/integrations/email', () => ({
  sendEmail:    vi.fn(async () => undefined),
  sendRawEmail: sendRawMock,
}));

// In-memory DynamoDB stand-in. Keyed by table name; each table is a
// Map keyed by the row's pk attribute. Service code only uses
// getItem/putItem/updateItem/scan via Database, so we can stub at
// that layer cleanly.
const tables: Record<string, Map<string, any>> = {};
function pkOf(tableName: string, item: any): string {
  const pkAttr =
    tableName.includes('Tickets')  ? 'ticketId'    :
    tableName.includes('Messages') ? 'messageId'   :
    tableName.includes('Settings') ? 'settingsId'  :
    tableName.includes('Inbound')  ? 'emailId'     : 'id';
  return String(item[pkAttr]);
}

const dbMock = vi.hoisted(() => ({
  getItem: vi.fn(async (table: string, key: any) => {
    const map = tables[table] ?? new Map();
    const pkAttr = Object.keys(key)[0];
    return map.get(String(key[pkAttr])) ?? null;
  }),
  putItem: vi.fn(async (table: string, item: any) => {
    tables[table] = tables[table] ?? new Map();
    tables[table].set(pkOf(table, item), { ...item });
  }),
  updateItem: vi.fn(async (table: string, key: any, patch: any) => {
    tables[table] = tables[table] ?? new Map();
    const pkAttr = Object.keys(key)[0];
    const cur = tables[table].get(String(key[pkAttr])) ?? {};
    tables[table].set(String(key[pkAttr]), { ...cur, ...patch });
  }),
  scan: vi.fn(async (table: string) => Array.from((tables[table] ?? new Map()).values())),
}));
vi.mock('../../../src/config/database', () => ({ Database: dbMock }));

// docClient.send is only called by claimInboundId (conditional put);
// re-implement that here so duplicate emailIds fail the condition.
const docClientMock = vi.hoisted(() => ({
  send: vi.fn(async (cmd: any) => {
    const input = cmd?.input ?? cmd;
    if (input?.TableName?.includes('Inbound')) {
      const table = input.TableName;
      tables[table] = tables[table] ?? new Map();
      const id = String(input.Item.emailId);
      if (tables[table].has(id)) {
        const err: any = new Error('Conditional fail');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      tables[table].set(id, input.Item);
      return {};
    }
    return {};
  }),
}));
vi.mock('../../../src/config/aws', () => ({ docClient: docClientMock }));

vi.mock('../../../src/config/environment', () => ({
  default: {
    dynamodb: {
      usersTable: 'LoadLead_Users',
      // supportTicket.ts now resolves its tables from config (not inline env),
      // so the mocked config must provide them.
      supportTicketsTable: 'LoadLead_SupportTickets',
      supportMessagesTable: 'LoadLead_SupportMessages',
      supportSettingsTable: 'LoadLead_SupportSettings',
      supportInboundTable: 'LoadLead_SupportInbound',
    },
  },
}));

// Bypass auth for the staff endpoints so we can hit them directly.
vi.mock('../../../src/middleware/auth', async () => {
  const actual: any = await vi.importActual('../../../src/middleware/auth');
  return {
    ...actual,
    authenticate:     (req: any, _r: any, n: any) => { req.user = { userId: 'staff-1', role: 'ADMIN' }; n(); },
    requireAdmin:     (_q: any, _r: any, n: any) => n(),
    requireStaffTier: () => (_q: any, _r: any, n: any) => n(),
  };
});

import express from 'express';
import request from 'supertest';
import supportRoutes from '../../../src/routes/support';
import { SupportTicketService } from '../../../src/services/supportTicket';
import { computeSlaState, aggregateMonitor } from '../../../src/services/sla';

// ─── helpers ────────────────────────────────────────────────────────────
function app() {
  const a = express();
  // Preserve raw body for signature verification.
  a.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  a.use('/api/support', supportRoutes);
  a.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode ?? 500).json({ error: err?.message ?? 'error' });
  });
  return a;
}

const SECRET = 'whsec_' + Buffer.from('test-secret-bytes-test-secret-bytes').toString('base64');

function signed(payload: object, opts: { id?: string; ts?: number } = {}) {
  const id  = opts.id ?? 'msg_' + Math.random().toString(36).slice(2);
  const ts  = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const body = JSON.stringify(payload);
  const key  = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const sig  = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return {
    body,
    headers: {
      'svix-id':        id,
      'svix-timestamp': ts,
      'svix-signature': `v1,${sig}`,
      'content-type':   'application/json',
    },
  };
}

function emailEnvelope(over: Partial<any> = {}) {
  return {
    type: 'email.received',
    data: {
      id:      'email_' + Math.random().toString(36).slice(2),
      from:    'requester@example.com',
      to:      ['support@loadleadapp.com'],
      subject: 'Need help with a load',
      text:    'My driver was assigned but the route is wrong.',
      html:    '<p>My driver was assigned but the route is wrong.</p>',
      headers: [
        { name: 'Message-ID', value: '<orig-1@example.com>' },
      ],
      ...over,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

// ─── tests ──────────────────────────────────────────────────────────────
describe('Resend Inbound webhook -- signature + idempotency + threading', () => {
  it('verified signature: an email creates a single OPEN ticket', async () => {
    const env = emailEnvelope();
    const s = signed(env);
    const r = await request(app()).post('/api/support/inbound').set(s.headers).send(s.body);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');

    const tickets = await SupportTicketService.listTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      status: 'OPEN',
      subject: 'Need help with a load',
      requesterEmail: 'requester@example.com',
    });
  });

  it('idempotent: posting the same payload twice does not duplicate', async () => {
    const env = emailEnvelope();
    const s1  = signed(env);
    await request(app()).post('/api/support/inbound').set(s1.headers).send(s1.body);

    // Same email id but a fresh svix-id + timestamp (which is realistic
    // -- Resend will retry the same delivery on its own schedule).
    const s2 = signed(env);
    const r2 = await request(app()).post('/api/support/inbound').set(s2.headers).send(s2.body);
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('duplicate');

    const tickets = await SupportTicketService.listTickets();
    expect(tickets).toHaveLength(1);
  });

  it('threads via In-Reply-To: a second email about the same Message-ID lands on the same ticket', async () => {
    const e1 = emailEnvelope();
    const s1 = signed(e1);
    const r1 = await request(app()).post('/api/support/inbound').set(s1.headers).send(s1.body);
    const ticketId = r1.body.ticketId;

    const e2 = emailEnvelope({
      id: 'email_two',
      subject: 'Re: Need help with a load',
      headers: [
        { name: 'Message-ID',  value: '<orig-2@example.com>' },
        { name: 'In-Reply-To', value: '<orig-1@example.com>' },
        { name: 'References',  value: '<orig-1@example.com>' },
      ],
    });
    const s2 = signed(e2);
    const r2 = await request(app()).post('/api/support/inbound').set(s2.headers).send(s2.body);
    expect(r2.body.ticketId).toBe(ticketId);

    const thread = await SupportTicketService.getThread(ticketId);
    expect(thread).toHaveLength(2);
    expect(thread.every((m) => m.direction === 'INBOUND')).toBe(true);
  });

  it('bad signature: 400', async () => {
    const env = emailEnvelope();
    const s   = signed(env);
    const bad = { ...s.headers, 'svix-signature': 'v1,WRONGSIGNATUREZZZZZZZZZZZZ==' };
    const r   = await request(app()).post('/api/support/inbound').set(bad).send(s.body);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad-signature');
  });

  it('missing secret: 400', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const env = emailEnvelope();
    const s   = signed(env);
    const r   = await request(app()).post('/api/support/inbound').set(s.headers).send(s.body);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('missing-secret');
  });

  it('stale timestamp: 400', async () => {
    const env = emailEnvelope();
    const s   = signed(env, { ts: Math.floor(Date.now() / 1000) - 3600 });
    const r   = await request(app()).post('/api/support/inbound').set(s.headers).send(s.body);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('stale-timestamp');
  });

  it('new inbound on a SOLVED ticket reopens it', async () => {
    const t = await SupportTicketService.createTicket({
      subject: 'old', requesterEmail: 'requester@example.com',
    });
    await SupportTicketService.updateTicket(t.ticketId, { status: 'SOLVED', resolvedAt: Date.now() });

    await SupportTicketService.appendMessage({
      ticketId: t.ticketId,
      direction: 'INBOUND',
      fromEmail: 'requester@example.com',
      toEmail:   'support@loadleadapp.com',
      bodyText:  'still broken', bodyHtml: null,
      emailMessageId: null, inReplyTo: null, references: null,
      authorStaffId: null,
    });

    const reopened = await SupportTicketService.getTicket(t.ticketId);
    expect(reopened?.status).toBe('OPEN');
    expect(reopened?.resolvedAt).toBeNull();
  });
});

describe('Staff reply -- threading, firstResponseAt, Solved -> resolvedAt', () => {
  it('reply hits Resend send with threading headers AND stamps firstResponseAt', async () => {
    const env = emailEnvelope();
    const s = signed(env);
    const r = await request(app()).post('/api/support/inbound').set(s.headers).send(s.body);
    const ticketId = r.body.ticketId;

    const reply = await request(app())
      .post(`/api/support/tickets/${ticketId}/messages`)
      .send({ bodyText: 'Looking into this now.' });
    expect(reply.status).toBe(201);

    // Resend send invoked with In-Reply-To, References, Message-ID
    expect(sendRawMock).toHaveBeenCalledTimes(1);
    const call = sendRawMock.mock.calls[0][0] as any;
    expect(call.headers['In-Reply-To']).toBe('<orig-1@example.com>');
    expect(call.headers['Message-ID']).toMatch(/^<.+@support\.loadleadapp\.com>$/);
    expect(call.subject).toMatch(/^Re: /);

    const t2 = await SupportTicketService.getTicket(ticketId);
    expect(t2?.firstResponseAt).toBeTypeOf('number');
  });

  it('PATCH status=SOLVED stamps resolvedAt; status back to OPEN clears it', async () => {
    const t = await SupportTicketService.createTicket({ subject: 'x', requesterEmail: 'a@b.com' });

    await request(app()).patch(`/api/support/tickets/${t.ticketId}`).send({ status: 'SOLVED' });
    let cur = await SupportTicketService.getTicket(t.ticketId);
    expect(cur?.status).toBe('SOLVED');
    expect(cur?.resolvedAt).toBeTypeOf('number');

    await request(app()).patch(`/api/support/tickets/${t.ticketId}`).send({ status: 'OPEN' });
    cur = await SupportTicketService.getTicket(t.ticketId);
    expect(cur?.status).toBe('OPEN');
    expect(cur?.resolvedAt).toBeNull();
  });
});

describe('SLA -- breach detection + monitor', () => {
  it('past-due ticket: state = BREACHED', () => {
    const now = Date.now();
    const t: any = { createdAt: now - 1000 * 60 * 60 * 48, slaTargetMinutes: 60 * 24, status: 'OPEN' };
    expect(computeSlaState(t, now).state).toBe('BREACHED');
  });

  it('resolved well after target: monitor counts it but NOT within SLA', () => {
    const now = Date.now();
    const tickets: any[] = [
      // resolved on time: 6h of a 24h target
      { ticketId: 'a', createdAt: now - 1000 * 60 * 60 * 24, slaTargetMinutes: 60 * 24,
        status: 'SOLVED', resolvedAt: now - 1000 * 60 * 60 * 18, subject:'', requesterEmail:'',
        priority: 'NORMAL', lastMessageAt: 0 },
      // resolved late: 36h on a 24h target
      { ticketId: 'b', createdAt: now - 1000 * 60 * 60 * 36, slaTargetMinutes: 60 * 24,
        status: 'SOLVED', resolvedAt: now - 1000 * 60 * 60 * 1, subject:'', requesterEmail:'',
        priority: 'NORMAL', lastMessageAt: 0 },
    ];
    const m = aggregateMonitor(tickets, 30, now);
    expect(m.percentWithinSla).toBe(50);
    expect(m.avgResolutionMinutes).toBeTypeOf('number');
  });
});
