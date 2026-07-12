/**
 * Canopy Connect (SCRUM-60) - the sandbox definition-of-done suite.
 *
 * Drives the documented sandbox usernames through the whole pipeline offline
 * (fixture-mode client, in-memory Database): mapping in integer cents, the
 * verification decision (insurer + FMCSA), the COI cross-reference engine
 * (ALIGNED / MINOR / CRITICAL), monitoring status flips, shadow-mode evaluator
 * divergence, idempotent replays, and mode-invariant artifacts. Nothing here
 * touches the Load model; every comparison/flag/event is append-only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, updateItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (t: string, item: any) => {
      (tables[t] ??= []).push(item);
    }),
    getItem: vi.fn(async (t: string, key: any) => {
      const [k, v] = Object.entries(key)[0] as [string, any];
      return (tables[t] ?? []).find((r) => r[k] === v) ?? null;
    }),
    updateItem: vi.fn(async (t: string, key: any, patch: any) => {
      const [k, v] = Object.entries(key)[0] as [string, any];
      const row = (tables[t] ?? []).find((r) => r[k] === v);
      if (row) Object.assign(row, patch);
      return {};
    }),
    scan: vi.fn(async (t: string) => [...(tables[t] ?? [])]),
  };
});
vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, updateItem, scan },
  default: { putItem, getItem, updateItem, scan },
}));
vi.mock('../../../src/utils/logger', () => ({
  Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
const { putObject, signedGetUrl } = vi.hoisted(() => ({
  putObject: vi.fn(async (k: string) => k),
  signedGetUrl: vi.fn(async (k: string) => `https://signed/${k}`),
}));
vi.mock('../../../src/services/compliance/complianceStorage', () => ({ putObject, signedGetUrl, SIGNED_URL_TTL: 300 }));

const { getInsuranceFilings } = vi.hoisted(() => ({ getInsuranceFilings: vi.fn() }));
vi.mock('../../../src/services/integrations/fmcsaInsurance', () => ({ getInsuranceFilings }));

const { ooGetById, ooGetByUserId } = vi.hoisted(() => ({ ooGetById: vi.fn(), ooGetByUserId: vi.fn() }));
vi.mock('../../../src/services/ownerOperatorService', () => ({
  OwnerOperatorService: { getById: ooGetById, getByUserId: ooGetByUserId },
}));

import config from '../../../src/config/environment';
import { ComplianceDocumentService } from '../../../src/services/complianceDocumentService';
import { buildSandboxPull, sandboxMetadata } from '../../../src/services/canopy/sandboxFixtures';
import { mapPullToInsuranceData } from '../../../src/services/canopy/canopyMapper';
import { registerFixturePull, resetFixtures } from '../../../src/services/canopy/canopyClient';
import { issueNonce, verifyNonce } from '../../../src/services/canopy/canopyNonce';
import { ingestPull } from '../../../src/services/canopy/canopyIngestionService';
import { CanopyConnectionStore } from '../../../src/services/canopy/canopyConnectionStore';
import { runCrossReferenceForCarrier, resolveCrossReferenceCritical, compareCoiToInsurer, insurerNamesMatch, policyNumbersMatch } from '../../../src/services/canopy/crossReferenceEngine';
import { insuranceBadge } from '../../../src/services/canopy/insuranceBadge';
import { ingestMonitoringPull } from '../../../src/services/canopy/canopyMonitoringService';
import { evaluateForDecision } from '../../../src/services/canopy/complianceEvaluator';
import { verifyCanopySignature } from '../../../src/services/canopy/canopySignature';
import { createHmac } from 'node:crypto';

const EVENTS = config.dynamodb.complianceVerificationEventsTable;
const TRUST = config.dynamodb.betaTrustEventsTable;
const NOW = 1_700_000_000_000;

function eventsFor(documentId: string): string[] {
  return (tables[EVENTS] ?? []).filter((e) => e.documentId === documentId).map((e) => e.event);
}

async function currentInsurerDoc(carrierId: string) {
  return ComplianceDocumentService.getCurrent('HAULER', carrierId, 'INSURER_POLICY');
}

/** Seed a fixture pull for a carrier + register it; returns the pull id. */
function seedPull(username: string, carrierId: string, opts?: { variant?: 'initial' | 'monitored'; parentPullId?: string; pullId?: string }) {
  const pullId = opts?.pullId ?? `pull_${username}_${carrierId}`;
  // Nonce uses the real clock (ingestion verifies against Date.now()); policy
  // dates use the fixed NOW epoch, which is independent of nonce validity.
  const metaData = sandboxMetadata({ carrierId, nonce: issueNonce(carrierId), source: 'widget' });
  const pull = buildSandboxPull(username, { pullId, metaData, nowMs: NOW, variant: opts?.variant, parentPullId: opts?.parentPullId });
  registerFixturePull(pull);
  return { pullId, pull };
}

