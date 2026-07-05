// LoadLead - Per-load integrated factoring opt-in
// LoadLead is data-only: funds never route through the platform.
// The factor receives a data payload (load, BOL, POD evidence) and disburses
// directly to the carrier. LoadLead stores an immutable consent record.
//
// BYO factoring uses factoringProfile.ts - invoice packets are generated
// separately and the POD gate must be called before release.

import { v4 as uuidv4 } from 'uuid';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
import { AppError } from '../middleware/errorHandler';
import { assertPodComplete } from './pod';
import { getFactoringProfile } from './factoringProfile';
import { LoadService } from './loadService';
import { BOLService } from './bolService';
import { DriverService } from './driverService';
import { resolveCarrierOfRecord } from './carrierOfRecord';
import { CarrierOfRecord } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface FactoringOptIn {
  optInId:     string;   // PK
  loadId:      string;
  carrierId:   string;
  partnerId:   string;
  status:      'PENDING' | 'SUBMITTED' | 'FUNDED' | 'REJECTED';
  consentAt:   string;   // ISO - immutable, captured at opt-in
  termsVersion: string;
  debtorAmlStatus: 'pending' | 'pass' | 'fail';
  submittedAt?: string;
  updatedAt:   string;
}

const TABLE       = process.env.DYNAMODB_FACTORING_OPTINS_TABLE || 'LoadLead_FactoringOptIns';
const LOAD_INDEX  = 'loadId-index';
const TERMS_VER   = '2026-06-15-v1'; // bump when terms change

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export async function getOptIn(optInId: string): Promise<FactoringOptIn | null> {
  const res = await docClient.send(new GetCommand({ TableName: TABLE, Key: { optInId } }));
  return (res.Item as FactoringOptIn) ?? null;
}

export async function getOptInByLoad(loadId: string): Promise<FactoringOptIn | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: LOAD_INDEX,
      KeyConditionExpression: 'loadId = :l',
      ExpressionAttributeValues: { ':l': loadId },
      Limit: 1,
    }),
  );
  return (res.Items?.[0] as FactoringOptIn) ?? null;
}

// Screen the debtor (shipper/load originator) for AML/sanctions.
// STUB: auto-passes until DIDIT_API_KEY is set.
async function screenDebtorAml(shipperId: string): Promise<'pass' | 'fail'> {
  if (!process.env.DIDIT_API_KEY) {
    console.warn(`[factoring] DIDIT_API_KEY not set - stubbing debtor AML as PASS for ${shipperId}`);
    return 'pass';
  }
  // TODO: call Didit AML endpoint for shipperId; return 'pass' | 'fail'
  return 'pass';
}

// Opt a load into integrated factoring.
// Gate order: (1) carrier verified + integrated mode active, (2) POD complete,
// (3) debtor AML clear, (4) consent record written, (5) data-only handoff.
export async function optInToFactoring(
  loadId: string,
  carrierId: string,
): Promise<FactoringOptIn> {
  // 1. Carrier must have an active integrated partner.
  const fpProfile = await getFactoringProfile(carrierId);
  if (fpProfile?.mode !== 'INTEGRATED' || !fpProfile.integratedPartnerId) {
    throw new AppError(
      'Select an integrated factoring partner before opting in.',
      400,
    );
  }
  const partnerId = fpProfile.integratedPartnerId;

  // 2. POD must be complete - throws 400 with detail if not.
  await assertPodComplete(loadId);

  // 3. Screen the debtor for AML/sanctions.
  const load = await LoadService.getLoadById(loadId);
  if (!load) throw new AppError(`Load ${loadId} not found`, 404);

  const debtorAmlStatus = await screenDebtorAml(load.shipperId);
  if (debtorAmlStatus === 'fail') {
    throw new AppError('Debtor failed AML/sanctions screening - factoring cannot proceed.', 400);
  }

  // 4. Write immutable consent record.
  const optIn: FactoringOptIn = {
    optInId:         uuidv4(),
    loadId,
    carrierId,
    partnerId,
    status:          'PENDING',
    consentAt:       new Date().toISOString(),
    termsVersion:    TERMS_VER,
    debtorAmlStatus: 'pass',
    updatedAt:       new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE, Item: optIn }));

  // 5. Data-only handoff to integrated partner.
  await handOffToPartner(optIn, load);

  // Mark submitted.
  const submitted: FactoringOptIn = {
    ...optIn,
    status:      'SUBMITTED',
    submittedAt: new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE, Item: submitted }));

  return submitted;
}

// Build and transmit the data payload to the integrated partner.
// STUB: logs the payload until a real partner integration is configured.
async function handOffToPartner(optIn: FactoringOptIn, load: any): Promise<void> {
  const bol = await BOLService.getBOLByLoadId(optIn.loadId);

  const payload = {
    optInId:      optIn.optInId,
    consentAt:    optIn.consentAt,
    termsVersion: optIn.termsVersion,
    load: {
      loadId:           load.loadId,
      referenceNumber:  load.referenceNumber,
      rateAmount:       load.rateAmount,
      rateType:         load.rateType,
      pickupDate:       load.pickupDate,
      deliveryDate:     load.deliveryDate,
      origin:           `${load.pickupCity}, ${load.pickupState}`,
      destination:      `${load.deliveryCity}, ${load.deliveryState}`,
      totalMiles:       load.totalMiles,
    },
    bol: bol ? {
      bolNumber:          bol.bolNumber,
      signedAt:           bol.consigneeSignature?.signedAt,
      podPhotoCount:      bol.podPhotos?.length ?? 0,
    } : null,
    // Funds never route through LoadLead - the partner disburses directly.
  };

  console.info(`[factoring] handoff to partner ${optIn.partnerId}:`, JSON.stringify(payload));
  // TODO: POST payload to partner API endpoint when integration is configured
}

// Decide who receives the invoice payment for a given load.
// Returns 'FACTOR' if an integrated opt-in is active, otherwise 'CARRIER' -
// resolved via carrierOfRecord.ts (the OO or Carrier org governing the load's
// assigned driver) so callers know which entity to actually pay.
export async function resolveInvoicePayee(
  loadId: string,
): Promise<{ payee: 'FACTOR' | 'CARRIER'; optIn?: FactoringOptIn; carrier?: CarrierOfRecord }> {
  const optIn = await getOptInByLoad(loadId);
  if (optIn && optIn.status === 'SUBMITTED') {
    return { payee: 'FACTOR', optIn };
  }

  const load = await LoadService.getLoadById(loadId);
  const driver = load?.assignedDriverId ? await DriverService.getProfileById(load.assignedDriverId) : null;
  const carrier = driver ? await resolveCarrierOfRecord(driver) : null;

  return { payee: 'CARRIER', ...(carrier && { carrier }) };
}
