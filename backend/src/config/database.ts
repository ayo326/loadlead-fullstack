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
      const updateExpression = 'SET ' + Object.keys(updates)
        .map((k, i) => `#attr${i} = :val${i}`)
        .join(', ');
      
      const expressionAttributeNames = Object.keys(updates).reduce((acc, k, i) => {
        acc[`#attr${i}`] = k;
        return acc;
      }, {} as Record<string, string>);
      
      const expressionAttributeValues = Object.keys(updates).reduce((acc, k, i) => {
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
      const result = await docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }));
      
      return (result.Items as T[]) || [];
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
      
      const result = await docClient.send(new ScanCommand(params));
      return (result.Items as T[]) || [];
    } catch (error) {
      console.error('DynamoDB scan error:', error);
      throw error;
    }
  }
}

export default Database;
