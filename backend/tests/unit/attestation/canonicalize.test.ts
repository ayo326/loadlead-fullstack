// CONSTRAINT 2 proof — canonical documentHash is stable across renders.
//
// Same projection input MUST yield the same canonicalJSON bytes and the
// same documentHash, regardless of:
//   - Object key insertion order
//   - Array element order on fields the projection sorts
//   - Numeric encoding edge cases (1 vs 1.0)
//   - Re-runs across processes / Node versions
//
// If this test ever fails, the projection or canonicalize function has
// developed an instability and old signatures cannot be re-verified.

import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../../src/services/attestation/canonicalize';
import type { Load } from '../../../src/types';
import type { ProofPhoto } from '../../../src/types/signatures';

const baseLoad: Partial<Load> = {
  loadId: 'load_abc',
  pickupAddress: '100 Pickup',
  pickupCity: 'Houston', pickupState: 'TX', pickupZip: '77001',
  pickupLat: 29.7604, pickupLng: -95.3698, pickupDate: 1782300000000 as any,
  deliveryAddress: '200 Delivery',
  deliveryCity: 'Dallas', deliveryState: 'TX', deliveryZip: '75201',
  deliveryLat: 32.7767, deliveryLng: -96.7970, deliveryDate: 1782500000000 as any,
  totalWeightLbs: 25000,
  equipmentType: 'DRY_VAN' as any,
  acceptedEquipmentTypes: ['DRY_VAN'] as any,
  commodityDescription: 'Steel coils',
  minMcMaturityDays: 180 as any,
  minCargoInsurance: 100000,
  minLiabilityInsurance: 1000000,
  hazmat: false,
};

const photo: ProofPhoto = {
  photoId: 'p1', loadId: 'load_abc', stage: 'ORIGIN',
  s3Key: 'pod/origin/load_abc/p1.jpg',
  uploadedByUserId: 'user_shi_1',
  contentType: 'image/jpeg', status: 'READY',
  contentHash: 'a'.repeat(64), createdAt: 1, finalizedAt: 2,
};

describe('CONSTRAINT 2 — canonical documentHash stability', () => {
  it('two renders of the same input → identical documentHash', () => {
    const a = canonicalize('BOL_SUBMIT', {
      load: baseLoad as Load,
      shipperUserId: 'user_shi_1',
      photos: [photo],
    });
    const b = canonicalize('BOL_SUBMIT', {
      load: baseLoad as Load,
      shipperUserId: 'user_shi_1',
      photos: [photo],
    });
    expect(a.documentHash).toEqual(b.documentHash);
    expect(a.canonicalJSON).toEqual(b.canonicalJSON);
  });

  it('key insertion order does NOT change the hash', () => {
    const reordered = {
      // build a clone in a deliberately different key order
      hazmat: false,
      commodityDescription: 'Steel coils',
      loadId: 'load_abc',
      deliveryZip: '75201',
      pickupZip: '77001',
      pickupAddress: '100 Pickup',
      deliveryAddress: '200 Delivery',
      pickupCity: 'Houston', pickupState: 'TX',
      pickupLat: 29.7604, pickupLng: -95.3698, pickupDate: 1782300000000,
      deliveryCity: 'Dallas', deliveryState: 'TX',
      deliveryLat: 32.7767, deliveryLng: -96.7970, deliveryDate: 1782500000000,
      totalWeightLbs: 25000,
      equipmentType: 'DRY_VAN',
      acceptedEquipmentTypes: ['DRY_VAN'],
      minMcMaturityDays: 180,
      minCargoInsurance: 100000, minLiabilityInsurance: 1000000,
    } as unknown as Load;

    const a = canonicalize('BOL_SUBMIT', { load: baseLoad as Load, shipperUserId: 'u', photos: [photo] });
    const b = canonicalize('BOL_SUBMIT', { load: reordered,           shipperUserId: 'u', photos: [photo] });
    expect(a.documentHash).toEqual(b.documentHash);
  });

  it('the schema version is stamped in the hash input', () => {
    const r = canonicalize('BOL_SUBMIT', { load: baseLoad as Load, shipperUserId: 'u', photos: [photo] });
    expect(r.canonicalSchemaVersion).toBe('1');
    expect(r.canonicalJSON).toContain('"canonicalSchemaVersion":"1"');
  });

  it('photo order does not change the hash (projection sorts contentHashes)', () => {
    const p1 = { ...photo, photoId: 'p1', contentHash: 'a'.repeat(64) };
    const p2 = { ...photo, photoId: 'p2', contentHash: 'b'.repeat(64) };
    const a = canonicalize('BOL_SUBMIT', { load: baseLoad as Load, shipperUserId: 'u', photos: [p1, p2] });
    const b = canonicalize('BOL_SUBMIT', { load: baseLoad as Load, shipperUserId: 'u', photos: [p2, p1] });
    expect(a.documentHash).toEqual(b.documentHash);
  });
});

describe('Synchronous finalize-upload ordering proof', () => {
  // The synchronous finalize step exists so the photo's contentHash is
  // known to the server BEFORE any signature attempt can bind it. The
  // canonicalizer enforces this by rejecting any photo whose status is
  // not READY (i.e. contentHash not set).
  it('signing with a PENDING photo throws CANONICALIZE_PHOTO_NOT_FINALIZED', () => {
    const pending: ProofPhoto = { ...photo, status: 'PENDING', contentHash: undefined };
    expect(() =>
      canonicalize('BOL_SUBMIT', { load: baseLoad as Load, shipperUserId: 'u', photos: [pending] }),
    ).toThrow(/CANONICALIZE_PHOTO_NOT_FINALIZED/);
  });

  it('signing with a READY-but-hash-missing photo also throws', () => {
    const bad: ProofPhoto = { ...photo, status: 'READY', contentHash: undefined };
    expect(() =>
      canonicalize('BOL_SUBMIT', { load: baseLoad as Load, shipperUserId: 'u', photos: [bad] }),
    ).toThrow(/CANONICALIZE_PHOTO_NOT_FINALIZED/);
  });
});
