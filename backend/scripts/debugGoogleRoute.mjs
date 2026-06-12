import dotenv from "dotenv";
dotenv.config({ path: "backend/.env" });

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) {
  console.error("❌ GOOGLE_MAPS_API_KEY missing in backend/.env");
  process.exit(1);
}

const originText = process.argv[2];
const destText = process.argv[3];

if (!originText || !destText) {
  console.error('Usage:\nnode backend/scripts/debugGoogleRoute.mjs "ORIGIN" "DEST"');
  process.exit(1);
}

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  console.log("\n=== GEOCODE ===");
  console.log("address:", address);
  console.log("http:", res.status, "status:", data?.status, "error:", data?.error_message || "");
  const loc = data?.results?.[0]?.geometry?.location;
  return loc ? { lat: Number(loc.lat), lng: Number(loc.lng) } : null;
}

async function distanceMiles(o, d) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(`${o.lat},${o.lng}`)}&destinations=${encodeURIComponent(`${d.lat},${d.lng}`)}&mode=driving&units=imperial&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  console.log("\n=== DISTANCE MATRIX ===");
  console.log("http:", res.status, "status:", data?.status, "error:", data?.error_message || "");
  const el = data?.rows?.[0]?.elements?.[0];
  console.log("element status:", el?.status);
  const meters = Number(el?.distance?.value || 0);
  const miles = meters / 1609.344;
  return miles > 0 ? miles : null;
}

const origin = await geocode(originText);
const dest = await geocode(destText);

console.log("\norigin:", origin);
console.log("dest:", dest);

if (!origin || !dest) process.exit(0);

const miles = await distanceMiles(origin, dest);
console.log("\n✅ miles:", miles ? Math.round(miles * 10) / 10 : null);
