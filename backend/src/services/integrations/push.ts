// services/integrations/push.ts
//
// Web Push adapter. Ships to every environment, including production.
// Moved the actual webpush.sendNotification call out of
// services/pushService.ts — pushService.ts keeps its public API
// (saveSubscription, removeSubscription, send, sendMany) exactly as-is;
// only its internal dispatch now delegates here.
//
// Capture mode NEVER calls webpush at all — it just records what would have
// been sent into the capture store for GET /_test/outbox. No real browser
// endpoint is ever contacted outside live mode.

import webpush from 'web-push';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../config/aws';
import { resolveMode } from './modeResolver';
import { CaptureStore } from './captureStore';
import Logger from '../../utils/logger';

const TABLE = process.env.DYNAMODB_PUSH_TABLE || 'LoadLead_PushSubscriptions';

let vapidConfigured = false;
function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    'mailto:noreply@loadleadapp.com',
    process.env.VAPID_PUBLIC_KEY || '',
    process.env.VAPID_PRIVATE_KEY || '',
  );
  vapidConfigured = true;
}

export async function sendPush(userId: string, title: string, body: string, url?: string): Promise<void> {
  const mode = resolveMode('push');
  const targetUrl = url || 'https://loadleadapp.com';

  if (mode !== 'live') {
    CaptureStore.recordPush({ userId, title, body, url: targetUrl, capturedAt: new Date().toISOString() });
    return;
  }

  try {
    ensureVapidConfigured();
    const res = await docClient.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
    if (!res.Item) return;
    await webpush.sendNotification(res.Item.subscription, JSON.stringify({ title, body, url: targetUrl }));
  } catch (err: any) {
    Logger.error(`[integrations/push] push failed for ${userId}: ${err?.message ?? err}`);
  }
}
