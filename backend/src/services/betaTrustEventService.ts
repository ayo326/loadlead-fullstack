/**
 * Beta trust and operational events store (no-show, trust incident).
 *
 * DELIBERATE SEPARATION FROM THE LOAD MODEL.
 * These records are beta-program operational and trust tracking, not core load
 * data, so they live in their own table (LoadLead_BetaTrustEvents) with their own
 * id namespace. A record only REFERENCES a load and a carrier by id. Nothing here
 * reads, writes, or requires any field on the Load model, the loads table, or any
 * Load DTO. This keeps trust or fraud signals from leaking into the load record
 * and lets us track or purge them independently. If a future change seems to need
 * a field on Load to make these work, stop and reconsider: it belongs here.
 *
 * The two Lane Liquidity dials (no-show count, trust-incident count) read their
 * totals from getCounts() below. With no events recorded they return a real 0.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';

// COI_DISCREPANCY is raised by the Canopy cross-reference engine (SCRUM-60) when
// an uploaded certificate materially conflicts with the insurer-sourced data (a
// forged-or-materially-stale signal). It references a cross-reference result, not
// a load, so loadId is optional for it; NO_SHOW / TRUST_INCIDENT still require a
// load. It is not counted in the two Lane Liquidity dials.
export type BetaTrustEventType = 'NO_SHOW' | 'TRUST_INCIDENT' | 'COI_DISCREPANCY';

export const BETA_TRUST_EVENT_TYPES: BetaTrustEventType[] = ['NO_SHOW', 'TRUST_INCIDENT', 'COI_DISCREPANCY'];

/** Trust event types that must reference a load. */
const LOAD_SCOPED_TYPES: BetaTrustEventType[] = ['NO_SHOW', 'TRUST_INCIDENT'];

export interface BetaTrustEvent {
  eventId: string;
  eventType: BetaTrustEventType;
  /** Reference to a load, by id only. Optional for carrier-scoped events. */
  loadId?: string;
  carrierId: string; // reference to a carrier, by id only
  /** Admin id, or a system source string ('system') for auto-raised events. */
  recordedByAdminId: string;
  recordedAt: number; // epoch ms, the app's timestamp convention
  /** For COI_DISCREPANCY: the cross-reference result this event references. */
  crossReferenceResultId?: string;
  note?: string;
}

export interface RecordTrustEventInput {
  eventType: BetaTrustEventType;
  loadId?: string;
  carrierId: string;
  recordedByAdminId: string;
  crossReferenceResultId?: string;
  note?: string;
}

export interface TrustEventCounts {
  noShows: number;
  trustIncidents: number;
}

export class BetaTrustEventService {
  /** Record one no-show or trust incident against a load and carrier, by id. */
  static async record(input: RecordTrustEventInput): Promise<BetaTrustEvent> {
    if (!BETA_TRUST_EVENT_TYPES.includes(input.eventType)) {
      throw new Error(`invalid eventType: ${input.eventType}`);
    }
    if (!input.carrierId) {
      throw new Error('carrierId is required');
    }
    if (LOAD_SCOPED_TYPES.includes(input.eventType) && !input.loadId) {
      throw new Error(`loadId is required for ${input.eventType}`);
    }

    const event: BetaTrustEvent = {
      eventId: Helpers.generateId('btrust'),
      eventType: input.eventType,
      ...(input.loadId ? { loadId: input.loadId } : {}),
      carrierId: input.carrierId,
      recordedByAdminId: input.recordedByAdminId,
      recordedAt: Helpers.getCurrentTimestamp(),
      ...(input.crossReferenceResultId ? { crossReferenceResultId: input.crossReferenceResultId } : {}),
      ...(input.note ? { note: input.note } : {}),
    };

    await Database.putItem(config.dynamodb.betaTrustEventsTable, event);
    return event;
  }

  /**
   * Aggregate counts by type, optionally bounded to a recordedAt window so the
   * dials match the charted liquidity window. Scan is fine at beta volume; add a
   * GSI on recordedAt before scale.
   */
  static async getCounts(range?: { fromMs?: number; toMs?: number }): Promise<TrustEventCounts> {
    const events = await this.listInWindow(range);
    return {
      noShows: events.filter((e) => e.eventType === 'NO_SHOW').length,
      trustIncidents: events.filter((e) => e.eventType === 'TRUST_INCIDENT').length,
    };
  }

  /** Recent events, newest first. Optionally filtered to one load. */
  static async list(filter?: { loadId?: string; limit?: number }): Promise<BetaTrustEvent[]> {
    let events = await this.scanAll();
    if (filter?.loadId) {
      events = events.filter((e) => e.loadId === filter.loadId);
    }
    events.sort((a, b) => b.recordedAt - a.recordedAt);
    return typeof filter?.limit === 'number' ? events.slice(0, filter.limit) : events;
  }

  private static async listInWindow(range?: { fromMs?: number; toMs?: number }): Promise<BetaTrustEvent[]> {
    const events = await this.scanAll();
    if (!range || (range.fromMs == null && range.toMs == null)) return events;
    return events.filter((e) => {
      if (range.fromMs != null && e.recordedAt < range.fromMs) return false;
      if (range.toMs != null && e.recordedAt > range.toMs) return false;
      return true;
    });
  }

  /**
   * Scan the store, tolerating a not-yet-created table. If the table is missing
   * (for example the backend deployed before its Terraform was applied), treat
   * it as empty and log a warning rather than failing the caller. The dials then
   * read a real 0 instead of taking down the whole liquidity panel.
   */
  private static async scanAll(): Promise<BetaTrustEvent[]> {
    try {
      return await Database.scan<BetaTrustEvent>(config.dynamodb.betaTrustEventsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(
          `BetaTrustEvents table ${config.dynamodb.betaTrustEventsTable} not found; ` +
            `returning empty. Apply the Terraform that creates it.`
        );
        return [];
      }
      throw err;
    }
  }
}