/** Create a COI document with the given fields for cross-reference tests. */
async function seedCoi(carrierId: string, fields: Record<string, unknown>) {
  return ComplianceDocumentService.createDocument({
    ownerType: 'HAULER',
    ownerId: carrierId,
    documentType: 'COI',
    s3Key: `coi/${carrierId}.pdf`,
    originalFilename: 'coi.pdf',
    contentHash: 'hash',
    uploadedBy: 'user',
    initialStatus: 'PENDING',
    meta: fields,
  });
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  [putItem, getItem, updateItem, scan, putObject, signedGetUrl, getInsuranceFilings, ooGetById, ooGetByUserId].forEach((m) => m.mockClear());
  resetFixtures();
  process.env.COMPLIANCE_EVALUATOR = 'local';
  // FMCSA corroborates by default: active, matching insurer, above minimum.
  getInsuranceFilings.mockResolvedValue({ hasActiveInsurance: true, insurerNames: ['PROGRESSIVE'], bipdOnFileDollars: 1_000_000 });
  ooGetById.mockImplementation(async (id: string) => ({ operatorId: id, userId: `user_${id}`, dotNumber: '999000001', fleetDriverIds: [] }));
  ooGetByUserId.mockImplementation(async (userId: string) => ({ operatorId: userId.replace(/^user_/, ''), userId, dotNumber: '999000001' }));
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('nonce', () => {
  it('round-trips and rejects a wrong carrier', () => {
    const n = issueNonce('oo_1', NOW);
    expect(verifyNonce(n, 'oo_1', NOW)).toBe(true);
    expect(verifyNonce(n, 'oo_2', NOW)).toBe(false);
    expect(verifyNonce(n, 'oo_1', NOW + 2 * 60 * 60 * 1000)).toBe(false); // expired
  });
});

describe('webhook signature', () => {
  it('accepts a valid HMAC-SHA256 hex signature and rejects a bad one', () => {
    const body = '{"pull_id":"p1"}';
    const secret = 's3cr3t';
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyCanopySignature({ rawBody: body, headers: { 'x-canopy-signature': sig }, secret }).ok).toBe(true);
    expect(verifyCanopySignature({ rawBody: body, headers: { 'x-canopy-signature': 'deadbeef' }, secret }).ok).toBe(false);
    expect(verifyCanopySignature({ rawBody: body, headers: {}, secret }).reason).toBe('no_signature_header');
  });
});

describe('mapper', () => {
  it('maps commercial auto + inland marine cargo to integer cents', () => {
    const { pull } = seedPull('user_good_transportation', 'oo_map');
    const d = mapPullToInsuranceData(pull);
    expect(d.autoLiabilityCents).toBe(100_000_000);
    expect(d.cargoCents).toBe(10_000_000);
    expect(Number.isInteger(d.autoLiabilityCents!)).toBe(true);
    expect(Number.isInteger(d.cargoCents!)).toBe(true);
    expect(d.hasCommercialAuto).toBe(true);
    expect(d.hasCargo).toBe(true);
  });
});

