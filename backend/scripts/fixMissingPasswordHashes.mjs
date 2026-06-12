import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";

const endpoint = process.env.DYNAMODB_ENDPOINT || "http://127.0.0.1:8000";
const region = process.env.AWS_REGION || "us-east-1";
const USERS_TABLE = process.env.DYNAMODB_USERS_TABLE || "LoadLead_Users";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const ddb = DynamoDBDocumentClient.from(client);

const targetEmails = new Set(["shipper1@test.com", "receiver@test.com"]);

const res = await ddb.send(new ScanCommand({ TableName: USERS_TABLE, Limit: 500 }));
const items = res.Items || [];

let fixed = 0;

for (const u of items) {
  const email = (u?.email || "").toLowerCase();
  if (!targetEmails.has(email)) continue;

  // already good
  if (typeof u?.passwordHash === "string" && u.passwordHash.length > 10) {
    console.log(`✅ OK: ${email} already has passwordHash`);
    continue;
  }

  if (!u?.userId) {
    console.log(`⚠️ Skipping ${email} (missing userId key)`, u);
    continue;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await ddb.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: u.userId },
      UpdateExpression: "SET passwordHash = :ph, updatedAt = :u",
      ExpressionAttributeValues: {
        ":ph": passwordHash,
        ":u": Date.now(),
      },
    })
  );

  console.log(`✅ Patched passwordHash for: ${email}`);
  fixed++;
}

console.log(`\nDone. Fixed ${fixed} user(s).`);
