/**
 * Part B — Tally webhook ingest + idempotency + signature.
 *
 * Proves the TASK acceptance bullets:
 *   - A Tally submission creates a BetaApplication (shipper + carrier
 *     branches both mapped, texasFocus set)
 *   - A duplicate (same responseId) does not double-create
 *   - Signature verification (HMAC) accepts a correctly-signed body and
 *     rejects a tampered one
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../../../src/config/database', () => ({
  Database: {
    query: vi.fn(),
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    scan: vi.fn(),
  },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Database } from '../../../src/config/database';
import { BetaApplicationService } from '../../../src/services/betaApplicationService';
import { verifyTallySignature } from '../../../src/services/tallySignature';

const dbQuery = vi.mocked(Database.query);
const dbPut = vi.mocked(Database.putItem);

/** Build a Tally payload with the exact labels from the guide. */
function shipperPayload(responseId: string) {
  return {
    formId: 'form-abc',
    data: {
      responseId,
      fields: [
        { label: 'Which side are you?', value: 'Shipper' },
        { label: 'Full name', value: 'Sandra Shipper' },
        { label: 'Work email', value: 'Sandra@ShipCo.com' },
        { label: 'Phone', value: '555-1000' },
        { label: 'Company', value: 'ShipCo' },
        { label: 'Region', value: 'DFW' },
        { label: 'Do you primarily operate in Texas?', value: 'Mostly' },
        { label: 'How many shipments per week?', value: '20' },
        { label: 'What do you ship?', value: ['Steel', 'Lumber'] },
        { label: 'Top 3 lanes', value: ['Dallas → Houston'] },
        { label: 'How do you book today?', value: 'Email + spreadsheets' },
        { label: 'Biggest pain in booking', value: 'Finding reliable carriers' },
        { label: 'Are you running freight right now?', value: 'Yes' },
        { label: 'Will you take a 15-min feedback call and a weekly check-in?', value: 'Yes' },
        { label: 'Preferred contact', value: 'Email' },
        { label: 'source', value: 'linkedin' },
      ],
    },
  };
}

function carrierPayload(responseId: string) {
  return {
    formId: 'form-abc',
    data: {
      responseId,
      fields: [
        { label: 'Which side are you?', value: 'Carrier' },
        { label: 'Full name', value: 'Carl Carrier' },
        { label: 'Work email', value: 'carl@HaulCo.com' },
        { label: 'Do you primarily operate in Texas?', value: 'Partly' },
        { label: 'MC or DOT number', value: 'MC123456' },
        { label: 'How many trucks?', value: '8' },
        { label: 'Loads per week', value: '15' },
        { label: 'Equipment', value: ['Dry van', 'Reefer'] },
        { label: 'Top 3 lanes you serve', value: ['Houston → Dallas'] },
        { label: 'How do you find loads today?', value: 'Load boards' },
        { label: 'Biggest pain in finding loads', value: 'Empty miles' },
        { label: 'Are you running freight right now?', value: 'Yes' },
        { label: 'Will you take a 15-min feedback call and a weekly check-in?', value: 'Yes' },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Tally ingest — field mapping', () => {
  it('maps a SHIPPER submission, sets texasFocus, lowercases email', async () => {
    dbQuery.mockResolvedValue([]);          // no existing app
    dbPut.mockResolvedValue({} as any);

    const { application, created } = await BetaApplicationService.ingestFromTally(
      shipperPayload('resp-1'),
    );

    expect(created).toBe(true);
    expect(application.side).toBe('SHIPPER');
    expect(application.workEmail).toBe('sandra@shipco.com');   // lowercased
    expect(application.texasFocus).toBe('MOSTLY');
    expect(application.sideSpecificData.shipper?.loadsPerWeek).toBe(20);
    expect(application.sideSpecificData.shipper?.commodities).toEqual(['Steel', 'Lumber']);
    expect(application.source).toBe('linkedin');
    // qualifies (20/wk, running freight, will commit) → QUALIFIED
    expect(application.status).toBe('QUALIFIED');
    // objective score: volume(2) + geography(3) + tools(1) = 6 base
    expect(application.scoreBreakdown?.geography).toBe(3);
    expect(application.scoreBreakdown?.volume).toBe(2);
    expect(application.scoreBreakdown?.tools).toBe(1);
  });

  it('maps a CARRIER submission, sets texasFocus=PARTLY, parses MC', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);

    const { application } = await BetaApplicationService.ingestFromTally(
      carrierPayload('resp-2'),
    );

    expect(application.side).toBe('CARRIER');
    expect(application.workEmail).toBe('carl@haulco.com');
    expect(application.texasFocus).toBe('PARTLY');
    expect(application.sideSpecificData.carrier?.mcOrDot).toBe('MC123456');
    expect(application.sideSpecificData.carrier?.truckCount).toBe(8);
    expect(application.status).toBe('QUALIFIED');   // valid MC, committed
    expect(application.scoreBreakdown?.geography).toBe(2);  // PARTLY
  });

  it('rejects a submission missing texasFocus (422, no fabrication)', async () => {
    dbQuery.mockResolvedValue([]);
    const bad = shipperPayload('resp-3');
    bad.data.fields = bad.data.fields.filter(f => f.label !== 'Do you primarily operate in Texas?');

    await expect(BetaApplicationService.ingestFromTally(bad)).rejects.toThrow(/Texas/i);
    expect(dbPut).not.toHaveBeenCalled();
  });
});

describe('Tally ingest — idempotency', () => {
  it('a duplicate responseId returns the existing app without re-creating', async () => {
    const existing = { applicationId: 'bapp-existing', responseId: 'resp-dup', status: 'QUALIFIED' };
    dbQuery.mockResolvedValue([existing as any]);   // getByResponseId hit

    const { application, created } = await BetaApplicationService.ingestFromTally(
      shipperPayload('resp-dup'),
    );

    expect(created).toBe(false);
    expect(application.applicationId).toBe('bapp-existing');
    expect(dbPut).not.toHaveBeenCalled();           // no second write
  });
});

describe('Tally signature verification', () => {
  const secret = 'tly_test_secret_123';

  function sign(body: string): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  }

  it('accepts a correctly-signed body', () => {
    const body = JSON.stringify({ hello: 'world' });
    const r = verifyTallySignature({
      rawBody: body,
      headers: { 'tally-signature': sign(body) },
      secret,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ hello: 'world' });
    const r = verifyTallySignature({
      rawBody: body + 'tampered',
      headers: { 'tally-signature': sign(body) },
      secret,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-signature');
  });

  it('rejects when the secret is missing (fail closed)', () => {
    const r = verifyTallySignature({
      rawBody: '{}',
      headers: { 'tally-signature': 'whatever' },
      secret: undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-secret');
  });

  it('rejects when the signature header is absent', () => {
    const r = verifyTallySignature({ rawBody: '{}', headers: {}, secret });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-header');
  });
});
