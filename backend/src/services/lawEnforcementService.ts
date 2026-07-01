/**
 * Law-enforcement request handling. Restricted to LAW_ENFORCEMENT_LIAISON,
 * counsel-gated, fully audited.
 *
 * The tool enforces process and preserves records. It NEVER decides validity and
 * NEVER auto-discloses. Disclosure is impossible without a recorded counsel
 * sign-off. Everything is append-only: intake, counsel sign-off, and disclosure
 * are separate immutable rows (the requests table is keyed by a per-row recordId,
 * with a logical requestId + kind). On intake, an automatic legal hold is placed
 * on the in-scope entities. A lawful non-disclosure order marks the matter
 * restricted so routine user-facing notifications about the affected records are
 * suppressed pending counsel guidance.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { AdminAuditService } from './adminAuditService';
import { LegalHoldService } from './legalHoldService';
import { ComplianceRole } from '../types/complianceRole';

export type LERequestType = 'SUBPOENA' | 'COURT_ORDER' | 'WARRANT' | 'GARNISHMENT' | 'LEVY' | 'LIEN' | 'OTHER';
export const LE_REQUEST_TYPES: LERequestType[] = ['SUBPOENA', 'COURT_ORDER', 'WARRANT', 'GARNISHMENT', 'LEVY', 'LIEN', 'OTHER'];

export interface ScopeEntity {
  entityType: string;
  entityId: string;
}

export interface LERequestIntake {
  recordId: string; // PK
  requestId: string; // logical id
  kind: 'INTAKE';
  type: LERequestType;
  issuingAuthority: string;
  receivedDate: string; // ISO date
  describedScope: string;
  scopeEntities: ScopeEntity[];
  validityReviewStatus: 'PENDING_REVIEW';
  nonDisclosure: boolean;
  nonDisclosureBasis?: string;
  actorId: string;
  at: number;
}

export interface CounselSignOff {
  recordId: string; // PK
  requestId: string;
  kind: 'COUNSEL_SIGNOFF';
  counselId: string;
  validityDetermination: 'VALID' | 'INVALID' | 'VALID_IN_PART';
  note?: string;
  actorId: string;
  at: number;
}

export interface DisclosureRecord {
  disclosureId: string; // PK
  requestId: string;
  recipient: string;
  recordRefs: string[]; // exactly the in-scope records disclosed
  actorId: string;
  at: number;
}

export interface IntakeInput {
  type: LERequestType;
  issuingAuthority: string;
  receivedDate: string;
  describedScope: string;
  scopeEntities: ScopeEntity[];
  nonDisclosure?: boolean;
  nonDisclosureBasis?: string;
  actorId: string;
}

export class LawEnforcementService {
  /** Record an intake (append-only), auto-place a legal hold on the in-scope entities. Audited first. */
  static async intake(input: IntakeInput): Promise<LERequestIntake> {
    if (!LE_REQUEST_TYPES.includes(input.type)) throw new Error(`invalid request type: ${input.type}`);
    if (!input.issuingAuthority) throw new Error('intake: issuingAuthority is required');
    if (!input.scopeEntities?.length) throw new Error('intake: at least one in-scope entity is required');
    if (!input.actorId) throw new Error('intake: actorId is required');

    const requestId = Helpers.generateId('lereq');
    await AdminAuditService.record({
      actorId: input.actorId,
      actorRole: ComplianceRole.LAW_ENFORCEMENT_LIAISON,
      action: 'LE_REQUEST_INTAKE',
      targetRefs: input.scopeEntities.map((e) => `${e.entityType}:${e.entityId}`),
      reason: input.describedScope,
      authorityRef: requestId,
    });

    const intake: LERequestIntake = {
      recordId: Helpers.generateId('lerow'),
      requestId,
      kind: 'INTAKE',
      type: input.type,
      issuingAuthority: input.issuingAuthority,
      receivedDate: input.receivedDate,
      describedScope: input.describedScope,
      scopeEntities: input.scopeEntities,
      validityReviewStatus: 'PENDING_REVIEW',
      nonDisclosure: !!input.nonDisclosure,
      ...(input.nonDisclosureBasis ? { nonDisclosureBasis: input.nonDisclosureBasis } : {}),
      actorId: input.actorId,
      at: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.lawEnforcementRequestsTable, intake);

    // Automatic legal hold on every in-scope entity.
    for (const e of input.scopeEntities) {
      await LegalHoldService.placeHold({
        entityType: e.entityType,
        entityId: e.entityId,
        reason: `law-enforcement request ${requestId} (${input.type})`,
        authorityRef: requestId,
        actorId: input.actorId,
      });
    }
    return intake;
  }

  /** Record a counsel sign-off (append-only). The determination is counsel's; the tool records it. Audited. */
  static async recordCounselSignOff(input: {
    requestId: string;
    counselId: string;
    validityDetermination: CounselSignOff['validityDetermination'];
    note?: string;
    actorId: string;
  }): Promise<CounselSignOff> {
    if (!input.requestId || !input.counselId) throw new Error('counsel sign-off: requestId and counselId are required');
    await AdminAuditService.record({
      actorId: input.actorId,
      actorRole: ComplianceRole.LAW_ENFORCEMENT_LIAISON,
      action: 'COUNSEL_SIGNOFF',
      targetRefs: [input.requestId],
      reason: input.note ?? input.validityDetermination,
      authorityRef: input.requestId,
    });
    const signOff: CounselSignOff = {
      recordId: Helpers.generateId('lerow'),
      requestId: input.requestId,
      kind: 'COUNSEL_SIGNOFF',
      counselId: input.counselId,
      validityDetermination: input.validityDetermination,
      ...(input.note ? { note: input.note } : {}),
      actorId: input.actorId,
      at: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.lawEnforcementRequestsTable, signOff);
    return signOff;
  }

  /** True once a counsel sign-off with a non-INVALID determination exists for the request. */
  static async hasCounselSignOff(requestId: string): Promise<boolean> {
    const rows = await this.rowsForRequest(requestId);
    return rows.some((r) => r.kind === 'COUNSEL_SIGNOFF' && (r as CounselSignOff).validityDetermination !== 'INVALID');
  }

  static async getIntake(requestId: string): Promise<LERequestIntake | null> {
    const rows = await this.rowsForRequest(requestId);
    return (rows.find((r) => r.kind === 'INTAKE') as LERequestIntake) ?? null;
  }

  /**
   * Disclose exactly the in-scope records for a request. BLOCKED until a counsel
   * sign-off is recorded. Writes an append-only disclosure record and audits it.
   * The tool never auto-discloses and never decides validity.
   */
  static async discloseScoped(input: {
    requestId: string;
    recipient: string;
    recordRefs: string[];
    actorId: string;
  }): Promise<DisclosureRecord> {
    if (!input.recipient) throw new Error('disclose: recipient is required');
    if (!(await this.hasCounselSignOff(input.requestId))) {
      throw new Error('DISCLOSURE_BLOCKED_NO_COUNSEL_SIGNOFF');
    }
    await AdminAuditService.record({
      actorId: input.actorId,
      actorRole: ComplianceRole.LAW_ENFORCEMENT_LIAISON,
      action: 'DISCLOSE',
      targetRefs: input.recordRefs,
      reason: `disclosure to ${input.recipient}`,
      authorityRef: input.requestId,
    });
    const disclosure: DisclosureRecord = {
      disclosureId: Helpers.generateId('disc'),
      requestId: input.requestId,
      recipient: input.recipient,
      recordRefs: input.recordRefs,
      actorId: input.actorId,
      at: Helpers.getCurrentTimestamp(),
    };
    await Database.putItem(config.dynamodb.disclosuresTable, disclosure);
    return disclosure;
  }

  /**
   * Whether an entity is under a lawful non-disclosure restriction. A notification
   * service consults this to suppress routine user-facing notifications about the
   * affected records pending counsel guidance.
   */
  static async isEntityRestricted(entityType: string, entityId: string): Promise<boolean> {
    const rows = await this.scanAll();
    return rows.some(
      (r) =>
        r.kind === 'INTAKE' &&
        (r as LERequestIntake).nonDisclosure &&
        (r as LERequestIntake).scopeEntities.some((e) => e.entityType === entityType && e.entityId === entityId)
    );
  }

  static async disclosuresForRequest(requestId: string): Promise<DisclosureRecord[]> {
    let rows: DisclosureRecord[];
    try {
      rows = await Database.scan<DisclosureRecord>(config.dynamodb.disclosuresTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
    return rows.filter((d) => d.requestId === requestId).sort((a, b) => b.at - a.at);
  }

  private static async rowsForRequest(requestId: string): Promise<(LERequestIntake | CounselSignOff)[]> {
    return (await this.scanAll()).filter((r) => r.requestId === requestId);
  }

  private static async scanAll(): Promise<(LERequestIntake | CounselSignOff)[]> {
    try {
      return await Database.scan<LERequestIntake | CounselSignOff>(config.dynamodb.lawEnforcementRequestsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }
}
