/**
 * BetaApplicationService — owns the BetaApplication pipeline records.
 *
 *   ingestFromTally(payload)  — maps Tally fields BY LABEL (per
 *       docs/beta/Tally_Form_Guide.md), runs auto-qualify, pre-computes the
 *       objective score dimensions, and persists. Idempotent by responseId.
 *   list / get / updateScore / setStatus / admit / addNote — the dashboard
 *       operations.
 *
 * Field mapping is by LABEL because Tally regenerates question ids on
 * reorder. The guide is the contract; if a label changes there, it changes
 * here.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { BetaApplication, UserRole } from '../types';
import { autoQualify } from './betaAutoQualify';
import { preComputeObjective, applyStaffScores, totalOf } from './betaScoring';

/** Shape of a Tally webhook payload (the parts we read). Tally wraps the
 *  answers in data.fields[]; each field has a `label`, `type`, and `value`.
 *  For multiple-choice the value is an option id and the labels live in a
 *  parallel `options` array — we resolve those to human strings. */
/**
 * Tally webhook payload (the parts we read). Authoritative shape per spec:
 *   { eventType: "FORM_RESPONSE", createdAt,
 *     data: { responseId, formId, formName,
 *             fields: [{ key, label, type, value }] } }
 * For choice questions the field carries an `options[]` and `value` is the
 * option id (or array of ids); resolveFieldValue maps those back to text.
 */
export interface TallyPayload {
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  data?: {
    responseId?: string;
    submissionId?: string;
    formId?: string;
    formName?: string;
    fields?: TallyField[];
  };
}
interface TallyField {
  key?: string;
  label?: string;
  type?: string;
  value?: any;
  options?: { id: string; text: string }[];
}

/** Resolve a Tally field's value to a human string (or array of strings for
 *  multi-selects). Maps option-ids back to their text. */
function resolveFieldValue(f: TallyField): any {
  if (f.value == null) return undefined;
  // Multi-select: value is an array of option ids.
  if (Array.isArray(f.value) && f.options) {
    return f.value
      .map(id => f.options!.find(o => o.id === id)?.text ?? id)
      .filter(Boolean);
  }
  // Single-select: value is one option id.
  if (f.options && typeof f.value === 'string') {
    const opt = f.options.find(o => o.id === f.value);
    return opt?.text ?? f.value;
  }
  return f.value;
}

/** Build a label→value map from the Tally fields[]. Labels are trimmed. */
function fieldMap(payload: TallyPayload): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of payload.data?.fields ?? []) {
    if (!f.label) continue;
    out[f.label.trim()] = resolveFieldValue(f);
  }
  return out;
}

/** First non-empty label match → trimmed string, else undefined. Used for
 *  fields whose authoritative label has an older alias still in the wild. */
function pickStr(m: Record<string, any>, labels: string[]): string | undefined {
  for (const l of labels) {
    if (m[l] != null && String(m[l]).trim()) return String(m[l]).trim();
  }
  return undefined;
}

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(yes|true|1)$/i.test(v.trim());
  return false;
}
function toInt(v: any): number | undefined {
  if (typeof v === 'number') return Math.trunc(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function toArr(v: any): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return undefined;
}

/** Map the headline Texas question to the texasFocus enum. Authoritative
 *  option labels (guide §12):
 *    "Yes, mostly Texas"        → MOSTLY
 *    "Partly Texas"             → PARTLY
 *    "No, mostly outside Texas" → OUTSIDE
 *  Matched loosely so minor label edits in Tally don't silently break it. */
function mapTexasFocus(raw: any): BetaApplication['texasFocus'] | null {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('outside')) return 'OUTSIDE';   // check before "mostly" (label has both words)
  if (s.includes('partly') || s.includes('part')) return 'PARTLY';
  if (s.includes('mostly') || s.includes('yes') || s.includes('primarily')) return 'MOSTLY';
  return null;
}

/** Map the "Which best describes you?" answer to the side enum.
 *  Authoritative option labels (guide §12):
 *    "Shipper"         → SHIPPER
 *    "Hauler / carrier"→ CARRIER
 *    "Both"            → BOTH */
function mapSide(raw: any): BetaApplication['side'] {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('both')) return 'BOTH';
  if (s.includes('carrier') || s.includes('hauler')) return 'CARRIER';
  return 'SHIPPER';
}

export class BetaApplicationService {

  static async getByResponseId(responseId: string): Promise<BetaApplication | null> {
    const hits = await Database.query<BetaApplication>(
      config.dynamodb.betaApplicationsTable,
      'responseId-index',
      '#r = :r',
      { '#r': 'responseId' },
      { ':r': responseId },
    );
    return hits[0] ?? null;
  }