describe('cross-reference comparison (pure)', () => {
  const insurer = {
    source: 'CANOPY' as const, pullId: 'p', insurerName: 'Progressive County Mutual Ins Co',
    autoPolicyNumber: 'CA-88213', cargoPolicyNumber: 'IM-4471', autoLiabilityCents: 100_000_000, cargoCents: 10_000_000,
    effectiveDate: NOW - 30 * 86400000, expiryDate: NOW + 335 * 86400000,
    insurance: { hasCargo: true, autoStatus: 'ACTIVE', hasCommercialAuto: true, policies: [] } as any,
  };
  it('legal-name-tolerant insurer match and normalized policy match', () => {
    expect(insurerNamesMatch('Progressive County Mutual Ins Co', 'Progressive Commercial')).toBe(true);
    expect(insurerNamesMatch('Progressive', 'Geico')).toBe(false);
    expect(policyNumbersMatch('CA 88213', 'CA-88213')).toBe(true);
  });
  it('ALIGNED when the COI matches the insurer', () => {
    const coi = { insurerName: 'Progressive Commercial', policyNumber: 'CA-88213', autoLiabilityCents: 100_000_000, cargoCents: 10_000_000, effectiveDate: insurer.effectiveDate, expiryDate: insurer.expiryDate };
    expect(compareCoiToInsurer(coi as any, insurer, NOW).alignment).toBe('ALIGNED');
  });
  it('CRITICAL on a policy-number mismatch and on an overstated limit', () => {
    const badNumber = { insurerName: 'Progressive', policyNumber: 'WRONG-1', autoLiabilityCents: 100_000_000, effectiveDate: insurer.effectiveDate, expiryDate: insurer.expiryDate };
    expect(compareCoiToInsurer(badNumber as any, insurer, NOW).alignment).toBe('CRITICAL_DISCREPANCY');
    const overstated = { insurerName: 'Progressive', policyNumber: 'CA-88213', autoLiabilityCents: 200_000_000, effectiveDate: insurer.effectiveDate, expiryDate: insurer.expiryDate };
    expect(compareCoiToInsurer(overstated as any, insurer, NOW).alignment).toBe('CRITICAL_DISCREPANCY');
  });
  it('MINOR on an understated limit', () => {
    const understated = { insurerName: 'Progressive', policyNumber: 'CA-88213', autoLiabilityCents: 90_000_000, cargoCents: 10_000_000, effectiveDate: insurer.effectiveDate, expiryDate: insurer.expiryDate };
    expect(compareCoiToInsurer(understated as any, insurer, NOW).alignment).toBe('MINOR_DISCREPANCY');
  });
});

// ── Ingestion ────────────────────────────────────────────────────────────────

describe('ingestion', () => {
  it('user_good_transportation auto-verifies with FMCSA recorded, in integer cents', async () => {
    const { pullId } = seedPull('user_good_transportation', 'oo_t');
    const res = await ingestPull({ pullId, source: 'widget' });
    expect(res.outcome).toBe('VERIFIED');
    const conn = await CanopyConnectionStore.currentForCarrier('oo_t');
    expect(conn?.status).toBe('CONNECTED');
    expect(conn?.sourceMode).toBe('widget');
    const doc = await currentInsurerDoc('oo_t');
    expect(doc?.verificationStatus).toBe('VERIFIED');
    expect((doc?.meta as any).autoLiabilityCents).toBe(100_000_000);
    const evts = eventsFor(doc!.documentId);
    expect(evts).toContain('SUBMITTED');
    expect(evts).toContain('AUTO_CHECK_PASSED');
    expect(evts).toContain('VERIFIED');
  });

  it('produces mode-invariant insurer artifacts for widget vs components', async () => {
    const a = seedPull('user_good_transportation', 'oo_w');
    await ingestPull({ pullId: a.pullId, source: 'widget' });
    // components pull: identical data, different carrier + source.
    const meta = sandboxMetadata({ carrierId: 'oo_c', nonce: issueNonce('oo_c'), source: 'components' });
    const cPull = buildSandboxPull('user_good_transportation', { pullId: 'pull_c', metaData: meta, nowMs: NOW });
    registerFixturePull(cPull);
    await ingestPull({ pullId: 'pull_c', source: 'components' });

    const w = (await currentInsurerDoc('oo_w'))!.meta as any;
    const c = (await currentInsurerDoc('oo_c'))!.meta as any;
    expect(c.insurance).toEqual(w.insurance); // byte-equivalent mapped artifact
    expect((await currentInsurerDoc('oo_c'))!.verificationStatus).toBe('VERIFIED');
  });

  it('user_good_auto_noncompliant holds PENDING (below the minimum)', async () => {
    const { pullId } = seedPull('user_good_auto_noncompliant', 'oo_nc');
    const res = await ingestPull({ pullId, source: 'widget' });
    expect(res.outcome).toBe('PENDING');
    expect((await currentInsurerDoc('oo_nc'))!.verificationStatus).toBe('PENDING');
  });

  it('user_locked routes to fallback with the insurer login error', async () => {
    const { pullId } = seedPull('user_locked', 'oo_lk');
    const res = await ingestPull({ pullId, source: 'widget' });
    expect(res.outcome).toBe('NEEDS_FALLBACK');
    expect(res.reason).toBe('NOT_AUTHENTICATED');
    expect(res.loginErrorMessage).toMatch(/locked/i);
    expect((await CanopyConnectionStore.currentForCarrier('oo_lk'))?.status).toBe('FAILED');
  });

  it('user_provider_error and user_internal_error route to fallback', async () => {
    const p = seedPull('user_provider_error', 'oo_pe');
    expect((await ingestPull({ pullId: p.pullId, source: 'widget' })).reason).toBe('PROVIDER_ERROR');
    const i = seedPull('user_internal_error', 'oo_ie');
    expect((await ingestPull({ pullId: i.pullId, source: 'widget' })).reason).toBe('INTERNAL_ERROR');
  });

  it('is idempotent: a replayed pull writes nothing twice', async () => {
    const { pullId } = seedPull('user_good_transportation', 'oo_idem');
    await ingestPull({ pullId, source: 'widget' });
    const before = (tables[config.dynamodb.carrierInsuranceConnectionsTable] ?? []).length;
    const res2 = await ingestPull({ pullId, source: 'widget' });
    expect(res2.alreadyProcessed).toBe(true);
    expect((tables[config.dynamodb.carrierInsuranceConnectionsTable] ?? []).length).toBe(before);
  });
});

