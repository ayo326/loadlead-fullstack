import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './aws';
import config from './environment';

export class Database {
  static async getItem<T>(tableName: string, key: Record<string, any>): Promise<T | null> {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: key,
      }));
      
      return result.Item as T || null;
    } catch (error) {
      console.error('DynamoDB getItem error:', error);
      throw error;
    }
  }
  
  static async putItem<T>(
    tableName: string,
    item: T,
    opts?: { conditionExpression?: string }
  ): Promise<void> {
    try {
      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: item as Record<string, any>,
        ...(opts?.conditionExpression ? { ConditionExpression: opts.conditionExpression } : {}),
      }));
    } catch (error: any) {
      // A conditional-put miss (attribute_not_exists on an idempotent insert that
      // lost a race) is expected control flow - the caller handles it. Don't log
      // it as an error; do rethrow so the caller can read back the winning row.
      if (error?.name !== 'ConditionalCheckFailedException') {
        console.error('DynamoDB putItem error:', error);
      }
      throw error;
    }
  }
  
  static async updateItem(
    tableName: string,
    key: Record<string, any>,
    updates: Record<string, any>
  ): Promise<void> {
    try {
      // Never attempt to SET a primary-key attribute: DynamoDB rejects it with
      // "This attribute is part of the key", surfacing as a 500. Strip any key
      // attrs a caller may have passed (e.g. a form PUTting the whole record).
      const keyAttrs = new Set(Object.keys(key));
      const attrs = Object.keys(updates).filter((k) => !keyAttrs.has(k));
      if (attrs.length === 0) return; // nothing to update

      const updateExpression = 'SET ' + attrs
        .map((k, i) => `#attr${i} = :val${i}`)
        .join(', ');

      const expressionAttributeNames = attrs.reduce((acc, k, i) => {
        acc[`#attr${i}`] = k;
        return acc;
      }, {} as Record<string, string>);

      const expressionAttributeValues = attrs.reduce((acc, k, i) => {
        acc[`:val${i}`] = updates[k];
        return acc;
      }, {} as Record<string, any>);

      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }));
    } catch (error) {
      console.error('DynamoDB updateItem error:', error);
      throw error;
    }
  }
  
  static async deleteItem(tableName: string, key: Record<string, any>): Promise<void> {
    try {
      await docClient.send(new DeleteCommand({
        TableName: tableName,
        Key: key,
      }));
    } catch (error) {
      console.error('DynamoDB deleteItem error:', error);
      throw error;
    }
  }
  
  static async query<T>(
    tableName: string,
    indexName: string | undefined,
    keyCondition: string,
    expressionAttributeNames: Record<string, string>,
    expressionAttributeValues: Record<string, any>
  ): Promise<T[]> {
    try {
      // Paginate across LastEvaluatedKey. DynamoDB caps each page at 1 MB and
      // returns LastEvaluatedKey when more rows remain; returning only the first
      // page silently drops data once a table exceeds 1 MB (audit v6 BL-C1 -
      // this fed factoring payee routing, payout intercepts and legal holds).
      const items: T[] = [];
      let exclusiveStartKey: Record<string, any> | undefined;
      do {
        const result = await docClient.send(new QueryCommand({
          TableName: tableName,
          IndexName: indexName,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ExclusiveStartKey: exclusiveStartKey,
        }));
        if (result.Items) items.push(...(result.Items as T[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return items;
    } catch (error) {
      console.error('DynamoDB query error:', error);
      throw error;
    }
  }
  
  static async scan<T>(tableName: string, filterExpression?: string, expressionAttributeValues?: Record<string, any>, expressionAttributeNames?: Record<string, string>): Promise<T[]> {
    try {
      const params: any = {
        TableName: tableName,
      };

      if (filterExpression) {
        params.FilterExpression = filterExpression;
        params.ExpressionAttributeValues = expressionAttributeValues;
        if (expressionAttributeNames) {
          params.ExpressionAttributeNames = expressionAttributeNames;
        }
      }
      
      // Paginate across LastEvaluatedKey (see query() above). A single Scan
      // returns at most 1 MB, and any FilterExpression is applied AFTER that
      // page read - so without this loop a matching row beyond the first page
      // is silently missed (audit v6 BL-C1 / H2).
      const items: T[] = [];
      let exclusiveStartKey: Record<string, any> | undefined;
      do {
        const result = await docClient.send(new ScanCommand({ ...params, ExclusiveStartKey: exclusiveStartKey }));
        if (result.Items) items.push(...(result.Items as T[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return items;
    } catch (error) {
      console.error('DynamoDB scan error:', error);
      throw error;
    }
  }
}

export default Database;