  /**
   * Ingest a Tally submission → BetaApplication. Idempotent by responseId:
   * a duplicate webhook (same responseId) returns the existing row without
   * creating a second. Returns { application, created } so the webhook can
   * report whether it was a fresh ingest.
   */
  static async ingestFromTally(
    payload: TallyPayload,
    opts: { currentWave?: string } = {},
  ): Promise<{ application: BetaApplication; created: boolean }> {
    const responseId = payload.data?.responseId || payload.data?.submissionId;
    if (!responseId) throw new AppError('Tally payload missing responseId', 400);

    // Idempotency: dedupe by responseId.
    const existing = await this.getByResponseId(responseId);
    if (existing) return { application: existing, created: false };

    const m = fieldMap(payload);

    const side = mapSide(m['Which best describes you?'] ?? m['Which side are you?']);
    const texasFocus = mapTexasFocus(m['Do you primarily operate in Texas?']);
    if (!texasFocus) {
      // Texas focus is mandatory (see the guide). Reject so the applicant
      // can re-submit; do NOT fabricate a default.
      throw new AppError('Tally submission missing required "Do you primarily operate in Texas?" answer', 422);
    }

    const workEmail = String(m['Work email'] ?? '').trim().toLowerCase();
    if (!workEmail || !workEmail.includes('@')) {
      throw new AppError('Tally submission missing valid Work email', 422);
    }

    // Field mapping BY LABEL — authoritative labels per the guide §12.
    // loadsPerWeek is stored RAW (band string or number); the gate/score
    // normalize it. Storing toInt() here would mis-read "Under 5" as 5.
    const sideSpecificData: BetaApplication['sideSpecificData'] = {};
    if (side === 'SHIPPER' || side === 'BOTH') {
      sideSpecificData.shipper = {
        companyType: m['What type of company are you?'] ?? m['What kind of shipper are you?'],
        commodities: toArr(m['What commodities do you ship?'] ?? m['What do you ship?']),
        loadsPerWeek: m['How many shipments per week?'],   // raw band string
        modes: toArr(m['Which modes do you use?']),
        lanes: toArr(m['Top lanes (origin → destination)'] ?? m['Top 3 lanes']),
        bookingMethod: m['How do you book freight today?'] ?? m['How do you book today?'],
        pain: m['Biggest pain in booking freight'] ?? m['Biggest pain in booking'],
      };
    }
    if (side === 'CARRIER' || side === 'BOTH') {
      sideSpecificData.carrier = {
        mcOrDot: m['MC or DOT number'],
        truckCount: toInt(m['How many trucks/power units?'] ?? m['How many trucks?']),
        loadsPerWeek: m['Loads per week'],                 // raw band string
        equipment: toArr(m['Equipment types'] ?? m['Equipment']),
        lanes: toArr(m['Top lanes you run (origin → destination)'] ?? m['Top 3 lanes you serve']),
        findMethod: m['How do you find loads today?'],
        pain: m['Biggest pain in finding loads'],
      };
    }

    const commitment = {
      realFreight: toBool(m['Are you actively running freight right now?'] ?? m['Are you running freight right now?']),
      feedbackCall: toBool(m['Will you join a short feedback call + weekly check-in?'] ?? m['Will you take a 15-min feedback call and a weekly check-in?']),
      contactPref: mapContactPref(m['Preferred contact method'] ?? m['Preferred contact']),
    };

    const now = Helpers.getCurrentTimestamp();
    const partial = { side, texasFocus, sideSpecificData, commitment };

    // Run hard gates + pre-compute objective score dimensions.
    const { status, autoFlags } = autoQualify(partial, { currentWave: opts.currentWave });
    const scoreBreakdown = preComputeObjective(partial);

    const application: BetaApplication = {
      applicationId: Helpers.generateId('bapp'),
      responseId,
      side,
      fullName: String(m['Full name'] ?? '').trim(),
      workEmail,
      phone: m['Phone'] ? String(m['Phone']).trim() : undefined,
      company: pickStr(m, ['Company name', 'Company']),
      linkedinUrl: m['LinkedIn URL'] ? String(m['LinkedIn URL']).trim() : undefined,
      region: pickStr(m, ['Primary operating region (city, state)', 'Region']),
      texasFocus,
      sideSpecificData,
      commitment,
      referredBy: pickStr(m, ['Referred by anyone?', 'Referred by']),
      source: m['source'] ? String(m['source']).trim() : undefined,
      status,
      autoFlags,
      // Pre-computed objective dims now; staff fill in subjective later.
      score: totalOf(scoreBreakdown),
      scoreBreakdown,
      notes: [],
      createdAt: now,
      updatedAt: now,
    };

    await Database.putItem(config.dynamodb.betaApplicationsTable, application);
    Logger.info(`Beta application ingested: ${workEmail} side=${side} status=${status} flags=[${autoFlags.join(',')}]`);
    return { application, created: true };
  }

  static async get(applicationId: string): Promise<BetaApplication | null> {
    return Database.getItem<BetaApplication>(config.dynamodb.betaApplicationsTable, { applicationId });
  }

