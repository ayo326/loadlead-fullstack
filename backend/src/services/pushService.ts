import { PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
// The actual webpush dispatch now routes through services/integrations/push.ts
// — every public method below is unchanged.
import { sendPush } from './integrations/push';
import { NotificationService, NotificationKind } from './notificationService';

// Best-effort mapping from a push title to an inbox kind. Falls back to SYSTEM.
function kindFromTitle(title: string): NotificationKind {
  const t = title.toLowerCase();
  if (t.includes('new load') || t.includes('offer')) return 'LOAD_OFFERED';
  if (t.includes('accepted')) return 'LOAD_ACCEPTED';
  if (t.includes('delivered')) return 'LOAD_DELIVERED';
  if (t.includes('invite')) return 'INVITE_RECEIVED';
  if (t.includes('verifi')) return 'VERIFICATION_UPDATE';
  return 'SYSTEM';
}

const TABLE = process.env.DYNAMODB_PUSH_TABLE || 'LoadLead_PushSubscriptions';

export const PushService = {
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',

  async saveSubscription(userId: string, subscription: unknown) {
    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: { userId, subscription, updatedAt: Date.now() },
    }));
  },

  async removeSubscription(userId: string) {
    await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { userId } }));
  },

  async send(userId: string, title: string, body: string, url?: string) {
    // Inbox first (independent of push delivery): user sees it on next login
    // even if their push subscription is missing or expired.
    await NotificationService.record({ userId, kind: kindFromTitle(title), title, body, url });
    await sendPush(userId, title, body, url);
  },

  async sendMany(userIds: string[], title: string, body: string, url?: string) {
    await Promise.allSettled(userIds.map((id) => this.send(id, title, body, url)));
  },
};
