// LoadLead - Carrier/Driver verification
// State machine:
//   UNVERIFIED -> PENDING -> VERIFIED | REJECTED
//   VERIFIED   -> EXPIRED (authority lapse / re-check due) -> PENDING -> ...
//
// Invariant: only a VERIFIED carrier entity with currently-active FMCSA authority
// may accept loads. Enforced in middleware - never in the UI.

import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
import { Database } from '../config/database';
import config from '../config/environment';
import { DriverService } from './driverService';
import { OwnerOperatorService } from './ownerOperatorService';
import { isCarrierVerified } from './carrierOfRecord';
import { checkCarrierAuthority } from './integrations/fmcsa';
import { createDiditSession, checkAml } from './integrations/didit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export enum VerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING    = 'PENDING',
  VERIFIED   = 'VERIFIED',
  REJECTED   = 'REJECTED',
  EXPIRED    = 'EXPIRED',
}

export enum EntityType {
  OWNER_OPERATOR = 'OWNER_OPERATOR',
  ORGANIZATION   = 'ORGANIZATION',
  DRIVER         = 'DRIVER',
}

type SubStatus = 'pending' | 'pass' | 'fail';

export interface Verification {
  entityId: string;
  entityType: EntityType;
  verificationStatus: VerificationStatus;

  fmcsaAuthorityActive?: boolean;
  fmcsaCheckedAt?: string;
  mcNumber?: string;
  dotNumber?: string;

  kybStatus?: SubStatus;
  idvStatus?: SubStatus;
  amlStatus?: SubStatus;
  diditSessionId?: string;
  diditIdvUrl?: string;   // URL to redirect user to for IDV
  diditKybUrl?: string;   // URL to redirect user to for KYB

  docsSubmittedAt?: string;
  verifiedAt?: string;
  reverifyAfter?: string;
  updatedAt: string;
}

const TABLE        = process.env.DYNAMODB_VERIFICATIONS_TABLE || 'LoadLead_Verifications';
const STATUS_INDEX = 'status-index';
const REVERIFY_DAYS = 90;

// ---------------------------------------------------------------------------
// Core service
// ---------------------------------------------------------------------------
export async function getVerification(entityId: string): Promise<Verification | null> {
  const res = await docClient.send(new GetCommand({ TableName: TABLE, Key: { entityId } }));
  return (res.Item as Verification) ?? null;
}

// Identity (IDV) only gates DRIVER-entity records (keyed by userId) - carrier
// authority records (OO/org, keyed by operatorId/orgId) are gated on
// FMCSA + KYB + AML only. Identity is checked separately, per person, in
// requireVerifiedCarrier() gate 2 against the same DRIVER-entity record.
function deriveStatus(v: Partial<Verification>): VerificationStatus {
  if (!v.docsSubmittedAt) return VerificationStatus.UNVERIFIED;
  if (v.fmcsaAuthorityActive === false) return VerificationStatus.REJECTED;
  if (v.kybStatus === 'fail' || v.idvStatus === 'fail' || v.amlStatus === 'fail')
    return VerificationStatus.REJECTED;

  const isCarrier = v.entityType !== EntityType.DRIVER;
  const fmcsaOk = !isCarrier || v.fmcsaAuthorityActive === true;
  const kybOk   = !isCarrier || v.kybStatus === 'pass';
  const idvOk   = isCarrier || v.idvStatus === 'pass';
  // Audit v6 M1: a never-screened entity (amlStatus undefined) must not count as
  // AML-clear. Gated behind AML_REQUIRED so this ships inert - undefined keeps
  // passing until (1) existing entities are backfilled with a real amlStatus and
  // (2) the flag is flipped in prod. A definitive 'fail' already REJECTs above;
  // 'pending' is never a pass, so a screen still in progress holds at PENDING.
  const amlOk   = v.amlStatus === 'pass' || (!amlRequired() && v.amlStatus === undefined);

  if (fmcsaOk && kybOk && idvOk && amlOk) return VerificationStatus.VERIFIED;
  return VerificationStatus.PENDING;
}

/**
 * AML enforcement gate (audit v6 M1). OFF by default so the AML wiring ships
 * inert. Flip AML_REQUIRED=true in prod ONLY after every already-verified
 * carrier/driver has been backfilled with a real amlStatus - otherwise the flip
 * would immediately un-verify them (they currently have amlStatus=undefined).
 */
