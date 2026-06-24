#!/usr/bin/env node
// Direct DDB seeder. Bypasses the auth rate limiter -- needed because
// we have 13+ accounts to provision in one shot and /api/auth/signup
// has a 15/15min throttle that's correct in production but breaks E2E
// setup.
//
// Writes User + DriverProfile / Shipper / Receiver / Org / Membership
// rows directly into DynamoDB Local with the bcrypt-hashed test
// password 'TestPassword123!' so the same accounts can later log in
// through the REST API.
//
// Idempotent: deletes any existing row with the same userId before
// re-writing. Refuses to run against prod.

import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';
if (!/127\.0\.0\.1|localhost/.test(ENDPOINT) && !process.env.I_REALLY_MEAN_PROD) {
  console.error(`Refusing: DYNAMODB_ENDPOINT=${ENDPOINT} doesn't look like local.`);
  process.exit(2);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: 'us-east-1',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
}));

const PW_HASH = bcrypt.hashSync('TestPassword123!', 10);

const userId  = (slug) => `user_${slug}_${randomUUID().slice(0, 8)}`;
const drvId   = (slug) => `driver_${slug}_${randomUUID().slice(0, 8)}`;
const orgId   = (slug) => `org_${slug}_${randomUUID().slice(0, 8)}`;
const mbrId   = (slug) => `mbr_${slug}_${randomUUID().slice(0, 8)}`;
const shipId  = (slug) => `shipper_${slug}_${randomUUID().slice(0, 8)}`;
const rcvId   = (slug) => `receiver_${slug}_${randomUUID().slice(0, 8)}`;

async function wipeByEmail(table, email) {
  const all = await ddb.send(new ScanCommand({ TableName: table }));
  for (const row of all.Items ?? []) {
    if (row.email === email) {
      const pk = Object.keys(row).find((k) => /Id$/.test(k));
      await ddb.send(new DeleteCommand({ TableName: table, Key: { [pk]: row[pk] } }));
    }
  }
}

async function putUser(email, role, firstName, lastName) {
  await wipeByEmail('LoadLead_Users', email);
  const uid = userId(role.toLowerCase().slice(0, 3));
  const now = Date.now();
  await ddb.send(new PutCommand({ TableName: 'LoadLead_Users', Item: {
    userId: uid, email, role,
    password: PW_HASH, passwordHash: PW_HASH,
    firstName, lastName, fullName: `${firstName} ${lastName}`,
    status: 'ACTIVE',
    idvStatus: 'VERIFIED',
    createdAt: now, updatedAt: now,
  }}));
  return uid;
}

const out = { shippers: [], carriers: [], ownerOps: [], drivers: [], receivers: [] };

// ── shippers ───────────────────────────────────────────────────────────────
for (const s of [
  { email: 'shipper.k6.s1@loadleadapp.com', fn: 'K6', ln: 'Shipper1' },
  { email: 'shipper.k6.s2@loadleadapp.com', fn: 'K6', ln: 'Shipper2' },
]) {
  const uid = await putUser(s.email, 'SHIPPER', s.fn, s.ln);
  await wipeByEmail('LoadLead_Shippers', s.email);
  await ddb.send(new PutCommand({ TableName: 'LoadLead_Shippers', Item: {
    shipperId: shipId(s.ln), userId: uid, email: s.email,
    companyName: `${s.fn} ${s.ln} Shipping`, companyAddress: '100 Test Way, Houston, TX 77001',
    contactName: `${s.fn} ${s.ln}`, contactPhone: '+15555550101', contactEmail: s.email,
    isAdmin: false, createdAt: Date.now(), updatedAt: Date.now(),
  }}));
  out.shippers.push({ email: s.email, userId: uid });
  console.log(`  ✓ shipper ${s.email}`);
}

// ── carriers ───────────────────────────────────────────────────────────────
for (const c of [
  { email: 'carrier.k6.c1@loadleadapp.com', fn: 'K6', ln: 'Carrier1', legal: 'K6 Carrier 1 LLC', mc: 'MCK61', verified: true },
  { email: 'carrier.k6.c2@loadleadapp.com', fn: 'K6', ln: 'Carrier2', legal: 'K6 Carrier 2 LLC', mc: 'MCK62', verified: false },
]) {
  const uid = await putUser(c.email, 'CARRIER_ADMIN', c.fn, c.ln);
  // OrgService.createOrg creates Organisations + Memberships tables which
  // may not exist locally yet; skip those tables here -- the test will
  // exercise org creation via the API when needed.
  out.carriers.push({ email: c.email, userId: uid, legal: c.legal, mc: c.mc, verified: c.verified });
  console.log(`  ✓ carrier ${c.email} (verified=${c.verified})`);
}

