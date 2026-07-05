// In-app notification inbox.
// Persists every outbound notification (email, push, or system) so users can
// review them in the app, mark read, and act on links - independent of whether
// the email/push reached the OS.

import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../config/aws';
import { Helpers } from '../utils/helpers';
import Logger from '../utils/logger';

const TABLE = process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'LoadLead_Notifications';

export type NotificationKind =
  | 'LOAD_OFFERED'
  | 'LOAD_ACCEPTED'
  | 'LOAD_DELIVERED'
  | 'INVITE_RECEIVED'
  | 'VERIFICATION_UPDATE'
  | 'PASSWORD_RESET'
  | 'SYSTEM';

export interface Notification {
  notificationId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
  read: boolean;
  createdAt: number;
  readAt?: number;
}

export class NotificationService {
  /**
   * Record a notification. Non-blocking - failures are logged but never
   * thrown, because the caller is in the middle of sending email/push and
   * a failed insert here must not prevent the underlying delivery.
   */
  static async record(params: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    url?: string;
  }): Promise<void> {
    try {
      const item: Notification = {
        notificationId: Helpers.generateId('ntf'),
        userId: params.userId,
        kind: params.kind,
        title: params.title,
        body: params.body,
        url: params.url,
        read: false,
        createdAt: Helpers.getCurrentTimestamp(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
    } catch (err) {
      Logger.error(`[NotificationService] failed to record: ${err}`);
    }
  }

  static async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    const res = await docClient.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: '#u = :u',
      ExpressionAttributeNames: { '#u': 'userId' },
      ExpressionAttributeValues: { ':u': userId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }));
    return (res.Items as Notification[]) ?? [];
  }

  static async unreadCount(userId: string): Promise<number> {
    const all = await this.listForUser(userId);
    return all.filter(n => !n.read).length;
  }

  static async markRead(notificationId: string, userId: string): Promise<void> {
    // Defensive: verify ownership before updating
    const got = await docClient.send(new GetCommand({ TableName: TABLE, Key: { notificationId } }));
    const n = got.Item as Notification | undefined;
    if (!n || n.userId !== userId) return;

    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { notificationId },
      UpdateExpression: 'SET #r = :r, readAt = :t',
      ExpressionAttributeNames: { '#r': 'read' },
      ExpressionAttributeValues: { ':r': true, ':t': Helpers.getCurrentTimestamp() },
    }));
  }

  static async markAllRead(userId: string): Promise<number> {
    const all = await this.listForUser(userId);
    const unread = all.filter(n => !n.read);
    await Promise.all(unread.map(n => this.markRead(n.notificationId, userId)));
    return unread.length;
  }
}
