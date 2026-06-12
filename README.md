# LoadLead (Rideshare-Style Load Broadcast) — Full Stack (Backend + Frontend)

This repo is generated from your v3.1 reference files and adds:
- 4 roles (Admin, Shipper, Driver, Receiver) with hard route guards + backend role enforcement
- Rideshare-style broadcasting: loads are offered only to eligible drivers (radius + capacity + MC maturity + insurance + endorsements)
- 15-minute offer TTL with countdown in UI; auto-expiry on server filtering
- Capacity math: driver.maxCapacityLbs - driver.currentLoadLbs must cover load.totalWeightLbs

## 0) Prereqs
- Node.js 20+
- AWS CLI configured (optional if you run local-only)
- (Optional) DynamoDB Local if you don't want AWS yet

## 1) Run Backend (local)
```bash
cd backend
cp .env.example .env
# Fill .env with AWS credentials or local DynamoDB settings (see FINAL_IMPLEMENTATION_CHECKLIST.md)
npm install
npm run dev
# API at http://localhost:4000/api
```

## 2) Run Frontend (local)
```bash
cd ../frontend
cp .env.example .env.local
# set NEXT_PUBLIC_API_URL=http://localhost:4000/api
# set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
npm install
npm run dev
# UI at http://localhost:3000
```

## 3) Quick Test Flow
1) Sign up 4 accounts (Admin, Shipper, Driver, Receiver).
2) Driver: complete profile, set location + currentLoadLbs.
3) Shipper: create load, submit -> broadcast triggers.
4) Driver: load appears ONLY if eligible, with countdown; accept -> load booked.

## Notes
- Offer expiry is enforced by expiresAt checks server-side.
- Re-broadcast: when a driver updates location/load-status, backend attempts to match OPEN loads for that driver.


## Easiest way to run (from repo root)
```bash
npm install
npm run dev
```

This runs backend + frontend together using npm workspaces.
