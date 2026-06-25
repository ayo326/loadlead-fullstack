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

  // Regression for the prod crash: a multi-select booking-method question
  // arrives as an ARRAY, and toolsScore() / storage must not .trim() it.
  it('tolerates a multi-select (array-valued) bookingMethod without crashing', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const p = shipperPayload('resp-arr-booking');
    p.data.fields = p.data.fields.map(f =>
      f.label === 'How do you book freight today?'
        ? { ...f, value: ['Email', 'Load board', 'Phone'] }   // multi-select → array
        : f);

    const { application } = await BetaApplicationService.ingestFromTally(p);
    expect(application.status).toBe('QUALIFIED');
    // array joined into a single string on the stored model
    expect(application.sideSpecificData.shipper?.bookingMethod).toBe('Email, Load board, Phone');
    // tools score = 1 (a booking method is present)
    expect(application.scoreBreakdown?.tools).toBe(1);
  });

  // Regression: the LIVE Tally form uses different commitment-question
  // wording than the original guess. Both "Yes" answers must bind to
  // realFreight/feedbackCall — otherwise they default false and wrongly
  // fire NO_COMMITMENT → WAITLISTED.
  it('binds the LIVE commitment-question labels (real-freight + feedback-call)', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const p = shipperPayload('resp-live-commit');
    // swap the original commitment labels for the real live ones
    p.data.fields = p.data.fields
      .filter(f =>
        f.label !== 'Are you actively running freight right now?' &&
        f.label !== 'Will you join a short feedback call + weekly check-in?')
      .concat([
        { key: 'cm1', label: 'Can you test LoadLead with real freight over the next few weeks?', value: 'Yes' },
        { key: 'cm2', label: 'Will you commit to one 20-minute feedback call plus a short weekly check-in?', value: 'Yes' },
      ]);

    const { application } = await BetaApplicationService.ingestFromTally(p);
    expect(application.commitment.realFreight).toBe(true);
    expect(application.commitment.feedbackCall).toBe(true);
    // both Yes → NOT flagged, and QUALIFIED (not wrongly WAITLISTED)
    expect(application.autoFlags).not.toContain('NO_COMMITMENT');
    expect(application.status).toBe('QUALIFIED');
  });

  // Regression: bind ALL the real live-form labels (captured from the
  // production form via the label diagnostic). Every shipper field that
  // was silently not-binding (loadsPerWeek/volume, commodities, lanes,
  // pain) must now resolve.
  it('binds the REAL live-form shipper labels (loadsPerWeek/volume, lanes, commodities, pain)', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const payload = {
      eventType: 'FORM_RESPONSE',
      data: {
        responseId: 'resp-real-shipper',
        formId: 'form-abc',
        fields: [
          { key: 'q1', label: 'Which best describes you?', value: 'Shipper' },
          { key: 'q2', label: 'Full name', value: 'Real Shipper' },
          { key: 'q3', label: 'Work email', value: 'real@shipper.com' },
          { key: 'q7', label: 'Do you primarily operate in Texas?', value: 'Yes, mostly Texas' },
          { key: 'q8', label: 'How many shipments do you move per week?', value: '20-50' },
          { key: 'q9', label: 'What do you ship? (commodities or product types)', value: ['Steel'] },
          { key: 'q10', label: 'Primary lanes or regions (Shipper)', value: ['Dallas → Houston'] },
          { key: 'q11', label: 'How do you book freight today?', value: 'Email' },
          { key: 'q12', label: 'Your single biggest pain in moving freight right now', value: 'Capacity' },
          { key: 'q13', label: 'Can you test LoadLead with real freight over the next few weeks?', value: 'Yes' },
          { key: 'q14', label: 'Will you commit to one 20-minute feedback call plus a short weekly check-in?', value: 'Yes' },
          { key: 'q15', label: 'Best way to reach you for onboarding?', value: 'Email' },
        ],
      },
    };

    const { application } = await BetaApplicationService.ingestFromTally(payload);
    const s = application.sideSpecificData.shipper!;
    expect(s.loadsPerWeek).toBe('20-50');               // was undefined (volume=0 bug)
    expect(s.lanes).toEqual(['Dallas → Houston']);
    expect(s.commodities).toEqual(['Steel']);
    expect(s.pain).toBe('Capacity');
    expect(application.commitment.contactPref).toBe('email');
    // volume now scores from the band (20-50 → 2), not 0
    expect(application.scoreBreakdown?.volume).toBe(2);
    expect(application.status).toBe('QUALIFIED');
  });

  it('binds the REAL live-form carrier labels (trucks, loads/week, equipment, lanes, pain)', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const payload = {
      eventType: 'FORM_RESPONSE',
      data: {
        responseId: 'resp-real-carrier',
        fields: [
          { key: 'q1', label: 'Which best describes you?', value: 'Hauler / carrier' },
          { key: 'q2', label: 'Full name', value: 'Real Carrier' },
          { key: 'q3', label: 'Work email', value: 'real@carrier.com' },
          { key: 'q7', label: 'Do you primarily operate in Texas?', value: 'Yes, mostly Texas' },
          { key: 'c1', label: 'MC or DOT number', value: 'MC123456' },
          { key: 'c2', label: 'How many trucks do you run?', value: '8' },
          { key: 'c3', label: 'How many loads do you haul per week?', value: '5-20' },
          { key: 'c4', label: 'What equipment type do you run?', value: ['Reefer', 'Dryvan'] },
          { key: 'c5', label: 'Primary lanes or regions (Carrier)', value: ['Houston → Dallas'] },
          { key: 'c6', label: 'How do you find loads today?', value: 'Load boards' },
          { key: 'c7', label: 'Your single biggest pain in finding good loads right now', value: 'Empty miles' },
          { key: 'q13', label: 'Can you test LoadLead with real freight over the next few weeks?', value: 'Yes' },
          { key: 'q14', label: 'Will you commit to one 20-minute feedback call plus a short weekly check-in?', value: 'Yes' },
        ],
      },
    };

    const { application } = await BetaApplicationService.ingestFromTally(payload);
    const c = application.sideSpecificData.carrier!;
    expect(c.truckCount).toBe(8);
    expect(c.loadsPerWeek).toBe('5-20');
    expect(c.equipment).toEqual(['Reefer', 'Dryvan']);
    expect(c.lanes).toEqual(['Houston → Dallas']);
    expect(c.pain).toBe('Empty miles');
    expect(application.status).toBe('QUALIFIED');       // valid MC, committed
  });

  // The keyword fallback must bind even a reworded commitment question.
  it('keyword fallback binds a reworded real-freight question', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const p = shipperPayload('resp-kw');
    p.data.fields = p.data.fields
      .filter(f => f.label !== 'Are you actively running freight right now?')
      .concat([{ key: 'kw1', label: 'Could you move some real freight with us soon?', value: 'Yes' }]);

    const { application } = await BetaApplicationService.ingestFromTally(p);
    expect(application.commitment.realFreight).toBe(true);   // matched "real freight"
  });

  // Tally single-select Yes/No can also arrive as a one-element array.
  it('tolerates an array-valued Yes/No commitment answer', async () => {
    dbQuery.mockResolvedValue([]);
    dbPut.mockResolvedValue({} as any);
    const p = shipperPayload('resp-arr-yesno');
    p.data.fields = p.data.fields.map(f =>
      f.label === 'Are you actively running freight right now?'
        ? { ...f, value: ['Yes'] }
        : f);

    const { application } = await BetaApplicationService.ingestFromTally(p);
    // realFreight reads true from ["Yes"] → not flagged NO_COMMITMENT
    expect(application.autoFlags).not.toContain('NO_COMMITMENT');
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
