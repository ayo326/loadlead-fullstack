import 'dotenv/config';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const endpoint =
  process.env.DYNAMODB_ENDPOINT ||
  process.env.AWS_DYNAMODB_ENDPOINT ||
  'http://127.0.0.1:8000';

const region = process.env.AWS_REGION || 'us-east-1';

const USERS = process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users';
const DRIVERS = process.env.DYNAMODB_DRIVERS_TABLE || 'LoadLead_Drivers';
const SHIPPERS = process.env.DYNAMODB_SHIPPERS_TABLE || 'LoadLead_Shippers';
const RECEIVERS = process.env.DYNAMODB_RECEIVERS_TABLE || 'LoadLead_Receivers';

async function getBcrypt() {
  try {
    const mod = await import('bcryptjs');
    return mod.default || mod;
  } catch (e) {
    // If bcryptjs isn't installed, tell the user how to fix.
    console.error("❌ Missing bcryptjs. Run: cd backend && npm i bcryptjs");
    process.exit(1);
  }
}

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

const ddb = DynamoDBDocumentClient.from(client);

async function describeKeys(tableName) {
  const out = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const ks = out?.Table?.KeySchema || [];
  return ks.map(k => k.AttributeName);
}

function keyValueFor(attr, ctx) {
  const a = attr.toLowerCase();
  if (a.includes('email')) return ctx.email;
  if (a.includes('userid')) return ctx.userId;
  if (a.includes('driverid')) return ctx.userId;
  if (a.includes('shipperid')) return ctx.userId;
  if (a.includes('receiverid')) return ctx.userId;
  if (a === 'pk') return ctx.userId;
  if (a === 'sk') return 'PROFILE';
  return ctx.userId;
}

async function putWithKeys(tableName, item, ctx) {
  const keys = await describeKeys(tableName);
  const full = { ...item };

  for (const k of keys) {
    if (full[k] === undefined) full[k] = keyValueFor(k, ctx);
  }

  await ddb.send(new PutCommand({ TableName: tableName, Item: full }));
}

const now = () => Date.now();

// 🔒 Known-good test accounts
const TEST_PASSWORD = 'Password123!';

const seedUsers = [
  { email: 'admin4@test.com', role: 'ADMIN', userId: 'user_admin4' },
  { email: 'shipper1@test.com', role: 'SHIPPER', userId: 'user_shipper1' },
  { email: 'driver1@test.com', role: 'DRIVER', userId: 'user_driver1' },
  { email: 'receiver@test.com', role: 'RECEIVER', userId: 'user_receiver1' },
];

const seedProfiles = {
  DRIVER: (u) => ({
    userId: u.userId,
    email: u.email,
    // Put driver near Dallas so broadcasts can find them in local testing
    currentLat: 32.7767,
    currentLng: -96.7970,
    // satisfy common UI fields if present
    fullName: 'Test Driver',
    truckVIN: '1HGCM82633A004352', // 17 chars
    updatedAt: now(),
    createdAt: now(),
  }),
  SHIPPER: (u) => ({
    userId: u.userId,
    email: u.email,
    companyName: 'Test Shipper Co',
    contactName: 'Test Shipper',
    phone: '555-555-5555',
    updatedAt: now(),
    createdAt: now(),
  }),
  RECEIVER: (u) => ({
    userId: u.userId,
    email: u.email,
    facilityName: 'Test Receiver Facility',
    contactName: 'Test Receiver',
    phone: '555-555-5555',
    updatedAt: now(),
    createdAt: now(),
  }),
};

const tableForRole = (role) => {
  if (role === 'DRIVER') return DRIVERS;
  if (role === 'SHIPPER') return SHIPPERS;
  if (role === 'RECEIVER') return RECEIVERS;
  return null; // ADMIN has no profile table
};

async function main() {
  const bcrypt = await getBcrypt();
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);

  console.log('🔌 Dynamo endpoint:', endpoint);
  console.log('🧾 Tables:', { USERS, DRIVERS, SHIPPERS, RECEIVERS });

  for (const u of seedUsers) {
    // Put user
    await putWithKeys(
      USERS,
      {
        userId: u.userId,
        email: u.email,
        role: u.role,
        passwordHash: hash,
        createdAt: now(),
        updatedAt: now(),
      },
      u
    );

    // Put profile (if needed)
    const profileTable = tableForRole(u.role);
    if (profileTable) {
      const mk = seedProfiles[u.role];
      await putWithKeys(profileTable, mk(u), u);
    }

    console.log(`✅ Seeded: ${u.email} (${u.role})`);
  }

  console.log('🎉 Seed complete. All test accounts use:', TEST_PASSWORD);
}

main().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
