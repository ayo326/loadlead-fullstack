// services/dashboardCalc.ts
//
// Persona-neutral domain calculations used by BOTH the carrier-org dashboard
// and the Owner Operator dashboard. No persona logic here — these functions
// take primitive load/offer/verification data and return computed numbers or
// `{ available: false, reason }` shapes when an input is missing.
//
// The two dashboard handlers each gather the relevant rows for their persona
// (org-scoped vs operator-scoped) and call into here for the math. That keeps
// the spec's Independence Principle intact (no shared persona container) while
// avoiding two copies of the formula for RPM, OTP, etc.

import { Load, LoadStatus, Offer, OfferStatus } from '../types';

// ── Common return shapes ────────────────────────────────────────────────────

/** Returned anywhere a metric can't be computed (missing data, unconnected integration). */
export type Unavailable = {
  available: false;
  /**
   * Why this metric isn't available. Frontends key off this to render
   * either a "Connect <X>" placeholder (`integration_not_connected`) or a
   * "Data not captured yet" placeholder (`pending_capture`).
   */
  reason: 'integration_not_connected' | 'pending_capture' | 'no_data';
};

export const NOT_CONNECTED: Unavailable = { available: false, reason: 'integration_not_connected' };
export const PENDING_CAPTURE: Unavailable = { available: false, reason: 'pending_capture' };
export const NO_DATA: Unavailable = { available: false, reason: 'no_data' };

// ── Active load buckets ─────────────────────────────────────────────────────
// Spec uses bucket names {booked, dispatched, inTransit, atPickup, delivered}.
// Our LoadStatus enum exposes BOOKED, IN_TRANSIT, DELIVERED, plus DRAFT/OPEN/
// OFFERED/CANCELLED/EXPIRED. We surface the spec-shaped object — buckets
// whose status doesn't exist in our state machine stay 0, which is honest
// ("we don't track At-Pickup as a distinct status") rather than fabricated.

export interface ActiveLoadCounts {
  booked: number;
  dispatched: number;
  inTransit: number;
  atPickup: number;
  delivered: number;
}

export function activeLoadCounts(loads: Load[]): ActiveLoadCounts {
  const c: ActiveLoadCounts = { booked: 0, dispatched: 0, inTransit: 0, atPickup: 0, delivered: 0 };
  for (const l of loads) {
    if (l.status === LoadStatus.BOOKED) c.booked++;
    else if (l.status === LoadStatus.IN_TRANSIT) c.inTransit++;
    else if (l.status === LoadStatus.DELIVERED) c.delivered++;
    // dispatched + atPickup currently roll into BOOKED / IN_TRANSIT — keeping
    // them as 0 is the no-fabrication choice (spec §0).
  }
  return c;
}

/** Loads accepted but with no driverId assigned yet (org accepted, dispatcher hasn't routed). */
export function unassignedLoads(loads: Load[]): Load[] {
  return loads.filter(l =>
    !l.assignedDriverId &&
    (l.status === LoadStatus.BOOKED || l.status === LoadStatus.OFFERED || l.status === LoadStatus.OPEN)
  );
}

// ── ETA-at-risk ─────────────────────────────────────────────────────────────
// Compares projected ETA against the delivery window. We don't have a
// distinct "window" object (the spec marks this 🟡), so we use deliveryDate as
// the hard deadline. ETA defaults to the live tracking ETA when present,
// otherwise to a naïve "now if it's already past delivery date" check.

export interface EtaAtRiskRow {
  loadId: string;
  eta: number;            // ms epoch
  deliveryBy: number;     // ms epoch
  minutesLate: number;
}

export function etaAtRisk(loads: Load[], etaProvider?: (loadId: string) => number | null): EtaAtRiskRow[] {
  const out: EtaAtRiskRow[] = [];
  const now = Date.now();
  for (const l of loads) {
    if (l.status !== LoadStatus.IN_TRANSIT && l.status !== LoadStatus.BOOKED) continue;
    const eta = (etaProvider ? etaProvider(l.loadId) : null) ?? now;
    if (!l.deliveryDate) continue;
    const minutesLate = Math.round((eta - l.deliveryDate) / 60000);
    if (minutesLate > 0) {
      out.push({ loadId: l.loadId, eta, deliveryBy: l.deliveryDate, minutesLate });
    }
  }
  return out.sort((a, b) => b.minutesLate - a.minutesLate);
}

