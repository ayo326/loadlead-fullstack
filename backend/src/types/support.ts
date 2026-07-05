// Support ticketing data model.
//
// This IS the ticketing engine. Inbound emails arrive at support@ via
// Resend Inbound and create / append to tickets here; outbound replies
// go back out via Resend, threaded with In-Reply-To / References so
// they stay in the same email chain.
//
// All PII (sender names, email addresses, bodies) lives in DynamoDB
// behind the staff-only ADMIN gate. Never log full bodies or addresses;
// audit access via existing OrgAuditService MEMBER_REMOVED-style events.

export type TicketStatus  = 'OPEN' | 'PENDING' | 'SOLVED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type SLAState      = 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'RESOLVED';

export interface SupportTicket {
  ticketId: string;
  subject: string;
  requesterEmail: string;
  requesterName?: string | null;

  status:   TicketStatus;
  priority: TicketPriority;

  assigneeStaffId?: string | null;

  /** Resolution target in minutes, snapshot from settings at creation. */
  slaTargetMinutes: number;
  /** First-response target in minutes, if configured. */
  slaFirstResponseMinutes?: number | null;

  /** Optional linkages - set when staff create a ticket from a Carrier org or driver context. */
  linkedOrgId?:    string | null;
  linkedDriverId?: string | null;

  createdAt:        number;
  lastMessageAt:    number;
  /** Stamped when the first OUTBOUND message goes out. */
  firstResponseAt?: number | null;
  /** Stamped when status flips to SOLVED. */
  resolvedAt?:      number | null;
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export interface SupportMessage {
  messageId: string;
  ticketId:  string;

  direction:  MessageDirection;
  fromEmail:  string;
  toEmail:    string;
  bodyText?:  string | null;
  bodyHtml?:  string | null;

  /** RFC-5322 Message-ID header of the original email, for threading. */
  emailMessageId?: string | null;
  inReplyTo?:      string | null;
  references?:     string | null;

  /** Staff user that authored this OUTBOUND message; null on INBOUND. */
  authorStaffId?: string | null;

  createdAt: number;
}

export interface SupportSettings {
  /** Singleton row id. */
  settingsId: 'singleton';
  /** Global resolution target in minutes. Default 24h. */
  slaTargetMinutes: number;
  /** Global first-response target in minutes. Optional. */
  slaFirstResponseMinutes?: number | null;
  /** Per-priority overrides. Any field omitted falls back to the global target. */
  perPriority?: Partial<Record<TicketPriority, {
    targetMinutes?: number;
    firstResponseMinutes?: number;
  }>>;
  updatedAt: number;
  updatedBy: string;
}
