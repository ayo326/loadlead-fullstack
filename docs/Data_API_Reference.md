---
connie-title: LoadLead — Data Model + API Reference (generated)
connie-publish: true
status: Reconciled
last-reconciled-against: 0f5588d
generated-by: docs/.build/route_inventory.json (rebuild on every reconciliation pass)
---

# Data Model + API Reference

> Generated from the live code. Do not hand-edit — re-run the reconciliation pass to refresh.

## DDB tables (28 — all PITR enabled, all PAY_PER_REQUEST, all under Terraform)

### Critical / lifecycle (12)

| Table | Hash key | Range key | GSIs | Notes |
|---|---|---|---|---|
| LoadLead_Users | userId | — | email-index | All users (5 personas + ADMIN) |
| LoadLead_Loads | loadId | — | status-index, shipperId-index | Lifecycle source of truth |
| LoadLead_Offers | offerId | — | loadId-index, driverId-index, driverId-status-index, loadId-driverId-index | OFFERED → ACCEPTED/DECLINED |
| LoadLead_Drivers | driverId | — | userId-index | DRIVER profiles (incl. OO self-driver) |
| LoadLead_Receivers | receiverId | — | userId-index | Receiver facility profiles |
| LoadLead_Shippers | shipperId | — | userId-index | Shipper company profiles |
| LoadLead_Organizations | orgId | — | — | Carrier/Shipper/Receiver orgs |
| LoadLead_Memberships | membershipId | — | orgId-index, userId-index | User ↔ org with OrgRole |
| LoadLead_BOL | bolId | — | loadId-index, status-index | Bill of lading lifecycle |
| LoadLead_Verifications | entityId | — | status-index | Per-entity verification state (Didit-backed) |
| LoadLead_Signatures | signatureId | — | loadId-signedAt-index | Append-only attestation chain (IAM Deny + ESLint + ConditionExpression) |
| LoadLead_PodPhotos | photoId | — | loadId-index | Proof-of-delivery photo metadata (S3 Object Lock per-object) |

### Secondary (16)

| Table | Hash key | Notes |
|---|---|---|
| LoadLead_AdminAudit | auditId | Privileged-action audit log |
| LoadLead_AdminBootstrapAttempts | attemptId | Single-use admin bootstrap tokens |
| LoadLead_CarrierFactoringProfiles | carrierId | Factoring partner KYB state per carrier |
| LoadLead_FactoringOptIns | optInId | Shipper opts a carrier into a factoring agreement |
| LoadLead_FleetInvites | inviteId | OO invites a driver to their fleet |
| LoadLead_Invitations | token | Carrier org IAM invitations |
| LoadLead_Notifications | notificationId | In-app inbox |
| LoadLead_OwnerOperators | operatorId | OO profile records |
| LoadLead_PasswordResets | token | Single-use reset tokens with TTL |
| LoadLead_PushSubscriptions | userId | Driver web-push subscriptions |
| LoadLead_SetupTokens | token | Admin bootstrap single-use tokens |
| LoadLead_SupportInbound | emailId | SES-inbound email → ticket |
| LoadLead_SupportMessages | messageId | Threaded support messages |
| LoadLead_SupportSettings | settingsId | Support team config |
| LoadLead_SupportTickets | ticketId | Support ticket lifecycle |
| LoadLead-MembershipAuditLogs | logId | Note the HYPHEN (legacy naming) — IAM membership audit trail |

### Storage backing — S3 buckets (5)

| Bucket | Purpose | Object Lock | Public |
|---|---|---|---|
| loadlead-signatures-worm-sink | Signature audit mirror via DDB Streams Lambda | ✅ COMPLIANCE 2555d, bucket policy Deny DeleteObject | Private |
| loadlead-pod-uploads-v2 | POD photo bytes (per-object retention applied at finalize) | ✅ COMPLIANCE 2555d per-object, bucket policy Deny DeleteObject | Private |
| loadlead-frontend-prod | Customer SPA bundle | — | **Public** (PublicReadGetObject, S3-website endpoint) |
| loadlead-admin-prod | Admin SPA bundle | — | Private (OAC-only from CloudFront E1RPGX7HLJI48U) |
| loadlead-terraform-state | TF remote state | — | Private (versioned + AES256-encrypted) |

---

## API endpoints (177 routes, 156 authenticated, 21 truly public)

Legend: 🔒 = file-level `router.use(authenticate)` · 🔓 = no auth · 🛡️ = inline role-gate · ✨ = inline `authenticate` (file is not file-gated)


### `routes/admin.ts` (23 routes)