// ── Financial: gross, RPM, payee breakdown ──────────────────────────────────

export interface GrossRevenue {
  week: number;
  month: number;
  /** Inclusive of in-flight (BOOKED/IN_TRANSIT) PLUS delivered, per spec §1.3. */
  total: number;
}

export function grossRevenue(loads: Load[], now = Date.now()): GrossRevenue {
  const weekAgo = now - 7 * 86_400_000;
  const monthAgo = now - 30 * 86_400_000;
  let week = 0, month = 0, total = 0;
  for (const l of loads) {
    if (l.status === LoadStatus.CANCELLED || l.status === LoadStatus.EXPIRED || l.status === LoadStatus.DRAFT) continue;
    const amt = loadRateTotal(l);
    if (amt == null) continue;
    total += amt;
    const ts = (l as any).deliveredAt ?? l.deliveryDate ?? l.createdAt ?? 0;
    if (ts >= weekAgo) week += amt;
    if (ts >= monthAgo) month += amt;
  }
  return { week, month, total };
}

/** Resolve a load's total payout to the carrier. PER_MILE × totalMiles or the FLAT_RATE amount. */
function loadRateTotal(l: Load): number | null {
  if (l.rateType === 'PER_MILE') {
    if (!l.totalMiles) return null;
    return l.rateAmount * l.totalMiles;
  }
  return l.rateAmount ?? null;
}

export interface RpmBreakdown {
  /** null when no load has both rate and miles — never 0 (no-fabrication). */
  avg: number | null;
  byLoad: { loadId: string; rpm: number }[];
}

export function rpmBreakdown(loads: Load[]): RpmBreakdown {
  const byLoad: { loadId: string; rpm: number }[] = [];
  for (const l of loads) {
    if (l.status === LoadStatus.CANCELLED || l.status === LoadStatus.EXPIRED) continue;
    if (!l.totalMiles || l.totalMiles <= 0 || !l.rateAmount) continue;
    const linehaul = l.rateType === 'PER_MILE' ? l.rateAmount : (l.rateAmount / l.totalMiles);
    if (!Number.isFinite(linehaul)) continue;
    byLoad.push({ loadId: l.loadId, rpm: Math.round(linehaul * 100) / 100 });
  }
  const avg = byLoad.length > 0
    ? Math.round((byLoad.reduce((s, x) => s + x.rpm, 0) / byLoad.length) * 100) / 100
    : null;
  return { avg, byLoad };
}

export interface PayeeBreakdown {
  carrier: number;
  factor: number;
}

/**
 * Aggregate "who gets paid" across delivered loads.
 * Caller passes a per-load payee resolution from `resolveInvoicePayee` so this
 * stays a pure aggregation — no DynamoDB calls inside the calc layer.
 */
export function payeeBreakdown(payees: Array<{ payee: 'FACTOR' | 'CARRIER'; amount: number }>): PayeeBreakdown {
  const out: PayeeBreakdown = { carrier: 0, factor: 0 };
  for (const p of payees) {
    if (p.payee === 'FACTOR') out.factor += p.amount;
    else out.carrier += p.amount;
  }
  return out;
}

// ── Acceptance / rejection rate ─────────────────────────────────────────────

export interface AcceptanceMetrics {
  offered: number;
  accepted: number;
  declined: number;
  expired: number;
  /** null if no offers in the period — never 0 (no-fabrication). */
  acceptanceRate: number | null;
  /** null if no offers in the period — never 0. */
  rejectionRate: number | null;
}

export function acceptanceMetrics(offers: Offer[]): AcceptanceMetrics {
  const offered = offers.length;
  let accepted = 0, declined = 0, expired = 0;
  for (const o of offers) {
    if (o.status === OfferStatus.ACCEPTED) accepted++;
    else if (o.status === OfferStatus.DECLINED) declined++;
    else if (o.status === OfferStatus.EXPIRED) expired++;
  }
  if (offered === 0) {
    return { offered, accepted, declined, expired, acceptanceRate: null, rejectionRate: null };
  }
  return {
    offered,
    accepted,
    declined,
    expired,
    acceptanceRate: Math.round((accepted / offered) * 1000) / 1000,
    rejectionRate:  Math.round((declined / offered) * 1000) / 1000,
  };
}