export function amlRequired(): boolean {
  return process.env.AML_REQUIRED === 'true';
}

export async function recomputeAndPersist(
  entityId: string,
  patch: Partial<Verification>,
): Promise<Verification> {
  const current = (await getVerification(entityId)) ?? ({ entityId } as Verification);
  const merged: Verification = { ...current, ...patch, updatedAt: new Date().toISOString() };

  merged.verificationStatus = deriveStatus(merged);
  if (merged.verificationStatus === VerificationStatus.VERIFIED && !merged.verifiedAt) {
    merged.verifiedAt    = new Date().toISOString();
    merged.reverifyAfter = new Date(Date.now() + REVERIFY_DAYS * 864e5).toISOString();
  }

  await docClient.send(new PutCommand({ TableName: TABLE, Item: merged }));

  // Identity lives on the User, not the Driver (spec §4) - mirror the derived
  // status onto Users.idvStatus so it can be read without a second lookup
  // shape, and so it survives independent of which carrier parent governs
  // this person's haul authority.
  if (merged.entityType === EntityType.DRIVER) {
    try {
      await Database.updateItem(config.dynamodb.usersTable, { userId: entityId }, {
        idvStatus: merged.verificationStatus,
      });
    } catch (err) {
      console.error('[verification] Failed to mirror idvStatus onto User:', err);
    }
  }

  return merged;
}

export async function getReviewQueue(
  status: VerificationStatus = VerificationStatus.PENDING,
): Promise<Verification[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: 'verificationStatus = :s',
      ExpressionAttributeValues: { ':s': status },
    }),
  );
  return (res.Items as Verification[]) ?? [];
}

// ---------------------------------------------------------------------------
// THE GATE - apply to every accept route (driver self-accept, and OO acting
// on behalf of a fleet driver or its own self-driver).
//
// Two independent gates, composed via carrierOfRecord.ts (spec §4, §8):
//   1. Carrier AUTHORITY - resolveCarrierOfRecord(driver) must be non-null
//      and VERIFIED (FMCSA + KYB + AML at the OO/Carrier-org parent level).
//   2. Driver IDENTITY   - the acting driver's own user.idvStatus must be
//      VERIFIED (Didit IDV, per person, never inherited from the parent).
// ---------------------------------------------------------------------------
export function requireVerifiedCarrier() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, role } = (req as any).user;
      const requestedDriverId = (req.body as any)?.driverId as string | undefined;

      // Resolve which Driver record is actually accepting this load.
      //   - DRIVER role always acts on their own profile.
      //   - OWNER_OPERATOR may act on an explicit fleet driverId, or default
      //     to their own self-driver (ownedByOperatorId === own operatorId).
      const driver = requestedDriverId
        ? await DriverService.getProfileById(requestedDriverId)
        : await DriverService.getProfileByUserId(userId);

      if (!driver) {
        return res.status(404).json({
          error: 'driver_not_found',
          message: 'No driver profile found for the requested driver.',
        });
      }

      if (role === 'OWNER_OPERATOR' && requestedDriverId) {
        const op = await OwnerOperatorService.getByUserId(userId);
        const isOwnSelfDriver = driver.userId === userId; // OO's self-driver carries their own userId
        if (!op || (!isOwnSelfDriver && !(op.fleetDriverIds ?? []).includes(requestedDriverId))) {
          return res.status(403).json({ error: 'forbidden', message: 'Driver is not yours (self-driver or fleet).' });
        }
      }

      // Gate 1 - carrier authority.
      const { verified, carrier, status } = await isCarrierVerified(driver);
      if (!verified) {
        return res.status(403).json({ error: 'carrier_not_verified', reason: status });
      }

      // Gate 2 - driver identity (per person, on the User record).
      const identity = await getVerification(driver.userId);
      if (identity?.verificationStatus !== VerificationStatus.VERIFIED) {
        return res.status(403).json({ error: 'driver_not_verified', reason: 'idv_incomplete' });
      }
      if (identity.reverifyAfter && new Date(identity.reverifyAfter) < new Date()) {
        return res.status(403).json({ error: 'driver_not_verified', reason: 'reverification_overdue' });
      }

      (req as any).carrierOfRecord = carrier;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// FMCSA QCMobile check + Didit session/AML - both now route through