Platform staff console (subdomain `admin.loadleadapp.com`).

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `GET` | `/api/admin/drivers` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/drivers/:driverId` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/drivers/:driverId/verify` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/drivers/:driverId/suspend` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/shippers/admin-requests` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/shippers/:shipperId/approve-admin` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/shippers/:shipperId/revoke-admin` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/loads` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/loads/:loadId` | 🔒 file | 🛡️ file |
| `PUT` | `/api/admin/loads/:loadId/status` | 🔒 file | 🛡️ file |
| `PATCH` | `/api/admin/drivers/:driverId/buffer` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/drivers/:driverId/buffer` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/loads/:loadId/tracking` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/fleet/feed` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/fleet/drivers/:driverId` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/debug/broadcast/:loadId` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/verifications` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/verifications/:entityId/approve` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/verifications/:entityId/reject` | 🔒 file | 🛡️ file |
| `GET` | `/api/admin/orgs` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/orgs/:orgId/suspend` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/orgs/:orgId/reinstate` | 🔒 file | 🛡️ file |
| `POST` | `/api/admin/users/:userId/revoke-admin` | 🔒 file | 🛡️ file |

### `routes/attestation.ts` (4 routes)

Sign + photo + chain read. Auth via resolver-based assertSignerIsLoadParty.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/attestation/photos/upload-url` | 🔒 file | — |
| `POST` | `/api/attestation/photos/:photoId/finalize` | 🔒 file | — |
| `POST` | `/api/attestation/sign` | 🔒 file | — |
| `GET` | `/api/attestation/chain/:loadId` | 🔒 file | — |

### `routes/auth.ts` (14 routes)

Login / signup / password / 2FA / self. 7 routes pre-auth (signup, login, forgot, reset, logout, 2fa-login); 7 routes inline-authenticate (me, change-password, 2fa setup/verify/disable/status).

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/auth/signup` | 🔓 public | — |
| `POST` | `/api/auth/signup/carrier` | 🔓 public | — |
| `POST` | `/api/auth/login` | 🔓 public | — |
| `POST` | `/api/auth/2fa/login` | 🔓 public | — |
| `POST` | `/api/auth/change-password` | ✨ inline | — |
| `POST` | `/api/auth/2fa/setup` | ✨ inline | — |
| `POST` | `/api/auth/2fa/verify` | ✨ inline | — |
| `POST` | `/api/auth/2fa/disable` | ✨ inline | — |
| `GET` | `/api/auth/2fa/status` | ✨ inline | — |
| `POST` | `/api/auth/logout` | 🔓 public | — |
| `GET` | `/api/auth/me` | ✨ inline | — |
| `PATCH` | `/api/auth/me` | ✨ inline | — |
| `POST` | `/api/auth/forgot-password` | 🔓 public | — |
| `POST` | `/api/auth/reset-password` | 🔓 public | — |

### `routes/bol.ts` (8 routes)

Bill of lading lifecycle.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `GET` | `/api/bol/:bolId` | 🔒 file | — |
| `GET` | `/api/bol/load/:loadId` | 🔒 file | — |
| `POST` | `/api/bol/` | 🔒 file | — |
| `PUT` | `/api/bol/:bolId` | 🔒 file | — |
| `POST` | `/api/bol/:bolId/sign` | 🔒 file | — |
| `POST` | `/api/bol/:bolId/dispute` | 🔒 file | — |
| `PUT` | `/api/bol/:bolId/wms` | 🔒 file | — |
| `GET` | `/api/bol/admin/all` | 🔒 file | — |

### `routes/driver.ts` (25 routes)

Driver loadboard + lifecycle. router.use(requireRole(DRIVER, OWNER_OPERATOR, ADMIN)) — OO self-haul admitted.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/driver/profile` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/profile` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/verification/idv` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/verification/idv` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/affiliation` | 🔒 file | 🛡️ file |
| `PUT` | `/api/driver/profile` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/location` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/load-status` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/loadboard` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/offers/:loadId` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/offers/:loadId/accept` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/offers/:loadId/decline` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/active-loads` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/headshot/upload-url` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/loads/:loadId/pod/upload-url` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/loads/:loadId/pickup` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/loads/:loadId/deliver` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/loads/:loadId/pod` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/loads/:loadId/pod-legacy` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/capacity/check` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/history` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/capacity/buffer` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/fleet/accept-invite` | 🔒 file | 🛡️ file |
| `GET` | `/api/driver/verification` | 🔒 file | 🛡️ file |
| `POST` | `/api/driver/verification/submit` | 🔒 file | 🛡️ file |

