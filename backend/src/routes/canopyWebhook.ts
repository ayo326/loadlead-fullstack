/**
 * Canopy webhook - the ingestion front door for insurer-sourced data.
 *
 *   POST /api/webhooks/canopy
 *
 * Machine-to-machine, no user session. Mounted OUTSIDE the authenticated router
 * (in index.ts, before express.json) with express.raw() so req.body is the exact
 * bytes Canopy sent and the signature is verified over those raw bytes.
 *
 * Discipline:
 *   1. Verify the signature over the RAW body (config-driven scheme, see
 *      canopySignature). With no secret configured: reject in production, and in
 *      sandbox proceed but ALWAYS re-retrieve the pull by id (so an unsigned
 *      sandbox event still cannot forge state - the pull must resolve to real
 *      Canopy data).
 *   2. Parse the verified body; extract the event type and pull id.
 *   3. Dispatch to ingestion or monitoring. Fast, idempotent: a replayed event
 *      writes nothing twice (keyed on the pull id). Return 200 on success; on a
 *      processing error return 500 so Canopy retries (idempotency dedupes).
 *
 * Never logs the secret, credentials, or the raw body.
 */

import { Request, Response } from 'express';
import canopyConfig from '../config/canopyConfig';
import { Logger } from '../utils/logger';
import { verifyCanopySignature } from '../services/canopy/canopySignature';
import { CanopyClient } from '../services/canopy/canopyClient';
import { ingestPullObject } from '../services/canopy/canopyIngestionService';
import {
  ingestMonitoringPullObject,
  markDisconnected,
} from '../services/canopy/canopyMonitoringService';
import { CanopyConnectionSource } from '../services/canopy/canopyConnectionStore';

function pick(obj: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = k.split('.').reduce((o: any, part) => (o == null ? o : o[part]), obj);
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** Fetch the pull once and route to the initial or monitoring pipeline. */
async function dispatchPull(pullId: string, source: CanopyConnectionSource): Promise<void> {
  const pull = await CanopyClient.getPull(pullId);
  if (pull.parent_pull_id) {
    await ingestMonitoringPullObject(pull);
  } else {
    await ingestPullObject(pull, source);
  }
}

export async function canopyWebhookHandler(req: Request, res: Response): Promise<Response> {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : (req as any).rawBody?.toString('utf8') ?? (typeof req.body === 'string' ? req.body : '');

  // 1. Signature.
  const secret = canopyConfig.webhookSecret || undefined;
  if (!secret) {
    if (canopyConfig.live) {
      Logger.warn('[canopy] webhook rejected: no CANOPY_WEBHOOK_SECRET in production');
      return res.status(401).json({ error: 'webhook_not_configured' });
    }
    // Sandbox without a secret: proceed, but every dispatch re-retrieves the pull
    // by id, so state cannot be forged.
    Logger.warn('[canopy] webhook accepted WITHOUT signature (sandbox, no secret); pull will be re-retrieved');
  } else {
    const verify = verifyCanopySignature({ rawBody, headers: req.headers, secret });
    if (!verify.ok) {
      Logger.warn(`[canopy] webhook signature rejected: ${verify.reason}`);
      return res.status(401).json({ error: verify.reason ?? 'bad_signature' });
    }
  }

  // 2. Parse.
  let payload: any;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const eventType = (pick(payload, 'event_type', 'type', 'event', 'data.event_type') || '').toUpperCase();
  const pullId = pick(payload, 'pull_id', 'pullId', 'data.pull_id', 'pull.pull_id', 'data.pullId');
  const source = ((pick(payload, 'source', 'data.source') as CanopyConnectionSource) || 'widget');

  // 3. Dispatch. Ack fast; idempotency handles retries and replays.
  try {
    switch (eventType) {
      case 'MONITORING_RECONNECT': {
        const ref =
          pullId || pick(payload, 'initial_pull_id', 'data.initial_pull_id') || '';
        if (ref) await markDisconnected(ref);
        break;
      }
      case 'MONITORING_EVENTS':
      case 'DATA_UPDATED':
      case 'COMPLETE':
      case 'POLICIES_AVAILABLE':
      case 'POLICY_AVAILABLE':
      case 'ERROR': {
        if (pullId) await dispatchPull(pullId, source);
        break;
      }
      default:
        // AUTH_STATUS, SERVICING_*, and anything unrecognized: nothing to do.
        Logger.info(`[canopy] webhook ${eventType || 'unknown'} acknowledged (no action)`);
        break;
    }
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    // Return 500 so Canopy retries; ingestion is idempotent, so the retry is safe.
    Logger.error(`[canopy] webhook processing failed (${eventType} ${pullId ?? 'no-pull'}): ${err?.message ?? err}`);
    return res.status(500).json({ error: 'processing_failed' });
  }
}
