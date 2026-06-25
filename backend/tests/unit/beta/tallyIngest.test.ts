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

/** Build a Tally payload with the AUTHORITATIVE labels from the guide §12. */
function shipperPayload(responseId: string) {
  return {
    eventType: 'FORM_RESPONSE',
    data: {
      responseId,
      formId: 'form-abc',
      formName: 'LoadLead Beta',
      fields: [
        { key: 'q1', label: 'Which best describes you?', type: 'MULTIPLE_CHOICE', value: 'Shipper' },
        { key: 'q2', label: 'Full name', type: 'INPUT_TEXT', value: 'Sandra Shipper' },
        { key: 'q3', label: 'Work email', type: 'INPUT_EMAIL', value: 'Sandra@ShipCo.com' },
        { key: 'q4', label: 'Phone', type: 'INPUT_PHONE_NUMBER', value: '555-1000' },
        { key: 'q5', label: 'Company name', type: 'INPUT_TEXT', value: 'ShipCo' },
        { key: 'q6', label: 'Primary operating region (city, state)', type: 'INPUT_TEXT', value: 'Dallas, TX' },
        { key: 'q7', label: 'Do you primarily operate in Texas?', type: 'MULTIPLE_CHOICE', value: 'Yes, mostly Texas' },
        { key: 'q8', label: 'How many shipments per week?', type: 'MULTIPLE_CHOICE', value: '20-50' },
        { key: 'q9', label: 'What commodities do you ship?', type: 'CHECKBOXES', value: ['Steel', 'Lumber'] },
        { key: 'q10', label: 'Top lanes (origin → destination)', type: 'CHECKBOXES', value: ['Dallas → Houston'] },
        { key: 'q11', label: 'How do you book freight today?', type: 'INPUT_TEXT', value: 'Email + spreadsheets' },
        { key: 'q12', label: 'Biggest pain in booking freight', type: 'TEXTAREA', value: 'Finding reliable carriers' },
        { key: 'q13', label: 'Are you actively running freight right now?', type: 'MULTIPLE_CHOICE', value: 'Yes' },
        { key: 'q14', label: 'Will you join a short feedback call + weekly check-in?', type: 'MULTIPLE_CHOICE', value: 'Yes' },
        { key: 'q15', label: 'Preferred contact method', type: 'MULTIPLE_CHOICE', value: 'Email' },
        { key: 'q16', label: 'source', type: 'HIDDEN_FIELDS', value: 'linkedin' },
      ],
    },
  };
}

function carrierPayload(responseId: string) {
  return {
    eventType: 'FORM_RESPONSE',
    data: {
      responseId,
      formId: 'form-abc',
      fields: [
        { key: 'q1', label: 'Which best describes you?', value: 'Hauler / carrier' },
        { key: 'q2', label: 'Full name', value: 'Carl Carrier' },
        { key: 'q3', label: 'Work email', value: 'carl@HaulCo.com' },
        { key: 'q7', label: 'Do you primarily operate in Texas?', value: 'Partly Texas' },
        { key: 'c1', label: 'MC or DOT number', value: 'MC123456' },
        { key: 'c2', label: 'How many trucks/power units?', value: '8' },
        { key: 'c3', label: 'Loads per week', value: '5-20' },
        { key: 'c4', label: 'Equipment types', value: ['Dry van', 'Reefer'] },
        { key: 'c5', label: 'Top lanes you run (origin → destination)', value: ['Houston → Dallas'] },
        { key: 'c6', label: 'How do you find loads today?', value: 'Load boards' },
        { key: 'c7', label: 'Biggest pain in finding loads', value: 'Empty miles' },
        { key: 'q13', label: 'Are you actively running freight right now?', value: 'Yes' },
        { key: 'q14', label: 'Will you join a short feedback call + weekly check-in?', value: 'Yes' },
      ],
    },
  };
}