// ── OTP (on-time pickup/delivery) ───────────────────────────────────────────
// Marked 🟡 in the spec — needs status-transition timestamps we don't capture
// yet. Until those exist, return PENDING_CAPTURE rather than a fake number.

export interface OtpMetrics {
  pickupPct: number | Unavailable;
  deliveryPct: number | Unavailable;
}

export function otpMetrics(_loads: Load[]): OtpMetrics {
  return { pickupPct: PENDING_CAPTURE, deliveryPct: PENDING_CAPTURE };
}

// ── Dwell ───────────────────────────────────────────────────────────────────
// Spec: At-Pickup→Departed / At-Delivery→Departed timestamps. Same issue as
// OTP — we don't capture them yet. Return PENDING_CAPTURE per the rule.

export function dwell(_loads: Load[]): { available: false; reason: 'pending_capture' } {
  return PENDING_CAPTURE as { available: false; reason: 'pending_capture' };
}

// ── Verification rollup ─────────────────────────────────────────────────────

export interface ComplianceRollup {
  authorityActive: boolean | null;
  verificationCurrent: boolean | null;
  daysToExpiry: number | null;
}

export function complianceRollup(v: { verificationStatus?: string; fmcsaAuthorityActive?: boolean; reverifyAfter?: string } | null | undefined): ComplianceRollup {
  if (!v) return { authorityActive: null, verificationCurrent: null, daysToExpiry: null };
  const verificationCurrent = v.verificationStatus === 'VERIFIED';
  const authorityActive = typeof v.fmcsaAuthorityActive === 'boolean' ? v.fmcsaAuthorityActive : null;
  let daysToExpiry: number | null = null;
  if (v.reverifyAfter) {
    const diff = new Date(v.reverifyAfter).getTime() - Date.now();
    daysToExpiry = Math.round(diff / 86_400_000);
  }
  return { authorityActive, verificationCurrent, daysToExpiry };
}

// ── Onboarding rollup (drivers by IDV state) ────────────────────────────────

export interface OnboardingRollup {
  verified: number;
  pending: number;
  blocked: number;
}

export function onboardingRollup(users: Array<{ idvStatus?: string }>): OnboardingRollup {
  let verified = 0, pending = 0, blocked = 0;
  for (const u of users) {
    const s = u.idvStatus ?? 'UNVERIFIED';
    if (s === 'VERIFIED') verified++;
    else if (s === 'REJECTED' || s === 'EXPIRED') blocked++;
    else pending++; // UNVERIFIED + PENDING fold here — the spec lumps both as not-yet-cleared
  }
  return { verified, pending, blocked };
}

// ── Driver availability ────────────────────────────────────────────────────

export type DriverAvailability = 'free' | 'on-load';

/** A driver is "on-load" if they currently have an ACCEPTED offer or an assigned in-flight load. */
export function driverAvailability(driverId: string, offers: Offer[], loads: Load[]): DriverAvailability {
  const hasActiveOffer = offers.some(o => o.driverId === driverId && o.status === OfferStatus.ACCEPTED);
  if (hasActiveOffer) return 'on-load';
  const hasActiveLoad = loads.some(l =>
    l.assignedDriverId === driverId &&
    (l.status === LoadStatus.BOOKED || l.status === LoadStatus.IN_TRANSIT)
  );
  return hasActiveLoad ? 'on-load' : 'free';
}

// ── Factoring pipeline ──────────────────────────────────────────────────────
// `submitted` is countable today (FactoringOptIn.status). `approved`/`funded`
// need integrated-partner callbacks we don't have, so they return PENDING_CAPTURE.

export interface FactoringPipeline {
  submitted: number;
  approved: number | Unavailable;
  funded: number | Unavailable;
}

export function factoringPipeline(optIns: Array<{ status: string }>): FactoringPipeline {
  const submitted = optIns.filter(o => o.status === 'SUBMITTED').length;
  return { submitted, approved: PENDING_CAPTURE, funded: PENDING_CAPTURE };
}
