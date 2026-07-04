// Support ticket + message persistence.
//
// Single source of truth for the inbound email -> ticket lifecycle.
// Threading rules:
//   1. If the inbound To: includes a token in the form support+<ticketId>@,
//      append to that ticket.
//   2. Otherwise, look up an existing SupportMessage by its
//      emailMessageId matching either In-Reply-To or any token in the
//      space-separated References header.
//   3. If still no match, create a new OPEN ticket.
//   4. New inbound on a SOLVED ticket reopens it (status -> OPEN).

import { v4 as uuid } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { Database } from '../config/database';
import { docClient } from '../config/aws';
import config from '../config/environment';
import type {
  SupportTicket, SupportMessage, SupportSettings, TicketStatus, TicketPriority,
} from '../types/support';

// Table names come from config.dynamodb (keyed on DYNAMODB_SUPPORT_*_TABLE) so
// the boot guard and check-table-env-parity cover them like every other table:
// non-prod stacks override to their prefix; prod uses the LoadLead_ default.
const TICKETS_TABLE  = config.dynamodb.supportTicketsTable;
const MESSAGES_TABLE = config.dynamodb.supportMessagesTable;
const SETTINGS_TABLE = config.dynamodb.supportSettingsTable;
const INBOUND_TABLE  = config.dynamodb.supportInboundTable;
const DEFAULT_SLA_MINUTES = 24 * 60;

export class SupportTicketService {

  // ─── settings ────────────────────────────────────────────────────────────

  static async getSettings(): Promise<SupportSettings> {
    const row = await Database.getItem<SupportSettings>(SETTINGS_TABLE, { settingsId: 'singleton' });
    return row ?? {
      settingsId: 'singleton',
      slaTargetMinutes: DEFAULT_SLA_MINUTES,
      slaFirstResponseMinutes: null,
      perPriority: {},
      updatedAt: Date.now(),
      updatedBy: 'default',
    };
  }

  static async setSettings(next: Omit<SupportSettings, 'settingsId' | 'updatedAt'>): Promise<SupportSettings> {
    const row: SupportSettings = {
      settingsId: 'singleton',
      ...next,
      updatedAt: Date.now(),
    };
    await Database.putItem(SETTINGS_TABLE, row);
    return row;
  }

  // ─── ticket CRUD ─────────────────────────────────────────────────────────

  static async createTicket(params: {
    subject: string;
    requesterEmail: string;
    requesterName?: string | null;
    priority?: TicketPriority;
    linkedOrgId?: string | null;
    linkedDriverId?: string | null;
  }): Promise<SupportTicket> {
    const settings = await this.getSettings();
    const priority = params.priority ?? 'NORMAL';
    const perPri = settings.perPriority?.[priority];
    const now = Date.now();
    const ticket: SupportTicket = {
      ticketId: uuid(),
      subject: params.subject.slice(0, 255),
      requesterEmail: params.requesterEmail.toLowerCase(),
      requesterName:  params.requesterName ?? null,
      status:   'OPEN',
      priority,
      assigneeStaffId: null,
      slaTargetMinutes:        perPri?.targetMinutes        ?? settings.slaTargetMinutes,
      slaFirstResponseMinutes: perPri?.firstResponseMinutes ?? settings.slaFirstResponseMinutes ?? null,
      linkedOrgId:    params.linkedOrgId    ?? null,
      linkedDriverId: params.linkedDriverId ?? null,
      createdAt: now,
      lastMessageAt: now,
      firstResponseAt: null,
      resolvedAt: null,
    };
    await Database.putItem(TICKETS_TABLE, ticket);
    return ticket;
  }

  static async getTicket(ticketId: string): Promise<SupportTicket | null> {
    return Database.getItem<SupportTicket>(TICKETS_TABLE, { ticketId });
  }

  static async listTickets(): Promise<SupportTicket[]> {
    // Small-volume MVP: scan. Replace with GSI on (status, createdAt)
    // when volume rises.
    return await Database.scan<SupportTicket>(TICKETS_TABLE);
  }

