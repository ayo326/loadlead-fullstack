/**
 * Seeds demo users with fixed credentials for frontend login testing.
 * Safe to run multiple times — skips if email already exists.
 */

const BASE = 'http://localhost:4000/api';

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json };
}

async function signup(email, password, role) {
  const r = await api('POST', '/auth/signup', { email, password, role });
  if (r.ok) return r.data;
  if (r.data?.message?.toLowerCase().includes('already')) {
    // already exists — just log in
    const login = await api('POST', '/auth/login', { email, password });
    return login.data;
  }
  throw new Error(`Signup failed: ${JSON.stringify(r.data)}`);
}

const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const tenYearsFromNow = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

console.log('\n🌱 Seeding demo users...\n');

// ── Admin ─────────────────────────────────────────────────────────────────────
const admin = await signup('admin@loadlead.dev', 'Password1!', 'ADMIN');
console.log(`✅ Admin     admin@loadlead.dev / Password1!  (userId: ${admin.user?.userId ?? admin.userId})`);

// ── Shipper ───────────────────────────────────────────────────────────────────
const shipper = await signup('shipper@loadlead.dev', 'Password1!', 'SHIPPER');
const shipperUserId = shipper.user?.userId ?? shipper.userId;
console.log(`✅ Shipper   shipper@loadlead.dev / Password1!  (userId: ${shipperUserId})`);

// Create shipper profile (idempotent — will 409 if already exists, that's fine)
const sp = await api('POST', '/shipper/profile', {
  companyName: 'Demo Freight Co',
  companyAddress: '100 W Randolph St, Chicago, IL 60601',
  contactName: 'Sam Shipper',
  contactPhone: '3125550100',
  contactEmail: 'shipper@loadlead.dev',
  defaultBroadcastRadius: 100,
  defaultMinMcMaturity: 0,
  orgId: 'org_demo',
  freightTypes: ['GENERAL', 'REFRIGERATED'],
  avgMonthlyVolume: 50,
  preferredEquipment: ['DRY_VAN', 'REEFER'],
  billingTerms: 'QUICK_PAY',
  legalName: 'Demo Freight Co LLC',
  city: 'Chicago',
  state: 'IL',
  zip: '60601',
  country: 'US',
}, shipper.token);
if (sp.ok) console.log('   └─ Shipper profile created');
else console.log(`   └─ Shipper profile: ${sp.data?.message ?? 'already exists'}`);

// ── Driver 1 (DRY_VAN) ────────────────────────────────────────────────────────
const driver1 = await signup('driver1@loadlead.dev', 'Password1!', 'DRIVER');
console.log(`✅ Driver 1  driver1@loadlead.dev / Password1!  (userId: ${driver1.user?.userId ?? driver1.userId})`);

const dp1 = await api('POST', '/driver/profile', {
  legalName: 'Dan Driver',
  fullName: 'Dan Driver',
  phone: '3125550101',
  licenseNumber: 'DL0000001',
  licenseState: 'IL',
  cdlClass: 'A',
  endorsements: [],
  experienceYears: 5,
  truckMake: 'Freightliner',
  truckModel: 'Cascadia',
  truckYear: 2022,
  truckVIN: '1FUJGBDV1CLBA0001',
  trailerType: 'DRY_VAN',
  trailerLength: 53,
  trailerWidth: 8.5,
  trailerHeight: 9,
  maxCapacityLbs: 44000,
  currentLoadLbs: 0,
  specialEquipment: [],
  mcNumber: 'MC100001',
  dotNumber: 'DOT200001',
  authorityStartDate: oneYearAgo,
  cargoInsuranceAmount: 100000,
  liabilityInsuranceAmount: 1000000,
  eldCompliant: true,
  hosAvailableHours: 11,
  currentCity: 'Chicago',
  currentState: 'IL',
  currentLat: 41.8781,
  currentLng: -87.6298,
  geohash: 'dp3wjz',
  carrierId: 'carrier_demo_1',
  driverType: 'OWNER_OPERATOR',
  dob: '1985-03-15',
  medicalCertExpiration: tenYearsFromNow,
  mcIssueDate: oneYearAgo,
}, driver1.token);

if (dp1.ok) {
  // Admin verify
  const driverId1 = dp1.data.driver.driverId;
  await api('POST', `/admin/drivers/${driverId1}/verify`, null, admin.token);
  console.log(`   └─ Driver 1 profile created + verified (DRY_VAN, Chicago) — driverId: ${driverId1}`);
} else {
  console.log(`   └─ Driver 1 profile: ${dp1.data?.message ?? 'already exists'}`);
}

// ── Driver 2 (REEFER) ─────────────────────────────────────────────────────────
const driver2 = await signup('driver2@loadlead.dev', 'Password1!', 'DRIVER');
console.log(`✅ Driver 2  driver2@loadlead.dev / Password1!  (userId: ${driver2.user?.userId ?? driver2.userId})`);

