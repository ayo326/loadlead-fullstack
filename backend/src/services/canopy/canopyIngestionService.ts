/**
 * Canopy pull ingestion (SCRUM-60), shared by every connect mode.
 *
 * Widget, Components, and agent-channel pulls all land here and produce
 * BYTE-EQUIVALENT backend artifacts: the same connection row, the same
 * INSURER_POLICY compliance document with source CANOPY, the same mapped
 * structured fields. The pipeline cannot tell the modes apart.
 *
 * Flow: retrieve the pull by id (the authoritative read, so a forged webhook
 * cannot inject state), resolve the carrier from pull metadata, validate the
 * signed nonce, then branch on pull status. On a successful commercial pull we
 * persist the connection, create the INSURER_POLICY document (SUBMITTED, source
 * CANOPY), and run the verification decision. Failures and no-commercial-policy
 * pulls route to the manual fallback with a reason. Idempotent: a pull already
 * ingested (a row exists for its pull id) is a no-op that returns the prior
 * outcome, so webhook replays write nothing twice.
 *
 * The manual path always exists independently of this service; nothing here can
 * remove a hauler's ability to verify insurance without Canopy.
 */

import { Logger } from '../../utils/logger';
import { CanopyClient } from './canopyClient';
import { CanopyConnectionSource, CanopyConnectionStore } from './canopyConnectionStore';
import { CanopyPull, parsePullMetadata } from './canopyTypes';
import { verifyNonce } from './canopyNonce';
import { mapPullToInsuranceData } from './canopyMapper';
import { decideCanopyInsurerPolicy } from './verificationDecision';
import { runCrossReferenceForCarrier } from './crossReferenceEngine';
import { createInsurerPolicyDocument } from './insurerPolicyDocument';

export type IngestionOutcome = 'VERIFIED' | 'PENDING' | 'NEEDS_FALLBACK';

export interface CanopyIngestionResult {
  outcome: IngestionOutcome;
  /** Machine reason for a fallback, or the decision reason for PENDING. */
  reason?: string;
  /** Human-facing insurer login error (NOT_AUTHENTICATED path). */
  loginErrorMessage?: string;
  pullId: string;
  carrierId?: string;
  connectionId?: string;
  documentId?: string;
  alreadyProcessed?: boolean;
}

export interface IngestPullInput {
  pullId: string;
  /** Which experience initiated it, when metadata does not carry a source. */
  source: CanopyConnectionSource;
}

/**
 * Ingest a hauler-initiated pull by id (widget or Components). Fetches the pull,
 * then delegates to ingestPullObject.
 */
export async function ingestPull(input: IngestPullInput): Promise<CanopyIngestionResult> {
  const pull = await CanopyClient.getPull(input.pullId);
  return ingestPullObject(pull, input.source);
}

/**
 * Ingest an already-fetched hauler-initiated pull. Requires a valid signed nonce
 * in the pull metadata; monitoring re-pulls (Canopy-initiated) go through the
 * monitoring path instead, which resolves the carrier by parent pull id.
 */
export async function ingestPullObject(
  pull: CanopyPull,
  source: CanopyConnectionSource,
): Promise<CanopyIngestionResult> {
  const pullId = pull.pull_id;

  // Idempotency: a pull already ingested is a no-op returning its prior outcome.
  const existing = await CanopyConnectionStore.findByPullId(pullId);
  if (existing) {
    Logger.info(`[canopy] pull ${pullId} already ingested (connection ${existing.connectionId}); no-op`);
    return {
      outcome: existing.status === 'CONNECTED' ? 'PENDING' : 'NEEDS_FALLBACK',
      reason: existing.failureReason,
      pullId,
      carrierId: existing.carrierId,
      connectionId: existing.connectionId,
      alreadyProcessed: true,
    };
  }

  const meta = parsePullMetadata(pull.meta_data);
  const carrierId = meta.carrierId;
  if (!carrierId) {
    throw new Error(`canopy ingestion: pull ${pullId} has no carrierId in metadata`);
  }
  if (!meta.nonce || !verifyNonce(meta.nonce, carrierId)) {
    throw new Error(`canopy ingestion: pull ${pullId} nonce failed validation for carrier ${carrierId}`);
  }
  const sourceMode: CanopyConnectionSource = (meta.source as CanopyConnectionSource) || source;

  // ── Failure statuses: record a FAILED connection, route to manual fallback ──
  if (pull.status === 'NOT_AUTHENTICATED') {
    const conn = await CanopyConnectionStore.record({
      carrierId,
      pullId,
      status: 'FAILED',
      sourceMode,
      nonce: meta.nonce,
      failureReason: 'NOT_AUTHENTICATED',
    });
    return {
      outcome: 'NEEDS_FALLBACK',
      reason: 'NOT_AUTHENTICATED',
      loginErrorMessage: pull.login_error_message ?? undefined,
      pullId,
      carrierId,
      connectionId: conn.connectionId,
    };
  }
  if (pull.status === 'PROVIDER_ERROR' || pull.status === 'INTERNAL_ERROR') {
    const conn = await CanopyConnectionStore.record({
      carrierId,
      pullId,
      status: 'FAILED',
      sourceMode,
      nonce: meta.nonce,
      failureReason: pull.status,
    });
    return { outcome: 'NEEDS_FALLBACK', reason: pull.status, pullId, carrierId, connectionId: conn.connectionId };
  }
  if (pull.status !== 'SUCCESS') {
    // PULLING/PENDING: not ready. Do not record a terminal row; the caller polls
    // or waits for the completion webhook.
    return { outcome: 'PENDING', reason: `pull_status_${pull.status}`, pullId, carrierId };
  }

  // ── Success: map the commercial policies ────────────────────────────────────
  const data = mapPullToInsuranceData(pull);
  if (!data.hasCommercialAuto) {
    // Authenticated, but no commercial-auto policy to verify against. Record the
    // connection and route to the manual fallback with a reason.
    const conn = await CanopyConnectionStore.record({
      carrierId,
      pullId,
      status: 'CONNECTED',
      sourceMode,
      insurerName: data.insurerName,
      nonce: meta.nonce,
      failureReason: 'NO_COMMERCIAL_POLICIES',
    });
    return {
      outcome: 'NEEDS_FALLBACK',
      reason: 'NO_COMMERCIAL_POLICIES',
      pullId,
      carrierId,
      connectionId: conn.connectionId,
    };
  }

  // Persist the connection and the insurer-sourced document.
  const conn = await CanopyConnectionStore.record({
    carrierId,
    pullId,
    status: 'CONNECTED',
    sourceMode,
    insurerName: data.insurerName,
    nonce: meta.nonce,
  });

  const doc = await createInsurerPolicyDocument(carrierId, pullId, data);

  // Verification decision (Phase 7): insurer liability + FMCSA + no unresolved
  // CRITICAL. Sets the document VERIFIED or leaves it PENDING with a reason.
  const decision = await decideCanopyInsurerPolicy({ documentId: doc.documentId, carrierId, data });

  // If the hauler already uploaded a COI, cross-reference it now against this
  // fresh insurer data (Phase 6). Best-effort; never blocks the connect outcome.
  await runCrossReferenceForCarrier(carrierId).catch((e) =>
    Logger.warn(`[canopy] cross-reference after ingest failed for ${carrierId}: ${e?.message ?? e}`),
  );

  return {
    outcome: decision.verified ? 'VERIFIED' : 'PENDING',
    reason: decision.reason,
    pullId,
    carrierId,
    connectionId: conn.connectionId,
    documentId: doc.documentId,
  };
}