  static async updateTicket(
    ticketId: string,
    patch: Partial<Pick<SupportTicket,
      'status' | 'priority' | 'assigneeStaffId' | 'lastMessageAt' |
      'firstResponseAt' | 'resolvedAt' | 'linkedOrgId' | 'linkedDriverId'>>,
  ): Promise<void> {
    await Database.updateItem(TICKETS_TABLE, { ticketId }, patch);
  }

  // ─── messages ────────────────────────────────────────────────────────────

  static async appendMessage(params: Omit<SupportMessage, 'messageId' | 'createdAt'>): Promise<SupportMessage> {
    const message: SupportMessage = {
      ...params,
      messageId: uuid(),
      createdAt: Date.now(),
    };
    await Database.putItem(MESSAGES_TABLE, message);

    // Bookkeeping on the parent ticket.
    const patch: Partial<SupportTicket> = { lastMessageAt: message.createdAt };
    const ticket = await this.getTicket(params.ticketId);
    if (ticket) {
      if (message.direction === 'OUTBOUND' && ticket.firstResponseAt == null) {
        patch.firstResponseAt = message.createdAt;
      }
      // Re-open if the requester replied after we solved it.
      if (message.direction === 'INBOUND' && ticket.status === 'SOLVED') {
        patch.status = 'OPEN' as TicketStatus;
        patch.resolvedAt = null;
      }
    }
    await this.updateTicket(params.ticketId, patch);
    return message;
  }

  static async getThread(ticketId: string): Promise<SupportMessage[]> {
    // MVP scan + filter. Replace with PK=ticketId/SK=createdAt design later.
    const all = await Database.scan<SupportMessage>(MESSAGES_TABLE);
    return all.filter((m) => m.ticketId === ticketId).sort((a, b) => a.createdAt - b.createdAt);
  }

  static async findMessageByEmailId(emailMessageId: string): Promise<SupportMessage | null> {
    if (!emailMessageId) return null;
    const all = await Database.scan<SupportMessage>(MESSAGES_TABLE);
    return all.find((m) => m.emailMessageId === emailMessageId) ?? null;
  }

  // ─── threading ───────────────────────────────────────────────────────────

  /**
   * Resolve which ticket an inbound email belongs to:
   *   1. Plus-addressing token: support+<ticketId>@
   *   2. In-Reply-To header points at a stored emailMessageId
   *   3. Any token in References points at a stored emailMessageId
   *   4. null -> caller should create a new ticket
   */
  static async resolveThread(params: {
    to:         string[];
    inReplyTo?: string | null;
    references?: string | null;
  }): Promise<SupportTicket | null> {
    // Plus-address match
    for (const to of params.to) {
      const m = to.toLowerCase().match(/^support\+([a-f0-9-]{8,})@/);
      if (m) {
        const t = await this.getTicket(m[1]);
        if (t) return t;
      }
    }

    // In-Reply-To
    if (params.inReplyTo) {
      const prior = await this.findMessageByEmailId(params.inReplyTo.trim());
      if (prior) return await this.getTicket(prior.ticketId);
    }

    // References (space-separated chain)
    if (params.references) {
      const refs = params.references.split(/\s+/).map((r) => r.trim()).filter(Boolean);
      for (const ref of refs) {
        const prior = await this.findMessageByEmailId(ref);
        if (prior) return await this.getTicket(prior.ticketId);
      }
    }

    return null;
  }

  // ─── inbound idempotency ────────────────────────────────────────────────

  /** Mark an inbound email id as processed; returns false on duplicate. */
  static async claimInboundId(emailId: string): Promise<boolean> {
    try {
      await docClient.send(new PutCommand({
        TableName: INBOUND_TABLE,
        Item: { emailId, processedAt: Date.now() },
        ConditionExpression: 'attribute_not_exists(emailId)',
      }));
      return true;
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }
}