### `routes/factoring.ts` (10 routes)

Carrier factoring opt-in workflow.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `GET` | `/api/factoring/profile` | 🔒 file | — |
| `POST` | `/api/factoring/byo` | 🔒 file | — |
| `POST` | `/api/factoring/byo/verify` | 🔒 file | — |
| `POST` | `/api/factoring/byo/confirm-remittance` | 🔒 file | — |
| `GET` | `/api/factoring/byo/ready` | 🔒 file | — |
| `POST` | `/api/factoring/partner` | 🔒 file | — |
| `POST` | `/api/factoring/release` | 🔒 file | — |
| `POST` | `/api/factoring/loads/:loadId/opt-in` | 🔒 file | — |
| `GET` | `/api/factoring/loads/:loadId/payee` | 🔒 file | — |
| `GET` | `/api/factoring/loads/:loadId/pod` | 🔒 file | — |

### `routes/maps.ts` (3 routes)

🟠 No auth on any route. Google Maps API key wrapper. PR-1 in PendingRegister.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/maps/estimate` | 🔓 public | — |
| `GET` | `/api/maps/geocode` | 🔓 public | — |
| `GET` | `/api/maps/reverse-geocode` | 🔓 public | — |

### `routes/notifications.ts` (7 routes)

In-app notification inbox.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `GET` | `/api/notifications/inbox` | 🔒 file | — |
| `GET` | `/api/notifications/inbox/unread-count` | 🔒 file | — |
| `POST` | `/api/notifications/inbox/:notificationId/read` | 🔒 file | — |
| `POST` | `/api/notifications/inbox/read-all` | 🔒 file | — |
| `GET` | `/api/notifications/vapid-key` | 🔒 file | — |
| `POST` | `/api/notifications/subscribe` | 🔒 file | — |
| `DELETE` | `/api/notifications/subscribe` | 🔒 file | — |

### `routes/org.ts` (25 routes)

Org membership + IAM invitations + dispatch.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/org/invitations/:token/accept` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/invitations/:token` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId` | 🔒 file | 🛡️ file |
| `PATCH` | `/api/org/:orgId` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId/verification` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/verification/submit` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/suspend` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/reinstate` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId/members` | 🔒 file | 🛡️ file |
| `PATCH` | `/api/org/:orgId/members/:membershipId` | 🔒 file | 🛡️ file |
| `DELETE` | `/api/org/:orgId/members/:membershipId` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/members/:membershipId/suspend` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/members/:membershipId/reinstate` | 🔒 file | 🛡️ file |
| `PATCH` | `/api/org/:orgId/buffer` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/drivers` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/:orgId/invitations` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId/invitations` | 🔒 file | 🛡️ file |
| `DELETE` | `/api/org/:orgId/invitations/:token` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/invitations/:token/accept` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId/audit` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId/settings` | 🔒 file | 🛡️ file |
| `GET` | `/api/org/:orgId/dashboard` | 🔒 file | 🛡️ file |
| `POST` | `/api/org/loads/:loadId/dispatch` | 🔒 file | 🛡️ file |

### `routes/ownerOperator.ts` (18 routes)

OO self-haul + fleet management + dashboard aggregation.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `GET` | `/api/ownerOperator/profile` | 🔒 file | 🛡️ file |
| `POST` | `/api/ownerOperator/profile` | 🔒 file | 🛡️ file |
| `PUT` | `/api/ownerOperator/profile` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/loadboard` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/offers/:loadId` | 🔒 file | 🛡️ file |
| `POST` | `/api/ownerOperator/offers/:loadId/accept` | 🔒 file | 🛡️ file |
| `POST` | `/api/ownerOperator/offers/:loadId/decline` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/fleet` | 🔒 file | 🛡️ file |
| `DELETE` | `/api/ownerOperator/fleet/:driverId` | 🔒 file | 🛡️ file |
| `POST` | `/api/ownerOperator/fleet/invite` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/history` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/verification` | 🔒 file | 🛡️ file |
| `POST` | `/api/ownerOperator/verification/submit` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/verification/idv` | 🔒 file | 🛡️ file |
| `POST` | `/api/ownerOperator/verification/idv` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/fleet/invites` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/settings` | 🔒 file | 🛡️ file |
| `GET` | `/api/ownerOperator/dashboard` | 🔒 file | 🛡️ file |

### `routes/receiver.ts` (6 routes)

Inbound list + delivery confirmation (RECEIVER_CONFIRM signature gate).

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/receiver/profile` | 🔒 file | 🛡️ file |
| `GET` | `/api/receiver/profile` | 🔒 file | 🛡️ file |
| `PUT` | `/api/receiver/profile` | 🔒 file | 🛡️ file |
| `GET` | `/api/receiver/loads/:loadId` | 🔒 file | 🛡️ file |
| `POST` | `/api/receiver/loads/:loadId/confirm` | 🔒 file | 🛡️ file |
| `GET` | `/api/receiver/incoming` | 🔒 file | 🛡️ file |