// services/integrations/. This file no longer reads FMCSA_WEBKEY or
// DIDIT_API_KEY, or calls fetch() against either provider, directly - the
// adapters are the only thing that do. Exported signatures below are
// unchanged from before this refactor.
// ---------------------------------------------------------------------------
export async function runFmcsaCheck(mc?: string, dot?: string): Promise<boolean> {
  return checkCarrierAuthority(mc, dot);
}

async function callDiditAml(entityId: string, fullName: string): Promise<SubStatus> {
  return checkAml(entityId, fullName);
}

// ---------------------------------------------------------------------------
// Submission entry points
// ---------------------------------------------------------------------------

// Carrier (OO or org) submits MC/DOT + docs.
// Runs FMCSA check, persists PENDING record, then launches a Didit KYB session.
// Identity (IDV) is NOT part of this submission - it is per-person and lives
// on User.idvStatus (see submitDriverIdv). An OO completes IDV the same way
// any Carrier-org driver does, once, for their own userId.
// Returns the verification record with the KYB session URL for redirection.
export async function submitCarrierDocs(
  entityId: string,
  entityType: EntityType,
  mc: string,
  dot: string,
): Promise<Verification> {
  const fmcsaActive = await runFmcsaCheck(mc, dot);

  const v = await recomputeAndPersist(entityId, {
    entityType,
    mcNumber:             mc,
    dotNumber:            dot,
    fmcsaAuthorityActive: fmcsaActive,
    fmcsaCheckedAt:       new Date().toISOString(),
    docsSubmittedAt:      new Date().toISOString(),
    kybStatus:            'pending',
  });

  const kybWorkflow = process.env.DIDIT_KYB_WORKFLOW_ID;
  if (!kybWorkflow) {
    console.warn('[verification] DIDIT_KYB_WORKFLOW_ID not set');
    return v;
  }

  const kyb = await createDiditSession(kybWorkflow, entityId);
  if (!kyb) return v;

  return recomputeAndPersist(entityId, {
    diditKybUrl:    kyb.url,
    diditSessionId: kyb.session_id,
  });
}

// Per-person identity verification (Didit IDV). Required for EVERY operating
// driver - Carrier-org members, OO fleet drivers, and an OO's own self-driver
// - keyed by userId (not driverId), since identity is per-human and an OO who
// also drives verifies once for both roles.
// Returns the verification record with diditIdvUrl for frontend redirection.
export async function submitDriverIdv(userId: string): Promise<Verification> {
  const v = await recomputeAndPersist(userId, {
    entityType:      EntityType.DRIVER,
    docsSubmittedAt: new Date().toISOString(),
    idvStatus:       'pending',
  });

  const idvWorkflow = process.env.DIDIT_IDV_WORKFLOW_ID;
  if (!idvWorkflow) {
    console.warn('[verification] DIDIT_IDV_WORKFLOW_ID not set - skipping IDV session');
    return v;
  }

  const session = await createDiditSession(idvWorkflow, userId);
  if (!session) return v;

  return recomputeAndPersist(userId, {
    diditIdvUrl:    session.url,
    diditSessionId: session.session_id,
  });
}

// Admin manual override - approve or reject a verification record.
export async function adminOverride(
  entityId: string,
  decision: 'approve' | 'reject',
): Promise<Verification> {
  const v = await getVerification(entityId);
  const isCarrier = v?.entityType !== EntityType.DRIVER;

  if (decision === 'approve') {
    return recomputeAndPersist(entityId, {
      kybStatus: isCarrier ? 'pass' : v?.kybStatus,
      idvStatus: isCarrier ? v?.idvStatus : 'pass',
      amlStatus: v?.amlStatus ?? undefined,
    });
  }
  return recomputeAndPersist(entityId, isCarrier ? { kybStatus: 'fail' } : { idvStatus: 'fail' });
}

// ---------------------------------------------------------------------------
// Didit webhook - PUBLIC route (no JWT). Mount as POST /api/webhooks/didit.
//
// Didit v3 signature verification:
//   X-Timestamp   - Unix epoch seconds of the request
//   X-Signature-V2 - HMAC-SHA256(secret, "${timestamp}.${rawBody}")
//
// Raw body must be captured before JSON parsing - Express must be configured
// with `verify` on express.json() to store req.rawBody. See index.ts note.
// ---------------------------------------------------------------------------

