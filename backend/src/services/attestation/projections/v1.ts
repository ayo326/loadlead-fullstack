// Canonical projection v1.
//
// Per-action allowlist. Old signatures stay verifiable against the
// version they were signed under — DO NOT EDIT v1 IN PLACE; bump to v2
// in a new file when fields change.
//
// The projection MUST NOT include:
//   - updatedAt / createdAt or any churn timestamp
//   - any field that re-renders may change (e.g. derived totals)
//   - photo URLs or S3 keys (we bind to contentHash of bytes)
//
// All values are pre-normalized here so the downstream canonicalize()
// only has to sort keys + stringify. Keeping that boundary clean is
// what makes the resulting hash stable across renders, processes, and
// Node versions.

import type { Load } from '../../../types';
import type { ProofPhoto, AttestationAction } from '../../../types/signatures';

/** Resolved carrier-of-record, as returned by services/carrierOfRecord.ts */
export interface ResolvedCoR {
  entityType: string;
  entityId:   string;
}

/** Input bundle the projector reads. Allows the projection to be pure. */
export interface ProjectionInput {
  load:                Load;
  bol?:                { bolId: string } | null;
  shipperOrgId?:       string | null;
  shipperUserId?:      string | null;
  carrierOfRecord?:    ResolvedCoR | null;
  assignedDriverId?:   string | null;
  /** The rate the carrier is committing to (negotiated/agreed). When set it
   *  overrides the load's posted rate in the CARRIER_ACCEPT projection so the
   *  attestation binds what settlement pays. rateAmount is in the same units as
   *  Load.rateAmount (dollars): $/mi for PER_MILE, total $ for FLAT_RATE. */
  rateAmount?:         number | null;
  rateType?:           string | null;
  /** Photos for THIS handoff. Already filtered + READY (contentHash set). */
  photos?:             ProofPhoto[];
  exceptions?:         { code: string; description: string } | null;
  /** Server-recorded actual time for the action (e.g. pickup/delivery/receipt). */
  actualAt?:           string;
  /** Server-recorded geo for the action when relevant. */
  geo?:                { lat: number; lng: number } | null;
}

/* ─────────────────────────── primitives ─────────────────────────── */

/** Normalize a number to JSON form: integer when possible, otherwise repr. */
function num(n: number | undefined | null): number | null {
  if (n === undefined || n === null) return null;
  if (!Number.isFinite(n)) return null;
  // JSON.stringify already drops trailing zeros consistently; this just
  // narrows undefined/NaN/+Inf out so the projection has no surprises.
  return n;
}