// ── owner operators ────────────────────────────────────────────────────────
for (const o of [
  { email: 'oo.k6.o1@loadleadapp.com', fn: 'K6', ln: 'OwnerOp1', equipment: 'DRY_VAN', verified: true },
  { email: 'oo.k6.o2@loadleadapp.com', fn: 'K6', ln: 'OwnerOp2', equipment: 'HAZMAT',  verified: false },
]) {
  const uid = await putUser(o.email, 'OWNER_OPERATOR', o.fn, o.ln);
  // OO gets a self-driver row too
  const dId = drvId(o.ln);
  await wipeByEmail('LoadLead_Drivers', o.email);
  await ddb.send(new PutCommand({ TableName: 'LoadLead_Drivers', Item: {
    driverId: dId, userId: uid, fullName: `${o.fn} ${o.ln}`,
    mcNumber: `MC${o.ln}`, dotNumber: `DOT${o.ln}`,
    trailerType: o.equipment, maxCapacityLbs: 41000, currentLoadLbs: 0, safetyBufferPct: 10,
    cargoInsuranceAmount: 100000, liabilityInsuranceAmount: 1000000,
    authorityStartDate: Date.now() - 365 * 86_400_000,
    currentLat: 29.7604, currentLng: -95.3698, currentCity: 'Houston', currentState: 'TX',
    lastLocationUpdate: Date.now(),
    status: o.verified ? 'AVAILABLE' : 'PENDING_VERIFICATION',
    isSelf: true,
    createdAt: Date.now(), updatedAt: Date.now(),
  }}));
  out.ownerOps.push({ email: o.email, userId: uid, driverId: dId, equipment: o.equipment, verified: o.verified });
  console.log(`  ✓ owner-op ${o.email} (${o.equipment}, verified=${o.verified})`);
}

// ── drivers ────────────────────────────────────────────────────────────────
for (const d of [
  { email: 'driver.k6.d1@loadleadapp.com', fn: 'K6', ln: 'Driver1', eq: 'DRY_VAN',  parent: 'C1', verified: true },
  { email: 'driver.k6.d2@loadleadapp.com', fn: 'K6', ln: 'Driver2', eq: 'REEFER',   parent: 'C1', verified: true },
  { email: 'driver.k6.d3@loadleadapp.com', fn: 'K6', ln: 'Driver3', eq: 'FLATBED',  parent: 'C2', verified: false },
  { email: 'driver.k6.d5@loadleadapp.com', fn: 'K6', ln: 'Driver5', eq: 'HAZMAT',   parent: 'O2', verified: false },
  { email: 'driver.k6.d6@loadleadapp.com', fn: 'K6', ln: 'Driver6', eq: 'DRY_VAN',  parent: 'C1', verified: true },
  { email: 'driver.k6.d7@loadleadapp.com', fn: 'K6', ln: 'Driver7', eq: 'DRY_VAN',  parent: null, verified: false },
]) {
  const uid = await putUser(d.email, 'DRIVER', d.fn, d.ln);
  const dId = drvId(d.ln);
  await ddb.send(new PutCommand({ TableName: 'LoadLead_Drivers', Item: {
    driverId: dId, userId: uid, fullName: `${d.fn} ${d.ln}`,
    mcNumber: `MC${d.ln}`, dotNumber: `DOT${d.ln}`,
    trailerType: d.eq, maxCapacityLbs: 41000, currentLoadLbs: 0, safetyBufferPct: 10,
    cargoInsuranceAmount: 100000, liabilityInsuranceAmount: 1000000,
    authorityStartDate: Date.now() - 365 * 86_400_000,
    currentLat: 29.7604, currentLng: -95.3698, currentCity: 'Houston', currentState: 'TX',
    lastLocationUpdate: Date.now(),
    status: d.verified ? 'AVAILABLE' : 'PENDING_VERIFICATION',
    isSelf: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  }}));
  out.drivers.push({ email: d.email, userId: uid, driverId: dId, equipment: d.eq, parent: d.parent, verified: d.verified });
  console.log(`  ✓ driver ${d.email} (${d.eq}, parent=${d.parent ?? '-'}, verified=${d.verified})`);
}

// ── receivers ──────────────────────────────────────────────────────────────
for (const r of [
  { email: 'receiver.k6.r1@loadleadapp.com', fn: 'K6', ln: 'Receiver1' },
  { email: 'receiver.k6.r2@loadleadapp.com', fn: 'K6', ln: 'Receiver2' },
]) {
  const uid = await putUser(r.email, 'RECEIVER', r.fn, r.ln);
  const rid = rcvId(r.ln);
  await wipeByEmail('LoadLead_Receivers', r.email);
  await ddb.send(new PutCommand({ TableName: 'LoadLead_Receivers', Item: {
    receiverId: rid, userId: uid, email: r.email,
    facilityName: `${r.fn}-${r.ln} Receiving`, address: '200 Dock Rd, Atlanta, GA 30301',
    contactName: `${r.fn} ${r.ln}`, contactPhone: '+15555550103',
    createdAt: Date.now(), updatedAt: Date.now(),
  }}));
  out.receivers.push({ email: r.email, userId: uid, receiverId: rid });
  console.log(`  ✓ receiver ${r.email}`);
}

mkdirSync('tests/load/.state', { recursive: true });
writeFileSync('tests/load/.state/actors.json', JSON.stringify(out, null, 2));
console.log(`\nSeeded ${out.shippers.length}S + ${out.carriers.length}C + ${out.ownerOps.length}OO + ${out.drivers.length}D + ${out.receivers.length}R`);
console.log('Wrote tests/load/.state/actors.json');
