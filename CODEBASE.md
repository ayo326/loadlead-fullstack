# LoadLead — Codebase & Feature Reference

> **Freight, Dispatched Live** — A full-stack SaaS freight-matching platform.  
> Live at **[loadleadapp.com](https://loadleadapp.com)** · API at **[api.loadleadapp.com](https://api.loadleadapp.com)**

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Infrastructure](#2-infrastructure)
3. [User Roles](#3-user-roles)
4. [Backend](#4-backend)
5. [Frontend](#5-frontend)
6. [Features by Role](#6-features-by-role)
7. [Database Schema (DynamoDB Tables)](#7-database-schema-dynamodb-tables)
8. [API Reference](#8-api-reference)
9. [Authentication & Security](#9-authentication--security)
10. [Email System](#10-email-system)
11. [Admin Bootstrap Flow](#11-admin-bootstrap-flow)
12. [Deployment](#12-deployment)
13. [Environment Variables](#13-environment-variables)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Browser                        │
│          React 18 + Vite + TypeScript + shadcn/ui            │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
                ┌───────────▼───────────┐
                │   CloudFront CDN      │
                │  (E38CZNP7L2DB98)     │
                └───────────┬───────────┘
                            │
                ┌───────────▼───────────┐
                │   S3 Static Hosting   │
                │ loadlead-frontend-prod│
                └───────────────────────┘

                            │ HTTPS api.loadleadapp.com
                ┌───────────▼───────────┐
                │  Elastic Beanstalk    │
                │  loadlead-backend-prod│
                │  Node.js / Express    │
                └───────────┬───────────┘
                            │
                ┌───────────▼───────────┐
                │  AWS DynamoDB         │
                │  us-east-1            │
                └───────────────────────┘
```

---

## 2. Infrastructure

| Component | Service | Detail |
|---|---|---|
| Frontend hosting | AWS S3 + CloudFront | Bucket: `loadlead-frontend-prod` · Distribution: `E38CZNP7L2DB98` |
| Backend hosting | AWS Elastic Beanstalk | App: `loadlead-backend` · Env: `loadlead-backend-prod` |
| Database | AWS DynamoDB | Region: `us-east-1` · On-demand billing |
| Email delivery | Resend | From: `noreply@loadleadapp.com` |
| SSL certificate | AWS ACM | `arn:aws:acm:us-east-1:552011299815:certificate/6d35e9ce-…` (covers `loadleadapp.com`) |
| Push notifications | Web Push API | `web-push` library, VAPID keys in env |
| File storage | AWS S3 | Bucket: `loadlead-pod-uploads` (BOL attachments, headshots) |

---

## 3. User Roles

| Role | Key | Description |
|---|---|---|
| **Owner Operator** | `OWNER_OPERATOR` | Independent truck owner. Can drive, manage fleet drivers, see shipper fan-out loads. Standalone — not part of the org system. |
| **Driver** | `DRIVER` | Receives load offers matched by radius, equipment, CDL class, and MC maturity. |
| **Shipper** | `SHIPPER` | Posts loads and broadcasts to qualified drivers. Creates/owns an organisation. |
| **Receiver** | `RECEIVER` | Tracks inbound deliveries, signs BOLs digitally. Creates/owns an organisation. |
| **Admin** | `ADMIN` | Platform-wide oversight. Cannot self-register — must use the bootstrap flow. |

### Org IAM Roles (within an organisation)

| Role | Key | Who assigns it |
|---|---|---|
| Owner | `OWNER` | Auto-assigned to account creator |
| Org Admin | `ORG_ADMIN` | OWNER |
| Dispatcher | `DISPATCHER` | OWNER, ORG_ADMIN |
| Org Driver | `ORG_DRIVER` | OWNER, ORG_ADMIN, DISPATCHER |
| Shipper User | `SHIPPER_USER` | OWNER, ORG_ADMIN |
| Receiver User | `RECEIVER_USER` | OWNER, ORG_ADMIN |

---

## 4. Backend

### Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Language | TypeScript 5 |
| ORM | AWS SDK v3 (`@aws-sdk/lib-dynamodb` Document Client) |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Validation | `express-validator` |
| Email | Resend SDK |
| Push | `web-push` (VAPID) |
| Geo | `geolib`, `latlon-geohash` |
| Maps | Google Maps Routes API |

### Directory Structure

```
backend/src/
├── config/
│   ├── aws.ts              # DynamoDB, S3, Cognito clients
│   ├── database.ts         # Database wrapper (get/put/update/delete/query/scan)
│   └── environment.ts      # Typed env config
├── middleware/
│   ├── auth.ts             # JWT authenticate, requireRole, requireOwnerOperator
│   ├── errorHandler.ts     # asyncHandler wrapper + global error handler
│   └── validation.ts       # express-validator middleware
├── routes/
│   ├── auth.ts             # /api/auth/*
│   ├── setup.ts            # /api/setup/*  (admin bootstrap)
│   ├── driver.ts           # /api/driver/*
│   ├── shipper.ts          # /api/shipper/*
│   ├── receiver.ts         # /api/receiver/*
│   ├── admin.ts            # /api/admin/*
│   ├── org.ts              # /api/org/*
│   ├── ownerOperator.ts    # /api/owner-operator/*
│   ├── bol.ts              # /api/bol/*
│   ├── maps.ts             # /api/maps/*
│   └── notifications.ts    # /api/notifications/*
├── services/
│   ├── authService.ts
│   ├── driverService.ts
│   ├── shipperService.ts
│   ├── receiverService.ts
│   ├── loadService.ts
│   ├── offerService.ts
│   ├── orgService.ts
│   ├── ownerOperatorService.ts
│   ├── broadcastService.ts     # Fan-out load offers to eligible drivers
│   ├── capacityService.ts      # Driver capacity buffer management
│   ├── bolService.ts           # Bill of Lading lifecycle
│   ├── emailService.ts         # Transactional emails via Resend
│   ├── pushService.ts          # Web push notifications
│   ├── trackingService.ts      # Real-time GPS tracking
│   ├── geolocationService.ts   # Geohash-based proximity queries
│   ├── googleMapsService.ts    # Route distance/duration
│   ├── routingService.ts       # Load routing logic
│   └── equipmentService.ts     # Equipment/trailer type matching
└── types/index.ts              # All TypeScript interfaces & enums
```

---

## 5. Frontend

### Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + Vite |
| Language | TypeScript 5 |
| Routing | React Router v6 |
| UI components | shadcn/ui (Radix UI primitives) |
| Styling | Tailwind CSS v3 |
| State | React Context + TanStack Query |
| Forms | React Hook Form + Zod |
| Icons | lucide-react |
| Charts | Recharts |
| Notifications | Sonner (toasts) |

### Directory Structure

```
frontend-v2/src/
├── App.tsx                         # Root router, role-based guards
├── contexts/
│   └── AuthContext.tsx             # useAuth hook, JWT storage, signup/login/logout
├── layouts/
│   └── AppLayout.tsx               # Collapsible sidebar + top header
├── lib/
│   ├── api.ts                      # All API calls (typed fetch wrappers)
│   ├── geolocation.ts              # Browser GPS helpers
│   └── pushNotifications.ts        # Service worker + VAPID subscription
├── pages/
│   ├── Landing.tsx                 # Public marketing page
│   ├── Login.tsx                   # Split-screen login with role selector
│   ├── Signup.tsx                  # 3-step wizard (role → org → account)
│   ├── SetupAdmin.tsx              # /setup/admin?token= (one-time admin setup)
│   ├── AcceptInvite.tsx            # /accept-invite?token= (org invite)
│   ├── ResetPassword.tsx           # Forgot / reset password
│   ├── driver/
│   │   ├── DriverDashboard.tsx     # Live load offers with countdown
│   │   └── LoadDetail.tsx          # Full load details + accept/decline
│   ├── shipper/
│   │   ├── ShipperDashboard.tsx    # Load list + post button
│   │   ├── PostLoad.tsx            # Load creation form
│   │   └── LoadDetail.tsx          # Load tracking + offer management
│   ├── receiver/
│   │   ├── ReceiverDashboard.tsx   # Inbound shipments
│   │   └── LoadDetail.tsx          # BOL + signature
│   ├── owner-operator/
│   │   ├── OwnerOperatorDashboard.tsx  # Fleet + load offers
│   │   └── OwnerOperatorSettings.tsx  # Profile, authority, fleet management
│   ├── admin/
│   │   └── AdminDashboard.tsx      # Platform overview
│   ├── settings/
│   │   └── SettingsPage.tsx        # Profile, notifications, equipment
│   └── bol/
│       └── BillOfLadingPage.tsx    # BOL viewer + digital signature
└── components/
    ├── Logo.tsx                    # LoadLead truck logo (links to homepage)
    ├── Countdown.tsx               # Offer TTL countdown timer
    ├── ErrorBoundary.tsx
    └── ui/                         # shadcn/ui component library
```

---

## 6. Features by Role

### 🚛 Owner Operator
- Standalone profile (independent of org system)
- Own truck details: make, model, year, VIN, trailer type, max capacity
- Authority info: MC#, DOT#, CDL class, endorsements
- Insurance: cargo & liability amounts, certificate upload
- **Fleet management**: invite drivers by email → `LoadLead_FleetInvites` table → 168hr token
- **Loadboard**: sees aggregated load offers across all fleet driver IDs
- Settings page: Profile tab + Fleet tab with pending invite countdown

### 🚚 Driver
- Profile: equipment, CDL class, endorsements, home location
- Live offer dashboard with **15-minute countdown timer**
- Accept / decline offers in real time
- Load detail: route map, shipper contact, BOL access
- Push notifications for new load offers

### 📦 Shipper
- Organisation setup during signup (multi-step wizard)
- Post loads: origin, destination, weight, equipment type, freight format, pickup/dropoff windows
- **Broadcast fan-out**: load is pushed to all eligible drivers in radius
- Real-time offer tracking (who accepted, who declined)
- Load status lifecycle: DRAFT → BROADCAST → ACCEPTED → PICKED_UP → IN_TRANSIT → DELIVERED
- Admin request flow (org-level elevated access)
- Load tracking view

### 🏭 Receiver
- Organisation setup during signup
- Inbound shipment dashboard with live ETAs
- Digital BOL signing
- Delivery confirmation

### 🛡️ Admin
- Driver management: verify, suspend, adjust capacity buffer
- Shipper management: approve/revoke admin requests
- Load oversight: view all loads, change status
- **Cannot self-register** — must use the one-time bootstrap flow

### 🏢 Organisation System
- Org creation tied to Shipper/Receiver signup
- Capabilities: CARRIER, SHIPPER, RECEIVER (multi-select)
- IAM roles within org: OWNER → ORG_ADMIN → DISPATCHER → ORG_DRIVER / SHIPPER_USER / RECEIVER_USER
- Invite members by email (72hr token, burned on accept)
- Membership audit log

---

## 7. Database Schema (DynamoDB Tables)

| Table | Partition Key | Sort Key | GSIs |
|---|---|---|---|
| `LoadLead_Users` | `userId` | — | `email-index` |
| `LoadLead_Drivers` | `driverId` | — | `userId-index` |
| `LoadLead_Shippers` | `shipperId` | — | `userId-index` |
| `LoadLead_Receivers` | `receiverId` | — | `userId-index` |
| `LoadLead_Organizations` | `orgId` | — | — |
| `LoadLead_OrgMemberships` | `membershipId` | — | `orgId-index`, `userId-index` |
| `LoadLead_OrgInvitations` | `inviteId` | — | `orgId-index`, `token-index` |
| `LoadLead_Loads` | `loadId` | — | `shipperId-index`, `status-index` |
| `LoadLead_Offers` | `offerId` | — | `loadId-index`, `driverId-index` |
| `LoadLead_BOLs` | `bolId` | — | `loadId-index` |
| `LoadLead_OwnerOperators` | `operatorId` | — | `userId-index` |
| `LoadLead_FleetInvites` | `inviteId` | — | `operatorId-index`, `token-index` |
| `LoadLead_PasswordResets` | `token` | — | — |
| `LoadLead_SetupTokens` | `token` | — | — |
| `LoadLead_MembershipAuditLogs` | `logId` | — | `orgId-index` |
| `LoadLead_PushSubscriptions` | `subscriptionId` | — | `userId-index` |

---

## 8. API Reference

### Auth — `/api/auth`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/signup` | Public | Create account (+ org if Shipper/Receiver) |
| POST | `/login` | Public | Email + password → JWT |
| GET | `/me` | JWT | Current user profile |
| PATCH | `/me` | JWT | Update display name / phone |
| POST | `/forgot-password` | Public | Send password reset email |
| POST | `/reset-password` | Public | Validate token + set new password |

### Admin Bootstrap — `/api/setup`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/status` | Public | `{ adminExists: boolean }` |
| POST | `/request` | Public | Check no admin → email setup link (24hr token) |
| POST | `/complete` | Public | Validate token → create ADMIN account → burn token |

### Driver — `/api/driver`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/profile` | DRIVER | Create driver profile |
| GET | `/profile` | DRIVER | Get own profile |
| PUT | `/profile` | DRIVER | Update profile |
| GET | `/offers` | DRIVER | Active load offers |
| POST | `/offers/:offerId/accept` | DRIVER | Accept offer |
| POST | `/offers/:offerId/decline` | DRIVER | Decline offer |
| GET | `/loads` | DRIVER | Own loads |
| GET | `/loads/:loadId` | DRIVER | Load detail |
| POST | `/loads/:loadId/pickup` | DRIVER | Mark picked up |
| POST | `/loads/:loadId/deliver` | DRIVER | Mark delivered |
| POST | `/location` | DRIVER | Update GPS position |

### Shipper — `/api/shipper`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/profile` | SHIPPER | Create shipper profile |
| GET | `/profile` | SHIPPER | Get profile |
| PUT | `/profile` | SHIPPER | Update profile |
| POST | `/loads/draft` | SHIPPER | Create load draft |
| POST | `/loads/:loadId/submit` | SHIPPER | Submit → broadcast |
| GET | `/loads` | SHIPPER | All own loads |
| GET | `/loads/:loadId` | SHIPPER | Load detail + offers |
| PUT | `/loads/:loadId` | SHIPPER | Update draft |
| DELETE | `/loads/:loadId` | SHIPPER | Delete draft |
| GET | `/loads/:loadId/tracking` | SHIPPER | Real-time tracking |
| POST | `/admin-request` | SHIPPER | Request org admin elevation |

### Receiver — `/api/receiver`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/profile` | RECEIVER | Create profile |
| GET | `/profile` | RECEIVER | Get profile |
| PUT | `/profile` | RECEIVER | Update profile |
| GET | `/loads` | RECEIVER | Inbound shipments |
| GET | `/loads/:loadId` | RECEIVER | Load detail |
| POST | `/loads/:loadId/sign` | RECEIVER | Sign BOL (digital signature) |

### Owner Operator — `/api/owner-operator`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/profile` | OWNER_OPERATOR | Create profile |
| GET | `/profile` | OWNER_OPERATOR | Get profile |
| PUT | `/profile` | OWNER_OPERATOR | Update profile |
| GET | `/loadboard` | OWNER_OPERATOR | Aggregated offers for fleet |
| GET | `/fleet` | OWNER_OPERATOR | Fleet driver list |
| DELETE | `/fleet/:driverId` | OWNER_OPERATOR | Remove fleet driver |
| POST | `/fleet/invite` | OWNER_OPERATOR | Invite driver by email (168hr token) |
| GET | `/fleet/invites` | OWNER_OPERATOR | Pending fleet invites |

### Organisation — `/api/org`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | JWT | Get user's org |
| PUT | `/` | OWNER/ORG_ADMIN | Update org details |
| GET | `/members` | Org member | List members |
| POST | `/invite` | OWNER/ORG_ADMIN | Invite by email (72hr token) |
| POST | `/accept-invite` | Public | Accept org invitation |
| DELETE | `/members/:userId` | OWNER/ORG_ADMIN | Remove member |
| PATCH | `/members/:userId/role` | OWNER | Change member role |

### Admin — `/api/admin`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/drivers` | ADMIN | All drivers |
| GET | `/drivers/:driverId` | ADMIN | Driver detail |
| POST | `/drivers/:driverId/verify` | ADMIN | Verify driver |
| POST | `/drivers/:driverId/suspend` | ADMIN | Suspend driver |
| PATCH | `/drivers/:driverId/buffer` | ADMIN | Adjust capacity buffer |
| GET | `/drivers/:driverId/buffer` | ADMIN | Get buffer status |
| GET | `/shippers/admin-requests` | ADMIN | Pending admin requests |
| POST | `/shippers/:shipperId/approve-admin` | ADMIN | Approve admin request |
| POST | `/shippers/:shipperId/revoke-admin` | ADMIN | Revoke admin access |
| GET | `/loads` | ADMIN | All platform loads |
| GET | `/loads/:loadId` | ADMIN | Load detail |
| PUT | `/loads/:loadId/status` | ADMIN | Override load status |
| GET | `/loads/:loadId/tracking` | ADMIN | Full tracking history |

### Bill of Lading — `/api/bol`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/loads/:loadId` | SHIPPER | Create BOL |
| GET | `/loads/:loadId` | JWT | Get BOL |
| PATCH | `/loads/:loadId` | SHIPPER/DRIVER | Update BOL |
| POST | `/loads/:loadId/sign` | DRIVER/RECEIVER | Add digital signature |
| GET | `/loads/:loadId/pdf` | JWT | Generate PDF |

---

## 9. Authentication & Security

- **JWT** tokens issued on login, stored in `localStorage`, sent as `Authorization: Bearer <token>`
- **bcrypt** (12 rounds) for password hashing
- **Role guards**: `requireRole(UserRole.X)` middleware on protected routes
- **CORS**: explicit allowlist via `ALLOWED_ORIGINS` env var
- **Password reset**: 1-hour single-use token → `LoadLead_PasswordResets`
- **Admin bootstrap**: 24-hour single-use token → `LoadLead_SetupTokens`, burned after first use, endpoint becomes inert once any admin exists
- **`.env` excluded** from EB deployment zip via `.ebignore`

---

## 10. Email System

All emails sent via **Resend** from `noreply@loadleadapp.com`.

| Trigger | Template |
|---|---|
| Signup | Role-specific welcome with CTA link |
| Load matched to driver | Load details + Accept Load button |
| Driver accepted offer | Notification to shipper |
| Delivery confirmed | BOL link to shipper |
| Org invitation | Accept invite link (72hr) |
| Fleet invite (Owner Operator) | Driver invite link (168hr) |
| Password reset | Secure reset link (1hr) |
| Admin setup request | One-time setup link (24hr) |

---

## 11. Admin Bootstrap Flow

No public signup for ADMIN role. The flow:

```
1. User visits loadleadapp.com
2. Scrolls to "Need admin access?" section (hidden once any admin exists)
3. Submits name + email
4. Backend checks: adminExists? NO → generates 40-byte hex token → stores in LoadLead_SetupTokens (24hr TTL)
5. Resend sends email: "Complete Admin Setup" → https://loadleadapp.com/setup/admin?token=<token>
6. User clicks link → /setup/admin page → sets password → POST /api/setup/complete
7. Backend: validates token, checks adminExists again (race-safe), creates ADMIN user, burns token
8. Token can never be reused. Subsequent /api/setup/request calls return 409.
```

---

## 12. Deployment

### Frontend
```bash
cd frontend-v2
npm run build                                        # Vite build → dist/
aws s3 sync dist s3://loadlead-frontend-prod --delete
aws cloudfront create-invalidation \
  --distribution-id E38CZNP7L2DB98 --paths "/*"
```

### Backend
```bash
cd backend
npm run build                                        # tsc → dist/
zip -r ../backend-deploy.zip . \
  --exclude "*.git*" --exclude "node_modules/*" \
  --exclude "src/*"   --exclude ".env" \
  --exclude "*.DS_Store"
zip --delete ../backend-deploy.zip ".env"            # Safety: ensure .env excluded

KEY="loadlead-backend-$(date +%Y%m%d%H%M%S).zip"
aws s3 cp ../backend-deploy.zip \
  "s3://elasticbeanstalk-us-east-1-552011299815/${KEY}"
aws elasticbeanstalk create-application-version \
  --application-name loadlead-backend \
  --version-label "v-$(date +%Y%m%d%H%M%S)" \
  --source-bundle "S3Bucket=elasticbeanstalk-us-east-1-552011299815,S3Key=${KEY}"
aws elasticbeanstalk update-environment \
  --application-name loadlead-backend \
  --environment-name loadlead-backend-prod \
  --version-label "v-$(date +%Y%m%d%H%M%S)"
```

> ⚠️ **Always exclude `.env` from the zip.** The `.ebignore` file handles this for `eb deploy` but not for manual zips.

---

## 13. Environment Variables

### Backend (Elastic Beanstalk)

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | JWT signing secret |
| `RESEND_API_KEY` | Resend email API key |
| `AWS_REGION` | `us-east-1` |
| `ALLOWED_ORIGINS` | `https://loadleadapp.com` |
| `APP_URL` | `https://loadleadapp.com` |
| `DYNAMODB_USERS_TABLE` | `LoadLead_Users` (default) |
| `DYNAMODB_SETUP_TOKENS_TABLE` | `LoadLead_SetupTokens` (default) |
| `VAPID_PUBLIC_KEY` | Web push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web push VAPID private key |
| `GOOGLE_MAPS_API_KEY` | Google Maps Routes API key |

> `DYNAMODB_ENDPOINT` must **NOT** be set in production (causes localhost:8000 fallback).

### Frontend (Vite build)

| Variable | Description |
|---|---|
| `VITE_API_URL` | `https://api.loadleadapp.com` (no trailing /api) |

---

## Quick Reference

| Task | Command / URL |
|---|---|
| Local backend | `cd backend && npm run dev` (port 3001) |
| Local frontend | `cd frontend-v2 && npm run dev` (port 5173) |
| Local DynamoDB | `docker run -p 8000:8000 amazon/dynamodb-local` |
| Production site | https://loadleadapp.com |
| Production API | https://api.loadleadapp.com |
| EB environment | `loadlead-backend-prod` (us-east-1) |
| CloudFront dist | `E38CZNP7L2DB98` |
| AWS account | `552011299815` |