// ── Cross-reference engine ────────────────────────────────────────────────────

describe('cross-reference engine', () => {
  async function connect(carrierId: string) {
    const { pullId } = seedPull('user_good_transportation', carrierId);
    await ingestPull({ pullId, source: 'widget' });
  }

  it('ALIGNED earns the "COI cross-referenced" badge', async () => {
    await connect('oo_al');
    await seedCoi('oo_al', { insurerName: 'Progressive Commercial', policyNumber: 'CA-88213', autoLiabilityCents: 100_000_000, cargoCents: 10_000_000, effectiveDate: NOW - 30 * 86400000, expiryDate: NOW + 335 * 86400000 });
    const result = await runCrossReferenceForCarrier('oo_al', NOW);
    expect(result?.alignment).toBe('ALIGNED');
    const badge = await insuranceBadge('oo_al');
    expect(badge.labels).toContain('COI cross-referenced');
  });

  it('CRITICAL holds the record, raises a trust event, and admin ACCEPT_INSURER re-verifies', async () => {
    await connect('oo_cr');
    expect((await currentInsurerDoc('oo_cr'))!.verificationStatus).toBe('VERIFIED');
    await seedCoi('oo_cr', { insurerName: 'Progressive Commercial', policyNumber: 'FORGED-9', autoLiabilityCents: 100_000_000, effectiveDate: NOW - 30 * 86400000, expiryDate: NOW + 335 * 86400000 });
    const result = await runCrossReferenceForCarrier('oo_cr', NOW);
    expect(result?.alignment).toBe('CRITICAL_DISCREPANCY');

    // Trust event raised, referencing the cross-reference result.
    const trust = (tables[TRUST] ?? []).filter((e) => e.eventType === 'COI_DISCREPANCY');
    expect(trust.length).toBe(1);
    expect(trust[0].crossReferenceResultId).toBe(result!.resultId);

    const doc = await currentInsurerDoc('oo_cr');
    expect(eventsFor(doc!.documentId)).toContain('CROSS_REFERENCE_FLAGGED');
    expect(doc!.verificationStatus).toBe('PENDING'); // held by the unresolved CRITICAL

    await resolveCrossReferenceCritical('oo_cr', 'admin_1', 'ACCEPT_INSURER');
    expect((await currentInsurerDoc('oo_cr'))!.verificationStatus).toBe('VERIFIED');
    expect(eventsFor((await currentInsurerDoc('oo_cr'))!.documentId)).toContain('CROSS_REFERENCE_RESOLVED');
  });

  it('MINOR nudges a re-upload and does not block verification', async () => {
    await connect('oo_mn');
    await seedCoi('oo_mn', { insurerName: 'Progressive Commercial', policyNumber: 'CA-88213', autoLiabilityCents: 90_000_000, cargoCents: 10_000_000, effectiveDate: NOW - 30 * 86400000, expiryDate: NOW + 335 * 86400000 });
    const result = await runCrossReferenceForCarrier('oo_mn', NOW);
    expect(result?.alignment).toBe('MINOR_DISCREPANCY');
    // Not blocked: the insurer policy stays VERIFIED.
    expect((await currentInsurerDoc('oo_mn'))!.verificationStatus).toBe('VERIFIED');
  });

  it('re-running writes a NEW append-only result row', async () => {
    await connect('oo_rr');
    await seedCoi('oo_rr', { insurerName: 'Progressive Commercial', policyNumber: 'CA-88213', autoLiabilityCents: 100_000_000, cargoCents: 10_000_000, effectiveDate: NOW - 30 * 86400000, expiryDate: NOW + 335 * 86400000 });
    await runCrossReferenceForCarrier('oo_rr', NOW);
    await runCrossReferenceForCarrier('oo_rr', NOW + 1000);
    expect((tables[config.dynamodb.coiCrossReferenceResultsTable] ?? []).filter((r) => r.carrierId === 'oo_rr').length).toBe(2);
  });
});

