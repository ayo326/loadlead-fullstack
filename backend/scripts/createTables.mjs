import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url) });

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const endpoint = process.env.DYNAMODB_ENDPOINT;
const region = process.env.AWS_REGION || "us-east-1";

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "local",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "local",
  },
});

const TABLES = [
  {
    TableName: process.env.DYNAMODB_USERS_TABLE || "LoadLead_Users",
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "email", AttributeType: "S" },
    ],
    KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "email-index",
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_DRIVERS_TABLE || "LoadLead_Drivers",
    AttributeDefinitions: [
      { AttributeName: "driverId", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "N" },
    ],
    KeySchema: [{ AttributeName: "driverId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "status-index",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_SHIPPERS_TABLE || "LoadLead_Shippers",
    AttributeDefinitions: [{ AttributeName: "shipperId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "shipperId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_RECEIVERS_TABLE || "LoadLead_Receivers",
    AttributeDefinitions: [{ AttributeName: "receiverId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "receiverId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_LOADS_TABLE || "LoadLead_Loads",
    AttributeDefinitions: [
      { AttributeName: "loadId", AttributeType: "S" },
      { AttributeName: "shipperId", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "N" },
    ],
    KeySchema: [{ AttributeName: "loadId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "shipperId-index",
        KeySchema: [
          { AttributeName: "shipperId", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "status-createdAt-index",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_OFFERS_TABLE || "LoadLead_Offers",
    AttributeDefinitions: [
      { AttributeName: "loadId", AttributeType: "S" },
      { AttributeName: "driverId", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "loadId", KeyType: "HASH" },
      { AttributeName: "driverId", KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "driverId-status-index",
        KeySchema: [
          { AttributeName: "driverId", KeyType: "HASH" },
          { AttributeName: "status", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
];

async function tableExists(TableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName }));
    return true;
  } catch (e) {
    if (e?.name === "ResourceNotFoundException") return false;
    throw e;
  }
}

async function waitActive(TableName) {
  for (let i = 0; i < 30; i++) {
    const r = await client.send(new DescribeTableCommand({ TableName }));
    if (r.Table?.TableStatus === "ACTIVE") return;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`Timeout waiting for ${TableName} to become ACTIVE`);
}

for (const def of TABLES) {
  const name = def.TableName;
  if (await tableExists(name)) {
    console.log(`✅ Exists: ${name}`);
    continue;
  }
  console.log(`🛠 Creating: ${name}`);
  await client.send(new CreateTableCommand(def));
  await waitActive(name);
  console.log(`✅ Created: ${name}`);
}

console.log("🎉 DynamoDB Local tables ready.");
