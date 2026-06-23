// SLA state computation.
//
// Pure functions: given a ticket and the current clock, decide whether
// it's ON_TRACK / DUE_SOON / BREACHED / RESOLVED. No DB access here so
// the same logic powers both the API response shaping and the monitor
// aggregation.

import type { SupportTicket, SLAState } from '../types/support';

/** Default "due soon" threshold: 20% of the SLA target. */
const DUE_SOON_RATIO = 0.2;

export interface SLASnapshot {
  state:           SLAState;
  /** Minutes remaining until breach. Negative when already breached. Null when resolved. */
  minutesToBreach: number | null;
  /** Absolute breach time (epoch ms). Null when resolved. */
  breachAt:        number | null;
}

export function computeSlaState(
  ticket: Pick<SupportTicket, 'createdAt' | 'slaTargetMinutes' | 'resolvedAt' | 'status'>,
  now: number = Date.now(),
): SLASnapshot {
  if (ticket.status === 'SOLVED' || ticket.resolvedAt != null) {
    return { state: 'RESOLVED', minutesToBreach: null, breachAt: null };
  }
  const targetMs = ticket.slaTargetMinutes * 60_000;
  const breachAt = ticket.createdAt + targetMs;
  const remainingMs = breachAt - now;
  const minutesToBreach = Math.round(remainingMs / 60_000);

  if (remainingMs <= 0) return { state: 'BREACHED', minutesToBreach, breachAt };
  if (remainingMs <= targetMs * DUE_SOON_RATIO) return { state: 'DUE_SOON', minutesToBreach, breachAt };
  return { state: 'ON_TRACK', minutesToBreach, breachAt };
}

export interface MonitorAggregate {
  openCount:      number;
  breachingCount: number;
  dueSoonCount:   number;
  /** Average minutes to resolve, over tickets resolved in the last `windowDays` window. Null when no data. */
  avgResolutionMinutes: number | null;
  /** % of resolved tickets in window that were resolved WITHIN their slaTargetMinutes. Null when no data. */
  percentWithinSla: number | null;
  windowDays: number;
}

export function aggregateMonitor(tickets: SupportTicket[], windowDays = 30, now = Date.now()): MonitorAggregate {
  const windowStart = now - windowDays * 86_400_000;
  let breaching = 0, dueSoon = 0, openCount = 0;
  let resolutionSum = 0, resolutionCount = 0, withinSla = 0;

  for (const t of tickets) {
    const snap = computeSlaState(t, now);
    if (t.status !== 'SOLVED') {
      openCount++;
      if (snap.state === 'BREACHED') breaching++;
      else if (snap.state === 'DUE_SOON') dueSoon++;
    }
    if (t.status === 'SOLVED' && t.resolvedAt != null && t.resolvedAt >= windowStart) {
      const mins = Math.round((t.resolvedAt - t.createdAt) / 60_000);
      resolutionSum += mins;
      resolutionCount++;
      if (mins <= t.slaTargetMinutes) withinSla++;
    }
  }
  return {
    openCount,
    breachingCount: breaching,
    dueSoonCount:   dueSoon,
    avgResolutionMinutes: resolutionCount > 0 ? Math.round(resolutionSum / resolutionCount) : null,
    percentWithinSla:     resolutionCount > 0 ? Math.round((withinSla / resolutionCount) * 100) : null,
    windowDays,
  };
}