// ── Monitoring ────────────────────────────────────────────────────────────────

describe('monitoring', () => {
  it('user_good_diffs monitored flips the record to EXPIRED and is idempotent on replay', async () => {
    // Initial connect.
    const init = seedPull('user_good_diffs', 'oo_mon', { pullId: 'pull_init', variant: 'initial' });
    await ingestPull({ pullId: init.pullId, source: 'widget' });
    expect((await currentInsurerDoc('oo_mon'))!.verificationStatus).toBe('VERIFIED');

    // Monitoring re-pull: cancelled auto policy (fatal).
    const monMeta = sandboxMetadata({ carrierId: 'oo_mon', nonce: issueNonce('oo_mon'), source: 'widget' });
    const monPull = buildSandboxPull('user_good_diffs', { pullId: 'pull_mon', metaData: monMeta, nowMs: NOW, variant: 'monitored', parentPullId: 'pull_init' });
    registerFixturePull(monPull);

    const r1 = await ingestMonitoringPull('pull_mon');
    expect(r1.status).toBe('EXPIRED');
    expect((await currentInsurerDoc('oo_mon'))!.verificationStatus).toBe('EXPIRED');

    const before = (tables[config.dynamodb.carrierInsuranceConnectionsTable] ?? []).length;
    const r2 = await ingestMonitoringPull('pull_mon');
    expect(r2.alreadyProcessed).toBe(true);
    expect((tables[config.dynamodb.carrierInsuranceConnectionsTable] ?? []).length).toBe(before);
  });
});

// ── Shadow-mode evaluator ─────────────────────────────────────────────────────

describe('shadow evaluator', () => {
  it('logs a divergence when policy check disagrees with the local table, decider stays local', async () => {
    process.env.COMPLIANCE_EVALUATOR = 'shadow';
    // Below-minimum limits (local FAIL) but policy_check COMPLIANT (policy_check PASS).
    const { pull } = seedPull('user_good_auto_noncompliant', 'oo_shadow');
    pull.policy_check_status = 'COMPLIANT';
    const data = mapPullToInsuranceData(pull);
    const doc = await ComplianceDocumentService.createDocument({
      ownerType: 'HAULER', ownerId: 'oo_shadow', documentType: 'INSURER_POLICY', s3Key: 'k', originalFilename: 'f', contentHash: 'h', uploadedBy: 'canopy', initialStatus: 'PENDING', meta: { insurance: data },
    });
    const decision = await evaluateForDecision(data, pull, doc.documentId);
    expect(decision.mode).toBe('shadow');
    expect(decision.diverged).toBe(true);
    expect(decision.deciding.evaluator).toBe('local'); // local decides
    expect(decision.deciding.pass).toBe(false);
    expect(eventsFor(doc.documentId)).toContain('EVALUATOR_DIVERGENCE');
  });

  it('logs no divergence when both agree on a compliant pull', async () => {
    process.env.COMPLIANCE_EVALUATOR = 'shadow';
    const { pull } = seedPull('user_good_auto_compliant', 'oo_shadow2');
    pull.policy_check_status = 'COMPLIANT';
    const data = mapPullToInsuranceData(pull);
    const decision = await evaluateForDecision(data, pull, undefined);
    expect(decision.diverged).toBe(false);
    expect(decision.deciding.pass).toBe(true);
  });
});
