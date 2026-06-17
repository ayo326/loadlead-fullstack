// LoadLead — Account-level factoring profile
// A carrier is in exactly ONE active mode at a time (BYO or integrated partner).
// This prevents double-assignment: two factors claiming the same receivable.
//
// BYO flow:   registerByoFactor → verifyByoFactor → confirmByoRemittance → byoReady()
// Integrated: selectIntegratedPartner (blocked while BYO is live)
// Switching:  releaseCurrentFactor first, then set new mode.

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
import { AppError } from '../middleware/errorHandler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type FactoringMode = 'BYO' | 'INTEGRATED' | 'NONE';

export interface CarrierFactoringProfile {
  carrierId:   string;   // PK — operatorId or orgId
  mode:        FactoringMode;
  updatedAt:   string;

  // BYO fields
  byoFactorName?:         string;
  byoNoaKey?:             string;  // S3 key for the Notice of Assignment doc
  byoRemittanceRef?:      string;  // reference only — never raw bank details
  byoKybStatus?:          'pending' | 'pass' | 'fail';
  byoRemittanceVerified?: boolean;
  byoReleasedAt?:         string;
  byoLetterOfReleaseKey?: string;

  // Integrated fields
  integratedPartnerId?:   string;
  integratedReleasedAt?:  string;
  integratedLetterOfReleaseKey?: string;
}

const TABLE = process.env.DYNAMODB_FACTORING_PROFILES_TABLE || 'LoadLead_CarrierFactoringProfiles';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function getFactoringProfile(carrierId: string): Promise<CarrierFactoringProfile | null> {
  const res = await docClient.send(new GetCommand({ TableName: TABLE, Key: { carrierId } }));
  return (res.Item as CarrierFactoringProfile) ?? null;
}

async function saveProfile(profile: CarrierFactoringProfile): Promise<void> {
  await docClient.send(new PutCommand({ TableName: TABLE, Item: profile }));
}

function baseProfile(carrierId: string): CarrierFactoringProfile {
  return { carrierId, mode: 'NONE', updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// BYO factor
// ---------------------------------------------------------------------------

// Step 1: register a BYO factor. Blocked while an existing assignment (BYO or
// integrated) is active — caller must release first.
export async function registerByoFactor(
  carrierId: string,
  data: { factorName: string; noaKey: string; remittanceRef: string },
): Promise<CarrierFactoringProfile> {
  const existing = await getFactoringProfile(carrierId);
  if (existing?.mode !== 'NONE' && existing?.mode != null) {
    throw new AppError(
      'Release the current factoring assignment before registering a new one.',
      409,
    );
  }

  const profile: CarrierFactoringProfile = {
    ...(existing ?? baseProfile(carrierId)),
    mode:              'BYO',
    byoFactorName:     data.factorName,
    byoNoaKey:         data.noaKey,
    byoRemittanceRef:  data.remittanceRef,
    byoKybStatus:      'pending',
    byoRemittanceVerified: false,
    updatedAt:         new Date().toISOString(),
  };

  await saveProfile(profile);
  return profile;
}

// Step 2: KYB the factoring company via Didit (stubbed until key is set).
export async function verifyByoFactor(carrierId: string): Promise<void> {
  const profile = await getFactoringProfile(carrierId);
  if (!profile || profile.mode !== 'BYO') throw new AppError('No BYO factor registered', 400);

  if (!process.env.DIDIT_API_KEY) {
    console.warn(`[factoringProfile] DIDIT_API_KEY not set — stubbing BYO KYB as PASS for ${carrierId}`);
    await saveProfile({ ...profile, byoKybStatus: 'pass', updatedAt: new Date().toISOString() });
    return;
  }
  // TODO: initiate Didit KYB session for byoFactorName; webhook updates byoKybStatus
}

// Step 3: ops/automated process confirms remittance with the factor out-of-band.
// This is the anti-redirect control — we never trust carrier-entered bank details alone.
export async function confirmByoRemittance(carrierId: string): Promise<void> {
  const profile = await getFactoringProfile(carrierId);
  if (!profile || profile.mode !== 'BYO') throw new AppError('No BYO factor registered', 400);

  await saveProfile({
    ...profile,
    byoRemittanceVerified: true,
    updatedAt: new Date().toISOString(),
  });
}

// True when the BYO assignment is fully operational.
export async function byoReady(carrierId: string): Promise<boolean> {
  const profile = await getFactoringProfile(carrierId);
  return (
    profile?.mode === 'BYO' &&
    profile.byoKybStatus === 'pass' &&
    profile.byoRemittanceVerified === true &&
    !!profile.byoNoaKey
  );
}

// ---------------------------------------------------------------------------
// Integrated partner
// ---------------------------------------------------------------------------

// Select an onboarded integrated factoring partner.
// Blocked while a BYO assignment is live.
export async function selectIntegratedPartner(
  carrierId: string,
  partnerId: string,
): Promise<CarrierFactoringProfile> {
  const existing = await getFactoringProfile(carrierId);

  if (existing?.mode === 'BYO') {
    throw new AppError(
      'Release your BYO factor assignment before selecting an integrated partner.',
      409,
    );
  }
  if (existing?.mode === 'INTEGRATED') {
    throw new AppError(
      'An integrated partner is already active. Release it before selecting a new one.',
      409,
    );
  }

  const profile: CarrierFactoringProfile = {
    ...(existing ?? baseProfile(carrierId)),
    mode:                 'INTEGRATED',
    integratedPartnerId:  partnerId,
    updatedAt:            new Date().toISOString(),
  };

  await saveProfile(profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Release — must be called before switching modes.
// Records the letter of release before clearing the active mode.
// ---------------------------------------------------------------------------
export async function releaseCurrentFactor(
  carrierId: string,
  letterOfReleaseKey: string,
): Promise<CarrierFactoringProfile> {
  const profile = await getFactoringProfile(carrierId);
  if (!profile || profile.mode === 'NONE') {
    throw new AppError('No active factoring assignment to release', 400);
  }

  const released: CarrierFactoringProfile = { ...profile, updatedAt: new Date().toISOString() };

  if (profile.mode === 'BYO') {
    released.byoReleasedAt         = new Date().toISOString();
    released.byoLetterOfReleaseKey = letterOfReleaseKey;
  } else {
    released.integratedReleasedAt             = new Date().toISOString();
    released.integratedLetterOfReleaseKey     = letterOfReleaseKey;
  }
  released.mode = 'NONE';

  await saveProfile(released);
  return released;
}