/** Always ISO-8601 with Z. Accepts ms epoch, ISO string, or undefined. */
function iso(value: number | string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Sort + dedupe an array of strings, dropping null/undefined. */
function sortedStrings(values: (string | null | undefined)[] | undefined): string[] {
  if (!values) return [];
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort();
}

/** Pull READY photos' content hashes; reject if any aren't finalized. */
function photoHashes(photos: ProofPhoto[] | undefined): string[] {
  if (!photos || photos.length === 0) return [];
  for (const p of photos) {
    if (p.status !== 'READY' || !p.contentHash) {
      throw new Error(
        `CANONICALIZE_PHOTO_NOT_FINALIZED: photoId=${p.photoId} status=${p.status} hash=${p.contentHash ?? 'null'}`,
      );
    }
  }
  return sortedStrings(photos.map((p) => p.contentHash));
}

/* ─────────────────────────── projections ─────────────────────────── */

export const canonicalSchemaVersion = '1';

function projectBolSubmit(i: ProjectionInput): Record<string, unknown> {
  const l = i.load;
  return {
    action:                'BOL_SUBMIT',
    loadId:                l.loadId,
    bolId:                 i.bol?.bolId ?? null,
    shipperOrgId:          i.shipperOrgId ?? null,
    shipperUserId:         i.shipperUserId ?? null,
    commodityDescription:  l.commodityDescription ?? null,
    totalWeightLbs:        num(l.totalWeightLbs),
    pickupAddress:         l.pickupAddress ?? null,
    pickupCity:            l.pickupCity ?? null,
    pickupState:           l.pickupState ?? null,
    pickupZip:             l.pickupZip ?? null,
    pickupLat:             num(l.pickupLat),
    pickupLng:             num(l.pickupLng),
    pickupDate:            iso(l.pickupDate),
    deliveryAddress:       l.deliveryAddress ?? null,
    deliveryCity:          l.deliveryCity ?? null,
    deliveryState:         l.deliveryState ?? null,
    deliveryZip:           l.deliveryZip ?? null,
    deliveryLat:           num(l.deliveryLat),
    deliveryLng:           num(l.deliveryLng),
    deliveryDate:          iso(l.deliveryDate),
    equipmentType:         l.equipmentType ?? null,
    acceptedEquipmentTypes: sortedStrings(l.acceptedEquipmentTypes as string[]),
    minMcMaturityDays:     num(l.minMcMaturityDays as number),
    minCargoInsurance:     num(l.minCargoInsurance),
    minLiabilityInsurance: num(l.minLiabilityInsurance),
    hazmat:                Boolean(l.hazmat),
    originPhotoContentHashes: photoHashes(i.photos),
  };
}

function projectCarrierAccept(i: ProjectionInput): Record<string, unknown> {
  const l = i.load;
  if (!i.carrierOfRecord) throw new Error('CANONICALIZE_MISSING_COR');
  return {
    action:        'CARRIER_ACCEPT',
    loadId:        l.loadId,
    carrierOfRecord_entityType: i.carrierOfRecord.entityType,
    carrierOfRecord_entityId:   i.carrierOfRecord.entityId,
    assignedDriverId: i.assignedDriverId ?? l.assignedDriverId ?? null,
    // Bind the rate the carrier actually commits to. A negotiated accept passes
    // the agreed/offered rate (i.rateAmount / i.rateType); a straight claim
    // falls back to the load's posted rate. Keeps the attestation's bound rate
    // equal to what settlement pays out (no reconciliation drift).
    rateAmount:    num(i.rateAmount ?? l.rateAmount),
    rateType:      i.rateType ?? l.rateType ?? null,
  };
}

function projectDriverPickup(i: ProjectionInput): Record<string, unknown> {
  return {
    action:        'DRIVER_PICKUP',
    loadId:        i.load.loadId,
    stage:         'PICKUP',
    pickupActualAt: iso(i.actualAt),
    pickupGeo:     i.geo ? { lat: num(i.geo.lat), lng: num(i.geo.lng) } : null,
    photoContentHashes: photoHashes(i.photos),
  };
}

function projectDriverDeliver(i: ProjectionInput): Record<string, unknown> {
  return {
    action:        'DRIVER_DELIVER',
    loadId:        i.load.loadId,
    stage:         'DELIVERY',
    deliveredActualAt: iso(i.actualAt),
    deliveryGeo:   i.geo ? { lat: num(i.geo.lat), lng: num(i.geo.lng) } : null,
    photoContentHashes: photoHashes(i.photos),
  };
}

function projectReceiverConfirm(i: ProjectionInput): Record<string, unknown> {
  return {
    action:        'RECEIVER_CONFIRM',
    loadId:        i.load.loadId,
    stage:         'RECEIPT',
    receivedActualAt: iso(i.actualAt),
    photoContentHashes: photoHashes(i.photos),
    exceptions: i.exceptions
      ? { code: i.exceptions.code, description: i.exceptions.description }
      : null,
  };
}

const PROJECTORS: Record<AttestationAction, (i: ProjectionInput) => Record<string, unknown>> = {
  BOL_SUBMIT:        projectBolSubmit,
  CARRIER_ACCEPT:    projectCarrierAccept,
  DRIVER_PICKUP:     projectDriverPickup,
  DRIVER_DELIVER:    projectDriverDeliver,
  RECEIVER_CONFIRM:  projectReceiverConfirm,
};

export function project(action: AttestationAction, input: ProjectionInput): Record<string, unknown> {
  const p = PROJECTORS[action];
  if (!p) throw new Error(`CANONICALIZE_UNKNOWN_ACTION: ${action}`);
  return p(input);
}
