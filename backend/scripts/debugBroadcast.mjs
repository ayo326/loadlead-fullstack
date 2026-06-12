import 'dotenv/config';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const endpoint = process.env.DYNAMODB_ENDPOINT || "http://127.0.0.1:8000";
const region = process.env.AWS_REGION || "us-east-1";

const USERS = process.env.DYNAMODB_USERS_TABLE || "LoadLead_Users";
const DRIVERS = process.env.DYNAMODB_DRIVERS_TABLE || "LoadLead_Drivers";
const LOADS = process.env.DYNAMODB_LOADS_TABLE || "LoadLead_Loads";

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const ddb = DynamoDBDocumentClient.from(client);

async function scan(tableName, limit = 5) {
  const res = await ddb.send(new ScanCommand({ TableName: tableName, Limit: limit }));
  return res.Items || [];
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

(async () => {
  const drivers = await scan(DRIVERS, 10);
  const loads = await scan(LOADS, 10);

  console.log("\n=== TABLES ===");
  console.log({ endpoint, USERS, DRIVERS, LOADS });

  console.log("\n=== DRIVERS (count:", drivers.length, ") ===");
  drivers.slice(0, 5).forEach((d, i) => {
    console.log(`\nDriver #${i+1}`);
    console.log("keys:", Object.keys(d || {}).sort());
    console.log("sample:", pick(d, [
      "driverId","userId","email","status",
      "currentLat","currentLng","lastLat","lastLng",
      "lastKnownLat","lastKnownLng","locationEnabled","locationSharingEnabled",
      "mcMaturityDays","equipmentType","trailerType"
    ]));
  });

  console.log("\n=== LOADS (count:", loads.length, ") ===");
  loads.slice(0, 5).forEach((l, i) => {
    console.log(`\nLoad #${i+1}`);
    console.log("keys:", Object.keys(l || {}).sort());
    console.log("sample:", pick(l, [
      "loadId","status","broadcastRadiusMiles","minMcMaturityDays",
      "pickupLat","pickupLng","deliveryLat","deliveryLng",
      "pickupCity","pickupState","deliveryCity","deliveryState",
      "equipmentType","totalWeightLbs"
    ]));
  });
})().catch((e) => {
  console.error("debugBroadcast failed:", e);
  process.exit(1);
});