  static async list(filter?: { status?: string; side?: string; wave?: string }): Promise<BetaApplication[]> {
    const all = await Database.scan<BetaApplication>(config.dynamodb.betaApplicationsTable);
    return all.filter(a => {
      if (filter?.status && a.status !== filter.status) return false;
      if (filter?.side && a.side !== filter.side) return false;
      if (filter?.wave && a.wave !== filter.wave) return false;
      return true;
    });
  }

  /** Staff updates the subjective score dimensions. AUTO dims are recomputed
   *  so a staff edit can't corrupt them. */
  static async updateScore(
    applicationId: string,
    staffScores: { segmentFit?: number; laneOverlap?: number; pain?: number; responsiveness?: number },
  ): Promise<BetaApplication> {
    const app = await this.get(applicationId);
    if (!app) throw new AppError('Application not found', 404);

    const { breakdown, total } = applyStaffScores(app, app.scoreBreakdown, staffScores);
    await Database.updateItem(
      config.dynamodb.betaApplicationsTable,
      { applicationId },
      { scoreBreakdown: breakdown, score: total, updatedAt: Helpers.getCurrentTimestamp() },
    );
    Logger.info(`Beta application ${applicationId} scored: ${total}/15`);
    // Return the merged in-memory view (updateItem is fire-and-forget here).
    return { ...app, scoreBreakdown: breakdown, score: total };
  }

  static async setStatus(applicationId: string, status: BetaApplication['status']): Promise<void> {
    await Database.updateItem(
      config.dynamodb.betaApplicationsTable,
      { applicationId },
      { status, updatedAt: Helpers.getCurrentTimestamp() },
    );
  }

  static async addNote(applicationId: string, authorStaffId: string, text: string): Promise<void> {
    const app = await this.get(applicationId);
    if (!app) throw new AppError('Application not found', 404);
    const notes = [...(app.notes ?? []), { authorStaffId, text, createdAt: Helpers.getCurrentTimestamp() }];
    await Database.updateItem(
      config.dynamodb.betaApplicationsTable,
      { applicationId },
      { notes, updatedAt: Helpers.getCurrentTimestamp() },
    );
  }

  static async assign(applicationId: string, staffId: string): Promise<void> {
    await Database.updateItem(
      config.dynamodb.betaApplicationsTable,
      { applicationId },
      { assigneeStaffId: staffId, updatedAt: Helpers.getCurrentTimestamp() },
    );
  }

  /** Persist the admit linkage (invite token + cohort/wave) on the app. */
  static async markAdmitted(
    applicationId: string,
    linkage: { invitationToken: string; cohort: string; wave: string },
  ): Promise<void> {
    await Database.updateItem(
      config.dynamodb.betaApplicationsTable,
      { applicationId },
      {
        status: 'INVITED',
        linkedInvitationToken: linkage.invitationToken,
        cohort: linkage.cohort,
        wave: linkage.wave,
        updatedAt: Helpers.getCurrentTimestamp(),
      },
    );
  }

  /** Cohort balance — the HEADLINE metric. Counts QUALIFIED+ applicants by
   *  side so the dashboard can show the live shipper:carrier ratio. */
  static async cohortBalance(wave?: string): Promise<{
    shippers: number; carriers: number; both: number;
    admitted: { shippers: number; carriers: number; both: number };
    totalAdmitted: number;
  }> {
    const all = await this.list(wave ? { wave } : undefined);
    const counted = all.filter(a => a.status !== 'DISQUALIFIED');
    const admittedStatuses = new Set(['ADMITTED', 'INVITED', 'ONBOARDED']);
    const admitted = counted.filter(a => admittedStatuses.has(a.status));

    const bySide = (rows: BetaApplication[], side: string) => rows.filter(a => a.side === side).length;
    return {
      shippers: bySide(counted, 'SHIPPER'),
      carriers: bySide(counted, 'CARRIER'),
      both: bySide(counted, 'BOTH'),
      admitted: {
        shippers: bySide(admitted, 'SHIPPER'),
        carriers: bySide(admitted, 'CARRIER'),
        both: bySide(admitted, 'BOTH'),
      },
      totalAdmitted: admitted.length,
    };
  }
}

function mapContactPref(raw: any): 'email' | 'phone' | 'sms' | undefined {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('phone') || s.includes('call')) return 'phone';
  if (s.includes('sms') || s.includes('text')) return 'sms';
  if (s.includes('email')) return 'email';
  return undefined;
}

/** Map a side → the UserRole the admit flow issues an invite for. BOTH
 *  defaults to SHIPPER for the invite (staff can override at admit time). */
export function sideToUserRole(side: BetaApplication['side']): UserRole {
  switch (side) {
    case 'CARRIER': return UserRole.CARRIER_ADMIN;
    case 'SHIPPER': return UserRole.SHIPPER;
    case 'BOTH': return UserRole.SHIPPER;
    default: return UserRole.SHIPPER;
  }
}
