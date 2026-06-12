/**
 * LoadLead End-to-End Matching Test
 *
 * Simulates the Uber/Lyft-style dispatch flow:
 *   1. Register 1 shipper + 3 drivers
 *   2. Post a load with specific variables
 *   3. Broadcast → only matching drivers receive offers
 *   4. Driver 1 accepts first → load is BOOKED
 *   5. Driver 2 still had an offer (proves simultaneous broadcast)
 *   6. Driver 3 was excluded (wrong equipment) → no offer
 */

const BASE = 'http://localhost:4000/api';
const log = (msg, data) => {
  console.log(`\n${msg}`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
};
const pass = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => { console.log(`  ❌ ${msg}`); process.exitCode = 1; };
const check = (condition, passMsg, failMsg) => condition ? pass(passMsg) : fail(failMsg);

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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// Unique suffix to avoid conflicts on re-runs
const uid = Date.now();

// ─── 1. Register users ────────────────────────────────────────────────────────
log('━━ STEP 1: Register admin + shipper + 3 drivers');

const adminAuth = await api('POST', '/auth/signup', {
  email: `admin_${uid}@test.com`,
  password: 'Test1234!',
  role: 'ADMIN',
});
pass(`Admin registered → userId: ${adminAuth.user.userId}`);

const shipperAuth = await api('POST', '/auth/signup', {
  email: `shipper_${uid}@test.com`,
  password: 'Test1234!',
  role: 'SHIPPER',
});
pass(`Shipper registered → userId: ${shipperAuth.user.userId}`);

const d1Auth = await api('POST', '/auth/signup', { email: `driver1_${uid}@test.com`, password: 'Test1234!', role: 'DRIVER' });
const d2Auth = await api('POST', '/auth/signup', { email: `driver2_${uid}@test.com`, password: 'Test1234!', role: 'DRIVER' });
const d3Auth = await api('POST', '/auth/signup', { email: `driver3_${uid}@test.com`, password: 'Test1234!', role: 'DRIVER' });
pass(`Driver 1 registered → userId: ${d1Auth.user.userId}`);
pass(`Driver 2 registered → userId: ${d2Auth.user.userId}`);
pass(`Driver 3 registered (will be excluded - wrong equipment) → userId: ${d3Auth.user.userId}`);

// ─── 2. Create profiles ───────────────────────────────────────────────────────
log('━━ STEP 2: Create profiles');

// Shipper profile
await api('POST', '/shipper/profile', {
  companyName: 'Test Freight Co',
  companyAddress: '100 Main St, Chicago, IL 60601',
  contactName: 'Test Shipper',
  contactPhone: '3125550001',
  contactEmail: `shipper_${uid}@test.com`,
  defaultBroadcastRadius: 100,
  defaultMinMcMaturity: 0,
  // ShipperProfiles required fields
  orgId: `org_${uid}`,
  freightTypes: ['GENERAL'],
  avgMonthlyVolume: 10,
  preferredEquipment: ['DRY_VAN'],
  billingTerms: 'NET_30',
}, shipperAuth.token);
pass('Shipper profile created');

const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const tenYearsFromNow = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

// Shared driver profile base — matches the load requirements
const driverBase = {
  legalName: 'Test Driver',
  phone: '3125550010',
  licenseNumber: 'D123456',
  licenseState: 'IL',
  cdlClass: 'A',
  endorsements: [],
  experienceYears: 3,
  truckMake: 'Freightliner',
  truckModel: 'Cascadia',
  truckYear: 2022,
  truckVIN: 'VIN0000000000000',
  trailerType: 'DRY_VAN',        // ← matches the load
  trailerLength: 53,
  trailerWidth: 8.5,
  trailerHeight: 9,
  maxCapacityLbs: 44000,
  currentLoadLbs: 0,
  specialEquipment: [],
  mcNumber: 'MC123456',
  dotNumber: 'DOT654321',
  authorityStartDate: oneYearAgo,
  cargoInsuranceAmount: 100000,
  liabilityInsuranceAmount: 1000000,
  eldCompliant: true,
  hosAvailableHours: 10,
  // Near Chicago — within broadcast radius of pickup
  currentCity: 'Chicago',
  currentState: 'IL',
  currentLat: 41.8781,
  currentLng: -87.6298,
  geohash: 'dp3wjz',
  // DriverProfiles required fields
  carrierId: `carrier_${uid}`,
  driverType: 'COMPANY',
  fullName: 'Test Driver',
  dob: '1985-01-01',
  medicalCertExpiration: tenYearsFromNow,
  mcIssueDate: oneYearAgo,
};

await api('POST', '/driver/profile', { ...driverBase, legalName: 'Driver One', phone: '3125550011', truckVIN: '1FUJGBDV1CLBP8011', mcNumber: 'MC111111' }, d1Auth.token);
pass('Driver 1 profile created (DRY_VAN, Chicago)');

await api('POST', '/driver/profile', { ...driverBase, legalName: 'Driver Two', phone: '3125550012', truckVIN: '1FUJGBDV2CLBP8022', mcNumber: 'MC222222' }, d2Auth.token);
pass('Driver 2 profile created (DRY_VAN, Chicago)');

// Driver 3: REEFER instead of DRY_VAN → should NOT match
await api('POST', '/driver/profile', {
  ...driverBase,
  legalName: 'Driver Three',
  phone: '3125550013',
  truckVIN: '1FUJGBDV3CLBP8033',
  mcNumber: 'MC333333',
  trailerType: 'REEFER',         // ← wrong equipment, will be excluded
}, d3Auth.token);
pass('Driver 3 profile created (REEFER — intentionally wrong equipment)');

// ─── 3. Admin verifies all drivers ───────────────────────────────────────────
log('━━ STEP 3: Admin verifies all 3 drivers (sets status → VERIFIED)');

// Get driver profiles to find driverIds
const d1Profile = await api('GET', '/driver/profile', null, d1Auth.token);
const d2Profile = await api('GET', '/driver/profile', null, d2Auth.token);
const d3Profile = await api('GET', '/driver/profile', null, d3Auth.token);

await api('POST', `/admin/drivers/${d1Profile.driver.driverId}/verify`, null, adminAuth.token);
await api('POST', `/admin/drivers/${d2Profile.driver.driverId}/verify`, null, adminAuth.token);
await api('POST', `/admin/drivers/${d3Profile.driver.driverId}/verify`, null, adminAuth.token);

pass(`Driver 1 verified → driverId: ${d1Profile.driver.driverId}`);
pass(`Driver 2 verified → driverId: ${d2Profile.driver.driverId}`);
pass(`Driver 3 verified → driverId: ${d3Profile.driver.driverId}`);

// ─── 4. Post a load (draft → submit) ─────────────────────────────────────────
log('━━ STEP 4: Shipper posts a load');

const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

const draft = await api('POST', '/shipper/loads/draft', {
  referenceNumber: `REF-${uid}`,
  equipmentType: 'DRY_VAN',       // ← Drivers 1 & 2 match; Driver 3 (REEFER) excluded
  loadSize: 'FULL',
  totalWeightLbs: 20000,          // well under 44000 max capacity
  pickupCity: 'Chicago',
  pickupState: 'IL',
  pickupZip: '60601',
  pickupAddress: '100 W Randolph St, Chicago, IL 60601',
  pickupLat: 41.8839,
  pickupLng: -87.6319,
  pickupDate: tomorrow,
  pickupTime: '08:00',
  pickupType: 'FCFS',
  deliveryCity: 'Indianapolis',
  deliveryState: 'IN',
  deliveryZip: '46201',
  deliveryAddress: '100 S Capitol Ave, Indianapolis, IN 46201',
  deliveryLat: 39.7684,
  deliveryLng: -86.1581,
  deliveryDate: tomorrow,
  deliveryTime: '16:00',
  deliveryType: 'LIVE_UNLOAD',
  totalMiles: 180,
  rateAmount: 2.50,
  rateType: 'PER_MILE',
  paymentTerms: 'QUICK_PAY',
  commodityDescription: 'General freight - palletized goods',
  stackable: true,
  fragile: false,
  highValue: false,
  hazmat: false,
  minMcMaturityDays: 0,           // no MC maturity requirement for this test
  minCargoInsurance: 50000,
  minLiabilityInsurance: 500000,
  requiredEndorsements: [],
  experienceRequired: 1,
  broadcastRadiusMiles: 100,      // 100-mile radius around Chicago
  offerTtlMinutes: 15,
}, shipperAuth.token);

const loadId = draft.load.loadId;
pass(`Load drafted → loadId: ${loadId}`);

// Submit (triggers broadcast)
await api('POST', `/shipper/loads/${loadId}/submit`, null, shipperAuth.token);
pass('Load submitted — broadcast triggered');

// Give the server a moment to create offers
await new Promise(r => setTimeout(r, 1000));

// ─── 5. Verify offers ─────────────────────────────────────────────────────────
log('━━ STEP 5: Verify who received offers');

const d1Loadboard = await api('GET', '/driver/loadboard', null, d1Auth.token);
const d2Loadboard = await api('GET', '/driver/loadboard', null, d2Auth.token);
const d3Loadboard = await api('GET', '/driver/loadboard', null, d3Auth.token);

const d1HasOffer = d1Loadboard.loads.some(l => l.load?.loadId === loadId);
const d2HasOffer = d2Loadboard.loads.some(l => l.load?.loadId === loadId);
const d3HasOffer = d3Loadboard.loads.some(l => l.load?.loadId === loadId);

check(d1HasOffer, 'Driver 1 received an offer (DRY_VAN ✓)', 'Driver 1 did NOT receive an offer — should have matched');
check(d2HasOffer, 'Driver 2 received an offer (DRY_VAN ✓)', 'Driver 2 did NOT receive an offer — should have matched');
check(!d3HasOffer, 'Driver 3 excluded — no offer (REEFER ✗)', 'Driver 3 received an offer — should have been excluded');

// ─── 6. Driver 1 accepts first (Uber/Lyft style) ─────────────────────────────
log('━━ STEP 6: Driver 1 accepts the offer first');

await api('POST', `/driver/offers/${loadId}/accept`, null, d1Auth.token);
pass('Driver 1 accepted the offer');

await new Promise(r => setTimeout(r, 500));

// ─── 7. Verify final state ────────────────────────────────────────────────────
log('━━ STEP 7: Verify final state');

const finalLoad = await api('GET', `/shipper/loads/${loadId}`, null, shipperAuth.token);
check(finalLoad.load.status === 'BOOKED', `Load status is BOOKED ✓`, `Load status is ${finalLoad.load.status} — expected BOOKED`);
check(finalLoad.load.assignedDriverId === d1Profile.driver.driverId, `Load assigned to Driver 1 ✓`, `Load assigned to wrong driver: ${finalLoad.load.assignedDriverId}`);

// Driver 2's offer should still exist (was broadcast simultaneously)
const d2Offer = await api('GET', `/driver/offers/${loadId}`, null, d2Auth.token);
check(d2Offer.offer !== null, 'Driver 2\'s offer record exists (simultaneous broadcast confirmed ✓)', 'Driver 2 has no offer record');

// Driver 2 trying to accept should now fail (load already taken)
log('━━ STEP 8: Driver 2 tries to accept — should fail (load already taken)');
try {
  await api('POST', `/driver/offers/${loadId}/accept`, null, d2Auth.token);
  fail('Driver 2 accepted — should have been rejected (race condition bug!)');
} catch (e) {
  pass(`Driver 2 rejected: "${e.message}" ✓ (first-come-first-serve enforced)`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
log('━━ TEST COMPLETE');
console.log(`
  Load ID:     ${loadId}
  Assigned to: Driver 1 (${d1Profile.driver.driverId})
  Load status: ${finalLoad.load.status}

  Matching behavior:
    Driver 1 (DRY_VAN, Chicago) → offered + accepted ✅
    Driver 2 (DRY_VAN, Chicago) → offered simultaneously, blocked after D1 accepted ✅
    Driver 3 (REEFER, Chicago)  → excluded by equipment mismatch ✅
`);
