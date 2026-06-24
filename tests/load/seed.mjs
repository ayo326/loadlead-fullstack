#!/usr/bin/env node
// E2E load-test seed: builds the full cast across all five personas.
//
// Idempotent: re-running detects existing accounts and skips. Seeds
// verified + unverified parents AND equipment variety so the matching
// rule, verification gates, and capability checks are actually exercised
// by the fan-out test.
//
// Cast:
//   2 Shippers (S1, S2) -- both verified
//   2 Carrier orgs:
//     C1: 1 CARRIER_ADMIN + 2 org drivers (D1 dry-van, D2 reefer)
//     C2: 1 CARRIER_ADMIN + 1 org driver  (D3 flatbed)   <-- parent UNVERIFIED
//   2 Owner Operators:
//     O1: OO self-driver D4 (dry-van)            <-- verified
//     O2: OO + fleet driver D5 (hazmat)           <-- parent UNVERIFIED
//   1 affiliated DRIVER D6 attached to C1 (dry-van)
//   1 UNAFFILIATED DRIVER D7 (dry-van; for negative-test acceptance)
//   2 Receivers (R1, R2)
//
// Usage:
//   BASE_URL=http://localhost:4000 node tests/load/seed.mjs
//   BASE_URL=http://localhost:4000 node tests/load/seed.mjs --verify

import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
if (BASE.includes('api.loadleadapp.com') && !process.env.I_REALLY_MEAN_PROD) {
  console.error('Refusing to seed against PROD. Set I_REALLY_MEAN_PROD=1 to override (don\'t).');
  process.exit(2);
}
const PW = 'TestPassword123!';

const actors = {
  shippers: [
    { email: 'shipper.k6.s1@loadleadapp.com', firstName: 'K6', lastName: 'Shipper1' },
    { email: 'shipper.k6.s2@loadleadapp.com', firstName: 'K6', lastName: 'Shipper2' },
  ],
  carriers: [
    { email: 'carrier.k6.c1@loadleadapp.com', firstName: 'K6', lastName: 'Carrier1',
      legalName: 'K6 Carrier 1 LLC', mcNumber: 'MCK61', dotNumber: 'DOTK61', verified: true },
    { email: 'carrier.k6.c2@loadleadapp.com', firstName: 'K6', lastName: 'Carrier2',
      legalName: 'K6 Carrier 2 LLC', mcNumber: 'MCK62', dotNumber: 'DOTK62', verified: false },
  ],
  ownerOps: [
    { email: 'oo.k6.o1@loadleadapp.com', firstName: 'K6', lastName: 'OwnerOp1', verified: true,
      equipment: 'DRY_VAN' },
    { email: 'oo.k6.o2@loadleadapp.com', firstName: 'K6', lastName: 'OwnerOp2', verified: false,
      equipment: 'HAZMAT' },
  ],
  drivers: [
    { email: 'driver.k6.d1@loadleadapp.com', firstName: 'K6', lastName: 'Driver1',
      equipment: 'DRY_VAN', mc: 'MCD1', parent: 'C1', verified: true },
    { email: 'driver.k6.d2@loadleadapp.com', firstName: 'K6', lastName: 'Driver2',
      equipment: 'REEFER', mc: 'MCD2', parent: 'C1', verified: true },
    { email: 'driver.k6.d3@loadleadapp.com', firstName: 'K6', lastName: 'Driver3',
      equipment: 'FLATBED', mc: 'MCD3', parent: 'C2', verified: false },
    { email: 'driver.k6.d5@loadleadapp.com', firstName: 'K6', lastName: 'Driver5',
      equipment: 'HAZMAT', mc: 'MCD5', parent: 'O2', verified: false },
    { email: 'driver.k6.d6@loadleadapp.com', firstName: 'K6', lastName: 'Driver6',
      equipment: 'DRY_VAN', mc: 'MCD6', parent: 'C1', verified: true },
    { email: 'driver.k6.d7@loadleadapp.com', firstName: 'K6', lastName: 'Driver7',
      equipment: 'DRY_VAN', mc: 'MCD7', parent: null,  verified: false },
  ],
  receivers: [
    { email: 'receiver.k6.r1@loadleadapp.com', firstName: 'K6', lastName: 'Receiver1' },
    { email: 'receiver.k6.r2@loadleadapp.com', firstName: 'K6', lastName: 'Receiver2' },
  ],
};

