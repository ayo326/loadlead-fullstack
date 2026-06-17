import { PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
// The actual webpush dispatch now routes through services/integrations/push.ts
// — every public method below is unchanged.
import { sendPush } from './integrations/push';

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
    await sendPush(userId, title, body, url);
  },

  async sendMany(userIds: string[], title: string, body: string, url?: string) {
    await Promise.allSettled(userIds.map((id) => this.send(id, title, body, url)));
  },
};
