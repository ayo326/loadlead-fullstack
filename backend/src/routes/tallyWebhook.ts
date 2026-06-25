/**
 * Tally webhook — the ingestion front door for the beta pipeline.
 *
 *   POST /api/admin/beta/webhook
 *
 * Machine-to-machine: secured by Tally's HMAC signature, NOT by a user
 * session. There is no requireAdmin here — this is mounted OUTSIDE the
 * admin router (in index.ts, before express.json) precisely so a webhook
 * with no cookie can reach it.
 *
 * Raw-body discipline (the #1 cause of signature mismatch in Express):
 *   The route is mounted with express.raw() BEFORE the global express.json
 *   so `req.body` is the exact Buffer Tally sent. We verify the HMAC over
 *   those raw bytes and only THEN JSON.parse them. We never verify against
 *   a re-serialized body.
 *
 * Flow (all synchronous + fast; a single DDB put, well under Tally's 10s):
 *   1. not-connected (no secret) → 503 inert, no fabricated data
 *   2. optional X-Beta-Source=tally header check (defence in depth)
 *   3. HMAC-SHA256(base64) over raw body, timing-safe compare → 401 on miss
 *   4. JSON.parse the verified raw body
 *   5. optional formId sanity check
 *   6. ingest → BetaApplication (idempotent by responseId; auto-qualify +
 *      objective score run inside ingestFromTally) → 200/201
 *
 * Logging redacts email / phone / MC — never log PII or the raw body.
 */

import { Request, Response } from 'express';
import { getBetaConfig, isTallyConnected } from '../config/beta';
import { verifyTallySignature } from '../services/tallySignature';
import { BetaApplicationService } from '../services/betaApplicationService';
import { Logger } from '../utils/logger';

function pickHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export async function tallyWebhookHandler(req: Request, res: Response): Promise<Response> {
  const cfg = getBetaConfig();

  // 1. Not connected → inert. The dashboard reads the same signal and
  //    shows "form not connected". Never fabricate applications.
  if (!isTallyConnected()) {
    return res.status(503).json({
      error: 'form_not_connected',
      message: 'Tally signing secret is not configured; ingest is disabled.',
    });
  }

  // 2. Optional custom-source header (defence in depth).
  if (cfg.tallyRequireSourceHeader) {
    if (pickHeader(req, 'x-beta-source') !== 'tally') {
      Logger.warn('[tally] rejected: missing/incorrect X-Beta-Source header');
      return res.status(401).json({ error: 'bad_source' });
    }
  }

  // 3. Verify the signature over the RAW body. req.body is a Buffer here
  //    because the route is mounted with express.raw() before express.json.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : // Fallback: if some upstream parsed it, the global express.json verify
      // hook stashed the original bytes on req.rawBody.
      (req as any).rawBody?.toString('utf8') ?? '';

  const verify = verifyTallySignature({
    rawBody,
    headers: req.headers,
    secret: cfg.tallySigningSecret ?? undefined,
  });
  if (!verify.ok) {
    Logger.warn(`[tally] signature rejected: ${verify.reason}`);
    return res.status(401).json({ error: verify.reason ?? 'bad-signature' });
  }

  // 4. Parse the verified raw body.
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // 5. Optional formId sanity check (a leaked secret pointed at a different
  //    form would be caught here).
  if (cfg.tallyFormId && payload?.data?.formId && payload.data.formId !== cfg.tallyFormId) {
    Logger.warn(`[tally] formId mismatch: got ${payload?.data?.formId}`);
    return res.status(400).json({ error: 'form_id_mismatch' });
  }

  // 6. Ingest (idempotent). ingestFromTally maps fields, auto-qualifies,
  //    and pre-computes objective scores. A single DDB put → ack fast.
  try {
    const { application, created } = await BetaApplicationService.ingestFromTally(
      payload,
      { currentWave: cfg.currentCohort },
    );
    return res.status(created ? 201 : 200).json({
      ok: true,
      created,                 // false = idempotent duplicate
      applicationId: application.applicationId,
      status: application.status,
      autoFlags: application.autoFlags,
    });
  } catch (err: any) {
    const code = err?.statusCode ?? err?.status ?? 500;
    // err.message may reference a field name but never the value.
    Logger.warn(`[tally] ingest failed (${code}): ${err?.message}`);
    return res.status(code >= 400 && code < 500 ? code : 422).json({
      error: 'ingest_failed',
      message: err?.message,
    });
  }
}