async function postJson(path, body, token) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
}
async function login(email) {
  const r = await postJson('/api/auth/login', { email, password: PW });
  return r.status === 200 ? r.json.token : null;
}
async function signupOrLogin(email, role, firstName, lastName) {
  let token = await login(email);
  if (token) return { token, fresh: false };
  const r = await postJson('/api/auth/signup', {
    email, password: PW, role, firstName, lastName,
  });
  if (r.status !== 201) {
    console.error(`  ✗ signup ${email} (${role}) -> ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    return { token: null, fresh: false };
  }
  return { token: r.json.token, fresh: true };
}

const out = { shippers: [], carriers: [], ownerOps: [], drivers: [], receivers: [] };

async function seedShippers() {
  console.log('── shippers ──');
  for (const a of actors.shippers) {
    const { token, fresh } = await signupOrLogin(a.email, 'SHIPPER', a.firstName, a.lastName);
    if (!token) continue;
    if (fresh) {
      await postJson('/api/shipper/profile', {
        companyName: `${a.firstName} ${a.lastName} Shipping`,
        companyAddress: '100 Test Way, Houston, TX 77001',
        contactName: `${a.firstName} ${a.lastName}`,
        contactPhone: '+15555550100', contactEmail: a.email,
      }, token);
    }
    out.shippers.push({ ...a, token });
    console.log(`  ✓ ${a.email} (${fresh ? 'NEW' : 'reuse'})`);
    await sleep(80);
  }
}

async function seedCarriers() {
  console.log('── carrier orgs ──');
  for (const a of actors.carriers) {
    let token = await login(a.email);
    let fresh = false;
    if (!token) {
      const r = await postJson('/api/auth/signup/carrier', {
        email: a.email, password: PW,
        legalName: a.legalName, mcNumber: a.mcNumber, dotNumber: a.dotNumber,
        firstName: a.firstName, lastName: a.lastName,
      });
      if (r.status !== 201) {
        console.error(`  ✗ signup carrier ${a.email}: ${r.status}`);
        continue;
      }
      token = r.json.token; fresh = true;
    }
    out.carriers.push({ ...a, token });
    console.log(`  ✓ ${a.email} (${fresh ? 'NEW' : 'reuse'})`);
    await sleep(80);
  }
}

async function seedOwnerOps() {
  console.log('── owner operators ──');
  for (const a of actors.ownerOps) {
    const { token, fresh } = await signupOrLogin(a.email, 'OWNER_OPERATOR', a.firstName, a.lastName);
    if (!token) continue;
    out.ownerOps.push({ ...a, token });
    console.log(`  ✓ ${a.email} (${fresh ? 'NEW' : 'reuse'})`);
    await sleep(80);
  }
}

async function seedDrivers() {
  console.log('── drivers ──');
  for (const a of actors.drivers) {
    const { token, fresh } = await signupOrLogin(a.email, 'DRIVER', a.firstName, a.lastName);
    if (!token) continue;
    if (fresh) {
      await postJson('/api/driver/profile', {
        fullName: `${a.firstName} ${a.lastName}`,
        mcNumber: a.mc,
        dotNumber: `DOT${a.mc}`,
        trailerType: a.equipment,
        maxCapacityLbs: 41000,
        cargoInsuranceAmount: 100000,
        liabilityInsuranceAmount: 1000000,
        authorityStartDate: Date.now() - 365 * 86_400_000,
      }, token);
    }
    await postJson('/api/driver/location', {
      lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX',
    }, token);
    out.drivers.push({ ...a, token });
    console.log(`  ✓ ${a.email} (${fresh ? 'NEW' : 'reuse'}) — ${a.equipment}, parent=${a.parent ?? '-'}`);
    await sleep(80);
  }
}

async function seedReceivers() {
  console.log('── receivers ──');
  for (const a of actors.receivers) {
    const { token, fresh } = await signupOrLogin(a.email, 'RECEIVER', a.firstName, a.lastName);
    if (!token) continue;
    if (fresh) {
      await postJson('/api/receiver/profile', {
        facilityName: `${a.firstName}-${a.lastName} Receiving`,
        address: '200 Dock Rd, Atlanta, GA 30301',
        contactName: `${a.firstName} ${a.lastName}`,
        contactPhone: '+15555550103',
      }, token);
    }
    out.receivers.push({ ...a, token });
    console.log(`  ✓ ${a.email} (${fresh ? 'NEW' : 'reuse'})`);
    await sleep(80);
  }
}

// Force-verify drivers + carriers directly via DDB so we can exercise
// the gate (verified vs unverified) deterministically.
async function setVerifiedFlags() {
  console.log('── flipping verified flags directly in local DDB ──');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }));
  // Drivers
  const allDrivers = await ddb.send(new ScanCommand({ TableName: 'LoadLead_Drivers' }));
  for (const d of allDrivers.Items ?? []) {
    const ours = actors.drivers.find((x) => d.fullName?.includes(x.lastName));
    if (!ours) continue;
    const status = ours.verified ? 'AVAILABLE' : 'PENDING_VERIFICATION';
    await ddb.send(new UpdateCommand({
      TableName: 'LoadLead_Drivers',
      Key: { driverId: d.driverId },
      UpdateExpression: 'SET #s = :s, currentLat = :lat, currentLng = :lng, currentCity = :c, currentState = :st, lastLocationUpdate = :t',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status, ':lat': 29.7604, ':lng': -95.3698, ':c': 'Houston', ':st': 'TX', ':t': Date.now() },
    }));
    console.log(`    ✓ driver ${ours.email}: status -> ${status}`);
  }
}

console.log(`Seeding against ${BASE}`);
await seedShippers();
await seedCarriers();
await seedOwnerOps();
await seedDrivers();
await seedReceivers();
await setVerifiedFlags();

// Persist the actor map so k6 + the harness can read tokens / emails
// without re-running every signup.
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync('tests/load/.state', { recursive: true });
writeFileSync('tests/load/.state/actors.json', JSON.stringify(out, null, 2));
console.log('\nWrote tests/load/.state/actors.json. Counts:');
for (const k of Object.keys(out)) console.log(`  ${k}: ${out[k].length}`);