function verifyDiditSignature(req: Request, secret: string): boolean {
  const timestamp      = req.headers['x-timestamp'] as string | undefined;
  const sigV2          = req.headers['x-signature-v2'] as string | undefined;
  const sigSimple      = req.headers['x-signature-simple'] as string | undefined;
  const rawBody        = (req as any).rawBody as Buffer | undefined;

  // Debug log - does not expose secret or body content.
  console.info('[verification] webhook sig check - rawBody present:', !!rawBody,
    '| sigV2 present:', !!sigV2, '| sigSimple present:', !!sigSimple,
    '| timestamp:', timestamp);

  if (!rawBody) {
    console.error('[verification] rawBody not captured - check express.json verify config');
    return false;
  }

  const bodyStr = rawBody.toString('utf8');

  // Try X-Signature-Simple first: HMAC-SHA256(secret, rawBody)
  if (sigSimple) {
    try {
      const expected = createHmac('sha256', secret).update(bodyStr).digest('hex');
      console.info('[verification] sigSimple check - received:', sigSimple.slice(0, 8), 'expected:', expected.slice(0, 8));
      if (timingSafeEqual(Buffer.from(sigSimple), Buffer.from(expected))) return true;
    } catch { /* length mismatch - fall through */ }
  }

  // Try X-Signature-V2: HMAC-SHA256(secret, "${timestamp}.${rawBody}")
  if (sigV2 && timestamp) {
    // Reject replays older than 10 minutes.
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > 600) {
      console.warn('[verification] webhook timestamp too old:', age, 'seconds');
      return false;
    }
    try {
      const expected = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`).digest('hex');
      console.info('[verification] sigV2 check - received:', sigV2.slice(0, 8), 'expected:', expected.slice(0, 8));
      if (timingSafeEqual(Buffer.from(sigV2), Buffer.from(expected))) return true;
    } catch { /* length mismatch - fall through */ }
  }

  console.warn('[verification] all signature formats exhausted - none matched');
  return false;
}

export async function diditWebhookHandler(req: Request, res: Response) {
  const event: any = req.body;

  // Skip test events BEFORE signature check - test webhooks from the Didit console
  // carry metadata.test_webhook === true and the X-Didit-Test-Webhook header.
  // Didit test payloads may not be signed with a real key, so we bypass sig check for them.
  const isTestEvent =
    event?.metadata?.test_webhook === true ||
    req.headers['x-didit-test-webhook'] === 'true';

  if (isTestEvent) {
    console.info('[verification] Didit test webhook received - skipping signature check');
    return res.json({ ok: true, test: true });
  }

  const secret = process.env.DIDIT_WEBHOOK_SECRET;

  if (secret) {
    if (!verifyDiditSignature(req, secret)) {
      return res.status(401).json({ error: 'invalid_signature' });
    }
  } else if (process.env.APP_ENV === 'production') {
    // SEC-H7: fail closed in production. This is a public, state-mutating
    // webhook that writes idvStatus/kybStatus/amlStatus keyed on the request
    // body; without a secret we cannot verify the sender, so an unsigned event
    // could forge a VERIFIED entity. Mirror the Canopy webhook and reject.
    console.warn('[verification] Didit webhook rejected: DIDIT_WEBHOOK_SECRET not set in production');
    return res.status(401).json({ error: 'webhook_not_configured' });
  } else {
    console.warn('[verification] DIDIT_WEBHOOK_SECRET not set - skipping signature check (non-production)');
  }

  // Didit v3 payload shape (confirmed from test webhook):
  //   event.vendor_data        - our entityId
  //   event.status             - 'Approved' | 'Declined' | 'In Review'
  //   event.session_id         - Didit session UUID
  //   event.webhook_type       - 'status.updated' | 'user.status.updated' |
  //                              'business.status.updated' | 'business.data.updated' | ...
  //   event.metadata.test_webhook - true on test events
  //   event.decision.aml_screenings[0] - AML result when AML feature is present

  const entityId   = event?.vendor_data;
  const status     = event?.status;      // 'Approved' | 'Declined' | 'In Review'
  const sessionId  = event?.session_id;
  const webhookType: string = event?.webhook_type ?? '';

  if (!entityId) {
    // M10 (audit v6): never log the full Didit event body - it carries identity/KYC
    // PII. Log only the non-PII envelope fields needed to debug a missing vendor_data.
    console.warn('[verification] Didit webhook missing vendor_data', {
      session_id: sessionId,
      webhook_type: webhookType,
      status,
    });
    return res.status(400).json({ error: 'missing_entity' });
  }

  const sub: SubStatus =
    status === 'Approved' ? 'pass' :
    status === 'Declined' ? 'fail' :
    'pending';

  // business.* events are KYB (carrier entity); everything else is IDV (human).
  const isKyb = webhookType.startsWith('business.');

  const patch: Partial<Verification> = { diditSessionId: sessionId };
  if (isKyb) patch.kybStatus = sub;
  else        patch.idvStatus = sub;

  // Extract AML result if this session included AML screening.
  const amlResult = event?.decision?.aml_screenings?.[0];
  if (amlResult) {
    patch.amlStatus =
      amlResult.status === 'Approved' && amlResult.total_hits === 0 ? 'pass' :
      amlResult.status === 'Declined' || amlResult.total_hits > 0   ? 'fail' :
      'pending';
  }

  const merged = await recomputeAndPersist(entityId, patch);

  // Audit v6 M1: when AML enforcement is on, run a standalone AML screen the
  // moment KYB (carrier) or IDV (driver) passes and no definitive AML result is
  // yet on record (the KYB/IDV workflow itself may not include AML). Best-effort:
  // a screen failure leaves amlStatus 'pending' (held, not verified via
  // deriveStatus) and never breaks the webhook acknowledgement.
  if (amlRequired() && sub === 'pass' && merged.amlStatus !== 'pass' && merged.amlStatus !== 'fail') {
    try {
      await screenEntityAml(entityId, merged.entityType);
    } catch (err) {
      console.error('[verification] AML screen after pass failed (left pending):', err);
    }
  }
  return res.json({ ok: true });
}

// AML screening - runs a synchronous Didit AML check on the entity.
// Typically called after KYB passes to check the beneficial owner name.
export async function screenCarrierAml(entityId: string, fullName: string): Promise<void> {
  const result = await callDiditAml(entityId, fullName);
  await recomputeAndPersist(entityId, { amlStatus: result });
}

// Resolve the natural-person full name to AML-screen for a verification entity:
//   DRIVER         -> the User behind the driver (identity is per-person)
//   OWNER_OPERATOR -> the operator's legal name
//   ORGANIZATION   -> the org legal name. NOTE: this screens the business name
//                     as a person; a future refinement should screen a named
//                     beneficial owner and/or use a business AML endpoint.
// Fetches Users/Orgs via Database.getItem to avoid a circular service import.
export async function resolveScreeningName(
  entityId: string,
  entityType: EntityType,
): Promise<string | null> {
  if (entityType === EntityType.DRIVER) {
    const user = await Database.getItem<{ fullName?: string; firstName?: string; lastName?: string }>(
      config.dynamodb.usersTable, { userId: entityId });
    const name = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    return name || null;
  }
  if (entityType === EntityType.OWNER_OPERATOR) {
    const op = await OwnerOperatorService.getById(entityId);
    return op?.legalName || null;
  }
  if (entityType === EntityType.ORGANIZATION) {
    const org = await Database.getItem<{ legalName?: string }>(
      config.dynamodb.orgsTable, { orgId: entityId });
    return org?.legalName || null;
  }
  return null;
}

// AML screening for ANY entity type (audit v6 M1) - resolves the person name
// then screens + persists amlStatus. Used by the post-KYB/IDV webhook trigger
// and the backfill script. Returns null (no screen run) when no name resolves.
export async function screenEntityAml(
  entityId: string,
  entityType: EntityType,
): Promise<SubStatus | null> {
  const fullName = await resolveScreeningName(entityId, entityType);
  if (!fullName) {
    console.warn('[verification] AML screen skipped - no screening name for', entityType, entityId);
    return null;
  }
  const result = await callDiditAml(entityId, fullName);
  await recomputeAndPersist(entityId, { amlStatus: result });
  return result;
}
