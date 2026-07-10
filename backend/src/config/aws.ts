import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { config } from './environment';

const isLocalDynamo = !!config.dynamodb.endpoint;

// If using DynamoDB Local, AWS SDK still requires creds - dummy values are fine.
const credentials =
  isLocalDynamo
    ? {
        accessKeyId: config.aws.accessKeyId || 'local',
        secretAccessKey: config.aws.secretAccessKey || 'local',
      }
    : (config.aws.accessKeyId && config.aws.secretAccessKey
        ? {
            accessKeyId: config.aws.accessKeyId,
            secretAccessKey: config.aws.secretAccessKey,
          }
        : undefined);

// DynamoDB Client - exported for control-plane calls (DescribeTable in the
// boot-time index assertion); data-plane access stays on docClient/Database.
export const dynamoClient = new DynamoDBClient({
  region: config.aws.region,
  endpoint: config.dynamodb.endpoint || undefined,
  credentials,
});

export const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
});

// S3 Client (works only if you configure real AWS creds/bucket; not required for local dev flows)
export const s3Client = new S3Client({
  region: config.aws.region,
  credentials,
});

// Cognito Client (works only if you configure Cognito; not required for local dev flows)
export const cognitoClient = new CognitoIdentityProviderClient({
  region: config.aws.region,
  credentials,
});
