import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
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

async function main() {
  const desc = await client.send(new DescribeTableCommand({ TableName: USERS_TABLE }));
  const keySchema = desc?.Table?.KeySchema || [];
  const keyAttrs = keySchema.map(k => k.AttributeName);

  console.log("Table:", USERS_TABLE);
  console.log("Key attrs:", keyAttrs.join(", ") || "(unknown)");

  const res = await ddb.send(new ScanCommand({ TableName: USERS_TABLE, Limit: 500 }));
  const items = res.Items || [];

  const matches = items.filter(i => targetEmails.has(String(i?.email || "").toLowerCase()));
  console.log("Matched users:", matches.map(m => m.email).join(", ") || "(none)");

  let fixed = 0;

  for (const u of matches) {
    const email = String(u.email).toLowerCase();

    // if already good, skip
    if (typeof u.passwordHash === "string" && u.passwordHash.length > 10) {
      console.log(`✅ OK: ${email} already has passwordHash`);
      continue;
    }

    // Build key dynamically from table key schema
    const Key = {};
    let missingKey = false;
    for (const attr of keyAttrs) {
      if (u?.[attr] === undefined) {
        console.log(`❌ Cannot patch ${email}: item missing key attribute "${attr}"`);
        missingKey = true;
      } else {
        Key[attr] = u[attr];
      }
    }
    if (missingKey) {
      console.log("Item keys present:", Object.keys(u).slice(0, 25));
      continue;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    await ddb.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key,
      UpdateExpression: "SET passwordHash = :ph, updatedAt = :u",
      ExpressionAttributeValues: {
        ":ph": passwordHash,
        ":u": Date.now(),
      },
    }));

    console.log(`✅ Patched passwordHash for: ${email}`);
    fixed++;
  }

  console.log(`\nDone. Fixed ${fixed} user(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
