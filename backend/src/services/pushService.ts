import webpush from 'web-push';
import { PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';

const TABLE = process.env.DYNAMODB_PUSH_TABLE || 'LoadLead_PushSubscriptions';

webpush.setVapidDetails(
  'mailto:noreply@loadleadapp.com',
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || '',
);

export const PushService = {
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',

  async saveSubscription(userId: string, subscription: webpush.PushSubscription) {
    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: { userId, subscription, updatedAt: Date.now() },
    }));
  },

  async removeSubscription(userId: string) {
    await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { userId } }));
  },

  async send(userId: string, title: string, body: string, url?: string) {
    try {
      const res = await docClient.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
      if (!res.Item) return;
      await webpush.sendNotification(
        res.Item.subscription,
        JSON.stringify({ title, body, url: url || 'https://loadleadapp.com' }),
      );
    } catch (err: any) {
      console.error('[PushService] push failed for', userId, err?.message);
    }
  },

  async sendMany(userIds: string[], title: string, body: string, url?: string) {
    await Promise.allSettled(userIds.map((id) => this.send(id, title, body, url)));
  },
};
