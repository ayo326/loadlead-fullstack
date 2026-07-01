/**
 * Append-only stop-events log (check-in / check-out evidence).
 *
 * Detention and layover are computed from these immutable events, never from
 * client-supplied durations. Each event references a load and a stop by id only;
 * the Load model is never touched (the global constraint), mirroring the
 * trust-events store.
 *
 * Append-only: rows are never updated or deleted. A correction is a NEW event
 * that names the event it supersedes via correctsEventId; the reader treats the
 * newest non-superseded ARRIVAL and DEPARTURE per stop as effective, leaving the
 * corrected rows in place for audit.
 *
 * Event time is set server-side on a live check-in/check-out. A correction may
 * carry an explicit eventAt (the only time a caller can set it), so a wrong time
 * can be fixed with a new append-only row rather than an edit.
 */

import { Database } from '../config/database';
import config from '../config/environment';
import { Helpers } from '../utils/helpers';
import { Logger } from '../utils/logger';

export type StopEventType = 'ARRIVAL' | 'DEPARTURE';

export interface StopEvent {
  eventId: string; // 'stopevt_...'
  loadId: string; // reference to a load, by id only
  stopId: string; // logical stop id (e.g. PICKUP, DELIVERY, or a facility id)
  eventType: StopEventType;
  eventAt: number; // epoch ms, server-set (or corrected via a superseding row)
  actorId: string;
  lat?: number;
  lng?: number;
  geofenceMatch?: boolean;
  /** Evidence reference reusing the POD attestation (proof photo id), by id only. */
  evidencePhotoId?: string;
  /** Optional reference to a POD/BOL signature row, by id only. */
  evidenceSignatureId?: string;
  note?: string;
  /** Names the event this row corrects. Append-only: the old row stays for audit. */
  correctsEventId?: string;
  createdAt: number; // epoch ms, insertion order (latest correction wins)
}

export interface RecordStopEventInput {
  loadId: string;
  stopId: string;
  actorId: string;
  lat?: number;
  lng?: number;
  geofenceMatch?: boolean;
  evidencePhotoId?: string;
  evidenceSignatureId?: string;
  note?: string;
  /** Only honored together with correctsEventId, to fix a mistaken time. */
  correctsEventId?: string;
  eventAt?: number;
}

export interface ArrivalDeparturePair {
  arrival: StopEvent | null;
  departure: StopEvent | null;
}

function buildEvent(eventType: StopEventType, input: RecordStopEventInput): StopEvent {
  if (!input.loadId || !input.stopId) {
    throw new Error('stopEvent: loadId and stopId are required');
  }
  if (!input.actorId) {
    throw new Error('stopEvent: actorId is required');
  }
  // Event time is server-side. Only a correction (correctsEventId set) may carry
  // an explicit eventAt, so an honest mistake can be fixed append-only.
  if (input.eventAt != null && !input.correctsEventId) {
    throw new Error('stopEvent: eventAt may only be supplied on a correction (with correctsEventId)');
  }
  const now = Helpers.getCurrentTimestamp();
  const eventAt = input.correctsEventId && input.eventAt != null ? input.eventAt : now;

  return {
    eventId: Helpers.generateId('stopevt'),
    loadId: input.loadId,
    stopId: input.stopId,
    eventType,
    eventAt,
    actorId: input.actorId,
    ...(input.lat != null ? { lat: input.lat } : {}),
    ...(input.lng != null ? { lng: input.lng } : {}),
    ...(input.geofenceMatch != null ? { geofenceMatch: input.geofenceMatch } : {}),
    ...(input.evidencePhotoId ? { evidencePhotoId: input.evidencePhotoId } : {}),
    ...(input.evidenceSignatureId ? { evidenceSignatureId: input.evidenceSignatureId } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.correctsEventId ? { correctsEventId: input.correctsEventId } : {}),
    createdAt: now,
  };
}

export class StopEventService {
  /** Record a check-in (ARRIVAL). Append-only. */
  static async checkIn(input: RecordStopEventInput): Promise<StopEvent> {
    const event = buildEvent('ARRIVAL', input);
    await Database.putItem(config.dynamodb.stopEventsTable, event);
    return event;
  }

  /** Record a check-out (DEPARTURE). Append-only. */
  static async checkOut(input: RecordStopEventInput): Promise<StopEvent> {
    const event = buildEvent('DEPARTURE', input);
    await Database.putItem(config.dynamodb.stopEventsTable, event);
    return event;
  }

  /** All events for a load (optionally one stop), ordered oldest first by createdAt. */
  static async list(loadId: string, stopId?: string): Promise<StopEvent[]> {
    const all = await this.scanAll();
    return all
      .filter((e) => e.loadId === loadId && (stopId == null || e.stopId === stopId))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Distinct stop ids seen for a load, in first-seen order. */
  static async stopIds(loadId: string): Promise<string[]> {
    const events = await this.list(loadId);
    const seen: string[] = [];
    for (const e of events) if (!seen.includes(e.stopId)) seen.push(e.stopId);
    return seen;
  }

  /**
   * The effective ARRIVAL/DEPARTURE pair for a stop: the newest non-superseded
   * event of each type. A correction (a newer row naming an older eventId via
   * correctsEventId) supersedes the named row; the latest-recorded one wins.
   */
  static async effectivePair(loadId: string, stopId: string): Promise<ArrivalDeparturePair> {
    const events = await this.list(loadId, stopId);
    const superseded = new Set(events.map((e) => e.correctsEventId).filter(Boolean) as string[]);
    const live = events.filter((e) => !superseded.has(e.eventId));
    const newest = (type: StopEventType): StopEvent | null =>
      live
        .filter((e) => e.eventType === type)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    return { arrival: newest('ARRIVAL'), departure: newest('DEPARTURE') };
  }

  /**
   * Scan the store, tolerating a not-yet-created table (mirrors the other
   * append-only stores). A missing table reads as empty. Scan is fine at beta
   * volume; add a loadId GSI before scale.
   */
  private static async scanAll(): Promise<StopEvent[]> {
    try {
      return await Database.scan<StopEvent>(config.dynamodb.stopEventsTable);
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        Logger.warn(`StopEvents table ${config.dynamodb.stopEventsTable} not found; returning empty.`);
        return [];
      }
      throw err;
    }
  }
}
