# LoadLead — Real-Time Freight Broadcast Platform

> **Status: Partial (active development).** · **Last reconciled against commit `2054ab2` (2026-06-28).**
> This README is the entry point. It reflects the **code as it is**, not the original v3.1 reference files. Deeper, status-tagged docs live in [`/docs`](docs/) and are published to Confluence under *LoadLead Engineering Docs*.

LoadLead matches freight to capacity in real time: a shipper posts a load, the platform **broadcasts** it only to eligible drivers (radius + capacity + equipment + MC maturity + insurance + endorsements), and the first qualified driver to accept inside a **15-minute TTL** wins the load. The full chain — offer → accept → dispatch → in-transit → POD/signature → delivered — is enforced server-side.

---

## Personas & roles (the real model)

LoadLead has **two independent role systems** (this is a security boundary — see [Security Posture](docs/SecurityPosture.md)):

### 1. Freight personas — `UserRole` (`backend/src/types/index.ts`)
Five customer personas plus the platform `ADMIN`:

| Persona | `UserRole` | What they do |
|---|---|---|
| **Shipper** | `SHIPPER` | Post loads; reach verified carriers/drivers. |
| **Carrier** | `CARRIER_ADMIN` | Run a trucking **company**. Onboard drivers, dispatch loads. |
| **Owner Operator** | `OWNER_OPERATOR` | **Blended persona** — a carrier-parent org with a single *self-driver*: drives their own truck **and** manages their own small fleet. A self-driver record is auto-created at signup. |
| **Driver** | `DRIVER` | Accept loads matched to them. Must join a Carrier or Owner Operator to start hauling. |
| **Receiver** | `RECEIVER` | Track inbound deliveries; sign delivery receipts. |
| *(platform)* | `ADMIN` | Internal LoadLead staff account (see #2). Not a public persona. |

**Carrier = organization, not a user role.** A carrier is an **Org** with the `CARRIER` `OrgCapability` (`OrgCapability` = `CARRIER` / `SHIPPER` / `RECEIVER`). The user who runs it is `CARRIER_ADMIN`. Carrier-org membership has its **own** RBAC enum — `OrgRole` = `OWNER` / `MANAGER` / `DISPATCHER` / `ORG_DRIVER` / `SHIPPER_USER` / `RECEIVER_USER` (exact-match checks).

### 2. Platform-staff IAM — `PlatformRole` (`backend/src/types/platformRole.ts`)
A **separate enum**, deliberately disjoint from the carrier-org `OrgRole` (the staff "Manager" is **not** the tenant "Manager"):

`STAFF_ADMIN` · `STAFF_MANAGER` · `STAFF_SUPERVISOR` · `STAFF_TEAM_LEAD`

Staff are `Users` with `role = ADMIN` **plus** a `PlatformRole` tier. Tier checks are **exact-match, no substring** (`requireStaffTier`, `backend/src/middleware/auth.ts:84`). The internal console lives on a separate subdomain (`admin.loadleadapp.com`).

---

## Stack (verified against `package.json` / build config)

| Layer | Reality | Evidence |
|---|---|---|
| **Backend** | Node + **Express 4** + TypeScript 5; `ts-node-dev` in dev | `backend/package.json` |
| **Database** | **DynamoDB** (AWS) + S3 for documents/POD | `backend/src/config/database.ts` |
| **Frontend** | **React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui**, `react-router` 6 — in **`frontend-v2/`** | `frontend-v2/package.json` |
| **Hosting** | Elastic Beanstalk (API) + S3/CloudFront (two SPA bundles: customer + admin) | `deploy-*.sh` |

> ⚠️ **Delta to be aware of:** the root `package.json` still declares `workspaces: ["backend","frontend"]`, and a legacy **`frontend/`** (Next.js) directory remains in the repo. **The live frontend is `frontend-v2/` (Vite), not `frontend/`.** Do **not** use the root `npm run dev` for the UI — run `frontend-v2` directly as below. (The README's old Next.js / `localhost:3000` / `NEXT_PUBLIC_*` instructions were wrong.)

---

## Run it locally (verified commands)

**Prereqs:** Node 20+, AWS credentials (or DynamoDB Local), an `.env`.

### Backend → http://localhost:4000
```bash
cd backend
cp .env.example .env          # fill in the values below
npm install
npm run dev                   # ts-node-dev; API at http://localhost:4000/api
```
Key backend env vars (`backend/src/config/environment.ts`): `PORT` (default **4000** local, 8080 on EB), `JWT_SECRET`, `ALLOWED_ORIGINS` (CORS allowlist), `NODE_ENV`, AWS region/DynamoDB table config, integration keys (`GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, Didit/FMCSA keys), and the beta flags `BETA_MODE`, `TALLY_SIGNING_SECRET`, `BETA_FRONTEND_URL`. Never commit real values — see [Security Posture](docs/SecurityPosture.md).

### Frontend → http://localhost:5173
```bash
cd frontend-v2
npm install
npm run dev                   # Vite dev server at http://localhost:5173
```
Frontend env vars (Vite — note **`VITE_`** prefix, not `NEXT_PUBLIC_`): `VITE_API_URL` (e.g. `http://localhost:4000`), `VITE_GOOGLE_MAPS_API_KEY`.

The frontend builds **two bundles** from one codebase:
```bash
npm run build           # customer SPA  → dist/
npm run build:admin     # admin console → dist-admin/  (LL_BUILD=admin)
```

### Tests
```bash
cd backend && npm test          # vitest — ~355 backend test cases
cd frontend-v2 && npm test      # vitest
```

---

## Quick test flow
1. Sign up as a **Shipper** and as an **Owner Operator** (the OO auto-gets a self-driver).
2. Owner Operator: complete identity verification (IDV) + set the self-driver's location/equipment.
3. Shipper: post a load (origin/destination, equipment via the taxonomy dropdowns, weight) → submit triggers a **broadcast**.
4. The load appears **only** to eligible drivers with a 15-minute countdown; first qualified accept books it.
5. Driver delivers → captures **POD photo + signature** → load marked delivered.

---

## Feature summary (status-tagged; reconciled `2054ab2`)

| Area | Status | Notes |
|---|---|---|
| Five-persona freight model + Carrier-as-org | ✅ Done | `UserRole`, `OrgCapability`, `OrgRole` |
| Owner Operator (blended self-driver) | ✅ Done | self-driver auto-create at signup |
| Eligibility-aware broadcast + 15-min TTL | ✅ Done | server-side matching + expiry |
| Carrier-of-record resolver + verification gates | ✅ Done | `services/carrierOfRecord.ts`; per-driver `idvStatus` |
| Attestation / signature + POD chain | 🟡 Partial | capture works; **WORM/Object-Lock pending** |
| Two-level IAM (personas + platform staff) | ✅ Done | separate enums, exact-match |
| Admin console (Operations / Beta Program / Settings) | ✅ Done | `admin.loadleadapp.com`, MFA + IP allowlist |
| Private beta gate + waitlist + Tally pipeline | ✅ Done | `requireBetaGate`, `/api/admin/beta/*`, HMAC webhook |
| Integrations: Maps / Resend email | ✅ Done | Didit/FMCSA 🟡 partial/stubbed in non-prod |
| Glass design system (admin + customer + landing) | ✅ Done | shared tokens; restyle only |
| STIG LL-* control attestation | 🔴 Pending | checklist authored; **statuses "Not Reviewed"** |

See the [**Pending Register**](docs/PendingRegister.md) for everything Partial/Pending, go-live blockers first.

---

## Documentation map (`/docs`)
| Doc | What it covers |
|---|---|
| [System Overview](docs/SystemOverview.md) | Plain-language: personas, load lifecycle |
| [Architecture — Backend](docs/Architecture_Backend.md) | Services, data model, auth, resolver, integrations |
| [Architecture — Frontend](docs/Architecture_Frontend.md) | Vite app structure, persona apps, admin console |
| [Data & API Reference](docs/Data_API_Reference.md) | Entities + `/api/*` routes with auth/role gating |
| [**Security Posture**](docs/SecurityPosture.md) | CISO assessment: metrics, threat model, risk register |
| [**Pending Register**](docs/PendingRegister.md) | Consolidated Partial/Pending, blockers first |

> Docs are published one-way (repo → Confluence) by the `publish-docs` workflow. Every major section carries a status badge + a "last reconciled against commit" stamp.