### `routes/reference.ts` (8 routes)

Public taxonomy lookups (equipment, modes, services, commodities, accessorials, hazmat).

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `GET` | `/api/reference/equipment-classes` | 🔓 public | — |
| `GET` | `/api/reference/equipment-classes/:code` | 🔓 public | — |
| `GET` | `/api/reference/equipment-models` | 🔓 public | — |
| `GET` | `/api/reference/load-modes` | 🔓 public | — |
| `GET` | `/api/reference/service-types` | 🔓 public | — |
| `GET` | `/api/reference/commodities` | 🔓 public | — |
| `GET` | `/api/reference/accessorials` | 🔓 public | — |
| `GET` | `/api/reference/hazmat-classes` | 🔓 public | — |

### `routes/setup.ts` (3 routes)

Admin bootstrap (single-use token, atomic singleton). 3 routes public by design.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/setup/request` | 🔓 public | — |
| `POST` | `/api/setup/complete` | 🔓 public | — |
| `GET` | `/api/setup/status` | 🔓 public | — |

### `routes/shipper.ts` (12 routes)

Post-load + track. BOL_SUBMIT signature gate on submit.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/shipper/profile` | 🔒 file | 🛡️ file |
| `GET` | `/api/shipper/profile` | 🔒 file | 🛡️ file |
| `PUT` | `/api/shipper/profile` | 🔒 file | 🛡️ file |
| `POST` | `/api/shipper/admin-request` | 🔒 file | 🛡️ file |
| `POST` | `/api/shipper/loads/draft` | 🔒 file | 🛡️ file |
| `POST` | `/api/shipper/loads/:loadId/sign` | 🔒 file | 🛡️ file |
| `POST` | `/api/shipper/loads/:loadId/submit` | 🔒 file | 🛡️ file |
| `GET` | `/api/shipper/loads` | 🔒 file | 🛡️ file |
| `GET` | `/api/shipper/loads/:loadId` | 🔒 file | 🛡️ file |
| `PUT` | `/api/shipper/loads/:loadId` | 🔒 file | 🛡️ file |
| `DELETE` | `/api/shipper/loads/:loadId` | 🔒 file | 🛡️ file |
| `GET` | `/api/shipper/loads/:loadId/tracking` | 🔒 file | 🛡️ file |

### `routes/support.ts` (11 routes)

Internal support ticket workflow.

| Method | Path | Auth | Role gate |
|---|---|---|---|
| `POST` | `/api/support/inbound` | 🔒 file | 🛡️ file |
| `POST` | `/api/support/inbound/ses` | 🔒 file | 🛡️ file |
| `GET` | `/api/support/tickets` | 🔒 file | 🛡️ file |
| `GET` | `/api/support/tickets/:ticketId` | 🔒 file | 🛡️ file |
| `POST` | `/api/support/tickets` | 🔒 file | 🛡️ file |
| `PATCH` | `/api/support/tickets/:ticketId` | 🔒 file | 🛡️ file |
| `POST` | `/api/support/tickets/:ticketId/messages` | 🔒 file | 🛡️ file |
| `GET` | `/api/support/settings` | 🔒 file | 🛡️ file |
| `PUT` | `/api/support/settings` | 🔒 file | 🛡️ file |
| `GET` | `/api/support/monitor` | 🔒 file | 🛡️ file |
| `GET` | `/api/support/integrations` | 🔒 file | 🛡️ file |


---

## Notes for reviewers

- **Auth coverage**: 156/177 = 88.1% routes authenticated.
- **Truly public**: 21 routes. Of those, 18 are legit-by-design (auth pre-login, taxonomy lookups, admin bootstrap, logout). **3 are a security gap**: `/api/maps/*` (see [PR-1](PendingRegister.md#high)).
- **Role-gate coverage**: 120/156 = 77% of authenticated routes have an explicit role gate. The other 36 are "any authenticated user" — most are user-self routes (e.g. `/api/auth/me`) which are legit, but worth a focused audit when STIG LL-AC-001 review happens.
- **This file is generated** from `backend/src/routes/*.ts` via the route-inventory script. If the routes change, re-run the reconciliation pass to refresh.