const dp2 = await api('POST', '/driver/profile', {
  legalName: 'Rita Reefer',
  fullName: 'Rita Reefer',
  phone: '3125550102',
  licenseNumber: 'DL0000002',
  licenseState: 'IL',
  cdlClass: 'A',
  endorsements: ['HAZMAT'],
  experienceYears: 8,
  truckMake: 'Kenworth',
  truckModel: 'T680',
  truckYear: 2021,
  truckVIN: '1FUJGBDV2CLBA0002',
  trailerType: 'REEFER',
  trailerLength: 53,
  trailerWidth: 8.5,
  trailerHeight: 9,
  maxCapacityLbs: 42000,
  currentLoadLbs: 0,
  specialEquipment: ['LIFTGATE'],
  mcNumber: 'MC100002',
  dotNumber: 'DOT200002',
  authorityStartDate: oneYearAgo,
  cargoInsuranceAmount: 150000,
  liabilityInsuranceAmount: 1000000,
  eldCompliant: true,
  hosAvailableHours: 10,
  currentCity: 'Naperville',
  currentState: 'IL',
  currentLat: 41.7508,
  currentLng: -88.1535,
  geohash: 'dp3rk5',
  carrierId: 'carrier_demo_2',
  driverType: 'OWNER_OPERATOR',
  dob: '1980-07-22',
  medicalCertExpiration: tenYearsFromNow,
  mcIssueDate: oneYearAgo,
}, driver2.token);

if (dp2.ok) {
  const driverId2 = dp2.data.driver.driverId;
  await api('POST', `/admin/drivers/${driverId2}/verify`, null, admin.token);
  console.log(`   └─ Driver 2 profile created + verified (REEFER, Naperville IL) — driverId: ${driverId2}`);
} else {
  console.log(`   └─ Driver 2 profile: ${dp2.data?.message ?? 'already exists'}`);
}

// ── Receiver ──────────────────────────────────────────────────────────────────
const receiver = await signup('receiver@loadlead.dev', 'Password1!', 'RECEIVER');
console.log(`✅ Receiver  receiver@loadlead.dev / Password1!  (userId: ${receiver.user?.userId ?? receiver.userId})`);

const rp = await api('POST', '/receiver/profile', {
  facilityName: 'Demo Distribution Center',
  facilityAddress: '100 S Capitol Ave, Indianapolis, IN 46201',
  contactName: 'Rachel Receiver',
  contactPhone: '3175550200',
  contactEmail: 'receiver@loadlead.dev',
  receivingHours: {
    monday: '08:00-17:00',
    tuesday: '08:00-17:00',
    wednesday: '08:00-17:00',
    thursday: '08:00-17:00',
    friday: '08:00-17:00',
    saturday: 'CLOSED',
    sunday: 'CLOSED',
  },
  specialInstructions: 'Call dock office 30 min before arrival.',
  appointmentRequired: true,
  dockType: 'REAR',
}, receiver.token);
if (rp.ok) console.log('   └─ Receiver profile created');
else console.log(`   └─ Receiver profile: ${rp.data?.message ?? 'already exists'}`);

// ── Seed an open load so the driver loadboard isn't empty ────────────────────
console.log('\n📦 Seeding a sample open load...');
const shipperProfile = await api('GET', '/shipper/profile', null, shipper.token);
if (shipperProfile.ok) {
  const draft = await api('POST', '/shipper/loads/draft', {
    referenceNumber: `DEMO-001`,
    equipmentType: 'DRY_VAN',
    loadSize: 'FULL',
    totalWeightLbs: 18000,
    pickupCity: 'Chicago',
    pickupState: 'IL',
    pickupZip: '60601',
    pickupAddress: '100 W Randolph St, Chicago, IL 60601',
    pickupLat: 41.8839,
    pickupLng: -87.6319,
    pickupDate: tomorrow,
    pickupTime: '09:00',
    pickupType: 'FCFS',
    deliveryCity: 'Indianapolis',
    deliveryState: 'IN',
    deliveryZip: '46201',
    deliveryAddress: '100 S Capitol Ave, Indianapolis, IN 46201',
    deliveryLat: 39.7684,
    deliveryLng: -86.1581,
    deliveryDate: tomorrow,
    deliveryTime: '17:00',
    deliveryType: 'LIVE_UNLOAD',
    totalMiles: 180,
    rateAmount: 2.75,
    rateType: 'PER_MILE',
    paymentTerms: 'QUICK_PAY',
    commodityDescription: 'Palletized consumer goods',
    stackable: true,
    fragile: false,
    highValue: false,
    hazmat: false,
    minMcMaturityDays: 0,
    minCargoInsurance: 50000,
    minLiabilityInsurance: 500000,
    requiredEndorsements: [],
    experienceRequired: 1,
    broadcastRadiusMiles: 150,
    offerTtlMinutes: 60,
  }, shipper.token);

  if (draft.ok) {
    const loadId = draft.data.load.loadId;
    await api('POST', `/shipper/loads/${loadId}/submit`, null, shipper.token);
    console.log(`✅ Sample load posted + broadcast → loadId: ${loadId}`);
    console.log(`   └─ Chicago → Indianapolis, DRY_VAN, 18,000 lbs, $2.75/mi`);
  } else {
    console.log(`   Load seed failed: ${JSON.stringify(draft.data)}`);
  }
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEMO LOGIN CREDENTIALS  →  http://localhost:3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Role       Email                    Password
  ─────────  ───────────────────────  ───────────
  Admin      admin@loadlead.dev       Password1!
  Shipper    shipper@loadlead.dev     Password1!
  Driver 1   driver1@loadlead.dev     Password1!  (DRY_VAN · Chicago)
  Driver 2   driver2@loadlead.dev     Password1!  (REEFER · Naperville IL)
  Receiver   receiver@loadlead.dev    Password1!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