/** A "Both" payload — both side blocks present. */
function bothPayload(responseId: string) {
  return {
    eventType: 'FORM_RESPONSE',
    data: {
      responseId,
      formId: 'form-abc',
      fields: [
        { key: 'q1', label: 'Which best describes you?', value: 'Both' },
        { key: 'q2', label: 'Full name', value: 'Bo Both' },
        { key: 'q3', label: 'Work email', value: 'bo@bothco.com' },
        { key: 'q7', label: 'Do you primarily operate in Texas?', value: 'Yes, mostly Texas' },
        { key: 'q8', label: 'How many shipments per week?', value: '20-50' },
        { key: 'q11', label: 'How do you book freight today?', value: 'TMS' },
        { key: 'c1', label: 'MC or DOT number', value: 'DOT9988776' },
        { key: 'c3', label: 'Loads per week', value: '5-20' },
        { key: 'q13', label: 'Are you actively running freight right now?', value: 'Yes' },
        { key: 'q14', label: 'Will you join a short feedback call + weekly check-in?', value: 'Yes' },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Tally ingest — field mapping (authoritative labels)', () => {
  it('maps a SHIPPER submission, sets texasFocus, lowercases email, stores raw band', async () => {
    dbQuery.mockResolvedValue([]);          // no existing app
    dbPut.mockResolvedValue({} as any);

    const { application, created } = await BetaApplicationService.ingestFromTally(
      shipperPayload('resp-1'),
    );

    expect(created).toBe(true);
    expect(application.side).toBe('SHIPPER');
    expect(application.workEmail).toBe('sandra@shipco.com');   // lowercased
    expect(application.company).toBe('ShipCo');
    expect(application.region).toBe('Dallas, TX');
    expect(application.texasFocus).toBe('MOSTLY');             // "Yes, mostly Texas"
    expect(application.sideSpecificData.shipper?.loadsPerWeek).toBe('20-50');  // raw band
    expect(application.sideSpecificData.shipper?.commodities).toEqual(['Steel', 'Lumber']);
    expect(application.source).toBe('linkedin');
    expect(application.status).toBe('QUALIFIED');
    // objective score: volume(2, 20-50→20) + geography(3, MOSTLY) + tools(1)
    expect(application.scoreBreakdown?.geography).toBe(3);
    expect(application.scoreBreakdown?.volume).toBe(2);
    expect(application.scoreBreakdown?.tools).toBe(1);
  });

  it('maps a CARRIER submission ("Hauler / carrier"), texasFocus=PARTLY, parses MC', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);

    const { application } = await BetaApplicationService.ingestFromTally(
      carrierPayload('resp-2'),
    );

    expect(application.side).toBe('CARRIER');
    expect(application.workEmail).toBe('carl@haulco.com');
    expect(application.texasFocus).toBe('PARTLY');            // "Partly Texas"
    expect(application.sideSpecificData.carrier?.mcOrDot).toBe('MC123456');
    expect(application.sideSpecificData.carrier?.truckCount).toBe(8);
    expect(application.status).toBe('QUALIFIED');             // valid MC, committed
    expect(application.scoreBreakdown?.geography).toBe(2);    // PARTLY
  });

  it('maps a BOTH submission — both side blocks present', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);

    const { application } = await BetaApplicationService.ingestFromTally(
      bothPayload('resp-both'),
    );

    expect(application.side).toBe('BOTH');
    expect(application.sideSpecificData.shipper).toBeDefined();
    expect(application.sideSpecificData.carrier).toBeDefined();
    expect(application.sideSpecificData.carrier?.mcOrDot).toBe('DOT9988776');
    expect(application.sideSpecificData.shipper?.loadsPerWeek).toBe('20-50');
    expect(application.texasFocus).toBe('MOSTLY');
    expect(application.status).toBe('QUALIFIED');
  });

  it('rejects a submission missing texasFocus (422, no fabrication)', async () => {
    dbQuery.mockResolvedValue([]);
    const bad = shipperPayload('resp-3');
    bad.data.fields = bad.data.fields.filter(f => f.label !== 'Do you primarily operate in Texas?');

    await expect(BetaApplicationService.ingestFromTally(bad)).rejects.toThrow(/Texas/i);
    expect(dbPut).not.toHaveBeenCalled();
  });
});

describe('Tally auto-gates on ingest', () => {
  it('carrier with no MC/DOT → WAITLISTED + NO_AUTHORITY', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const p = carrierPayload('resp-nomc');
    p.data.fields = p.data.fields.filter(f => f.label !== 'MC or DOT number');

    const { application } = await BetaApplicationService.ingestFromTally(p);
    expect(application.status).toBe('WAITLISTED');
    expect(application.autoFlags).toContain('NO_AUTHORITY');
  });

  it('shipper "Under 5" → WAITLISTED + LOW_VOLUME', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const p = shipperPayload('resp-lowvol');
    p.data.fields = p.data.fields.map(f =>
      f.label === 'How many shipments per week?' ? { ...f, value: 'Under 5' } : f);

    const { application } = await BetaApplicationService.ingestFromTally(p);
    expect(application.status).toBe('WAITLISTED');
    expect(application.autoFlags).toContain('LOW_VOLUME');
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
