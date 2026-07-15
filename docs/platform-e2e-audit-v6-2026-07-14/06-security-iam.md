# Platform E2E Audit v6 (2026-07-14) - Dimension 6: Security + IAM (adversarial)

**Headline:** two low/no-privilege paths to full compromise (self-registration as ADMIN; cross-tenant org takeover), plus a cluster of object-level-authorization gaps on money and documents. The cryptographic trust boundary (JWT alg, KMS TIN, webhook signatures, secrets hygiene) is largely well built; the failures are almost all missing ownership/tenant checks and missing throttles, not broken crypto. Every CRITICAL/HIGH IDOR claim was re-verified by direct source read.

## CRITICAL

### SEC-C1 - Self-registration as platform ADMIN (privilege escalation -> full compromise)
- Evidence: `routes/auth.ts:52` destructures `role` from the body into AuthService.signup; validator `utils/validators.ts:16` is `body('role').isIn(Object.values(UserRole))` and UserRole includes ADMIN (`types/index.ts:6`). `authService.ts:92` stamps the role, `:123` mints a JWT with it. The only ADMIN check (`authService.ts:130`) merely skips org auto-creation.
- Amplifier: a self-made admin has no platformRole, and `resolvePlatformRole(undefined)` returns STAFF_ADMIN for back-compat (`types/platformRole.ts`). So the forged admin clears requireAdmin AND requireStaffTier at every tier (READ/OPS/DESTRUCTIVE). Only requireComplianceRole (needs a DB grant) resists.
- Exploit: `POST /api/auth/signup {email,password,role:"ADMIN"}` returns an ADMIN cookie + JWT. BETA_MODE off = fully unauthenticated; BETA_MODE on = clear the beta gate first with any allowlisted email, then self-elevate. `/signup/carrier` is safe (hardcodes CARRIER_ADMIN).
- COA: server-side allowlist signup to non-privileged roles only (SHIPPER/DRIVER/RECEIVER/OWNER_OPERATOR); reject ADMIN/CARRIER_ADMIN from /signup unconditionally; make resolvePlatformRole return null (not STAFF_ADMIN) for users without an explicit tier.

### SEC-C2 - Cross-tenant org takeover: member management not bound to the path org (IDOR/BOLA)
- Evidence: `PATCH /api/org/:orgId/members/:membershipId` (`routes/org.ts:308`) and DELETE (`org.ts:347`) authorize callerMembership = getMembership(orgId, caller) against the path org, then act on a globally-resolved getMembershipById(membershipId) (`org.ts:328`) with no `target.orgId === orgId` check - absent in the route and in orgService.updateMemberRole/removeMember (`orgService.ts:303,354`).
- Exploit: attacker creates a throwaway org (auto-OWNER), reads a victim membershipId (any member can list a roster), then `PATCH /api/org/{attackerOrg}/members/{victimMembershipId}` - the OWNER-touch guard passes because the attacker is OWNER of their own org - to promote a colluder to OWNER of the victim org (full takeover) or demote/remove the victim's real owner. DELETE removes arbitrary members of any org.
- COA: centralize a `target.orgId === orgId` (403) assertion in all four member routes and the four service methods.

## HIGH

### SEC-H1 - Org member suspend/reinstate: same tenant-binding gap (account lockout)
`POST /api/org/:orgId/members/:membershipId/suspend` (`org.ts:369`) and /reinstate (`org.ts:391`) share SEC-C2's root cause; attacker suspends any org's member or reverses another org's disciplinary suspension. COA: same tenant-binding fix.

### SEC-H2 - Accessorial charge lifecycle: mutate any charge by id (financial IDOR)
`POST /api/accessorials/charges/:chargeId/{approve,adjust,dispute}` (`accessorials.ts:205,216,236`) gated only by requireRole(shipperRoles); each operates on a globally-fetched chargeId with no caller-vs-charge-shipper resolution. Any shipper can approve (->billable), adjust (arbitrary newAmountCents), or dispute (raise a TRUST_INCIDENT against an arbitrary carrier) on any load's charge. COA: resolve charge.loadId->load and assert caller is that load's shipper.

### SEC-H3 - Factoring invoice package/export: cross-tenant financial read + exfiltration
`GET /api/factoring/invoices/:invoiceId/package` (`factoring.ts:395`) and `POST /api/factoring/export` (`factoring.ts:409`) call buildPackageForInvoice (`factoring.ts:231`) with getLoadById(invoiceId) and no carrier-of-record check - unlike the sibling /loads/:loadId/* which call assertCallerActsForLoad. Any carrier reads another tenant's linehaul net, debtor identity, POD ref, NOA - or exports the full packet to their own factor email. COA: apply assertCallerActsForLoad to /invoices/* handlers.

### SEC-H4 - Receiver reads any load by id (cross-tenant IDOR)
`GET /api/receiver/loads/:loadId` (`receiver.ts:41-43`) returns getLoadById(loadId) with no `load.receiverId === receiver.receiverId` check (contrast /incoming :85). Any receiver enumerates all loads. COA: compare load.receiverId; 404 on mismatch.

### SEC-H5 - BOL creation on another shipper's load (cross-tenant write + leak)
`POST /api/bol` (`bol.ts:64-95`) is authenticate-only (no requireShipper/requireBOLAccess) and never compares load.shipperId to the caller, while every other path in the file uses requireBOLAccess. Any shipper stamps/hijacks a BOL on any load. COA: add the load.shipperId === shipper.shipperId check to create.

### SEC-H6 - /api/maps/* unauthenticated, unthrottled, billed Google proxy (billing + availability DoS)
Mounted with no auth (`index.ts:321`); handlers hit paid Google APIs (/estimate = 3 calls, `maps.ts:68-72`), no rate limit. Anonymous loop -> unbounded Maps bill + quota exhaustion. URLs host-pinned with encodeURIComponent (no SSRF). COA: authenticate + per-IP/user rate limit; cap the key's daily spend.

### SEC-H7 - Didit identity webhook fails OPEN when the secret is unset
`verification.ts:382-390`: if DIDIT_WEBHOOK_SECRET is missing, it warns and skips signature verification, then writes idvStatus/kybStatus/amlStatus keyed on attacker-supplied vendor_data. Unlike Canopy which rejects in prod. Given the platform's documented out-of-band env-wiring failure mode, a missing secret in prod lets an attacker mark any account verified/approved. COA: fail closed - if APP_ENV==='production' and no secret, return 401 (mirror canopyWebhook.ts:61-65); bootGuard should assert presence. (Corroborates business-logic H1.)

### SEC-H8 - Hot-path profile lookups do full-table Scans (cheap authenticated DoS)
DriverService.getProfileByUserId (`driverService.ts:119`), ShipperService (`shipperService.ts:71`), ReceiverService (`receiverService.ts:42`) use Database.scan with a userId FilterExpression - the first call in ~60 authenticated handlers, on unbounded tables, unthrottled. Any logged-in user polling a dashboard forces repeated whole-table scans (RCU/cost/latency DoS). Login and OwnerOperatorService.getByUserId already use GSIs. COA: add userId-index GSIs and switch to query. (Corroborates business-logic H2; expands to shipper/receiver.)

### SEC-H9 - Presigned-PUT uploads: no size cap, no MIME allowlist, client Content-Type, no ownership, public-read bucket
`POST /api/driver/headshot/upload-url` (`driver.ts:261`), `.../pod/upload-url` (`driver.ts:275`), `POST /api/attestation/photos/upload-url` (`attestation.ts:48`) mint PutObjectCommand presigned URLs with client ContentType, no ContentLengthRange, and (POD/attestation) no check the caller is a party to :loadId; driver routes return a public s3 URL. Enables GB-scale storage DoS, text/html stored-XSS/malware hosting, PENDING-row spam. COA: createPresignedPost with server-pinned Content-Type + content-length-range; keep the bucket private (signed GET); verify load-party.

### SEC-H10 - Admin grant/revoke on bare requireAdmin (intra-staff tier escalation)
`POST /api/admin/shippers/:shipperId/approve-admin` (`admin.ts:79`) and revoke-admin (`admin.ts:87`) grant/revoke admin with only base requireAdmin, while the sibling /users/:userId/revoke-admin (`admin.ts:493`) requires DESTRUCTIVE_TIER. A READ_TIER staffer can elevate/strip admin. COA: gate both with requireStaffTier(DESTRUCTIVE_TIER). Same tier-drift lower stakes at admin.ts:57,65,153,162,394,400.

### SEC-H11 - Dependency vulns (backend prod npm audit, High only)
axios (High: SSRF via NO_PROXY bypass, proto-pollution credential injection/MITM/header-injection) -> >=1.16.0; form-data CRLF injection -> >=4.0.6; lodash _.template code injection -> patched build; path-to-regexp ReDoS -> >=0.1.13. All fixAvailable. Frontend-v2: 0 High/Critical (only dompurify moderate). COA: npm audit fix; axios matters most (outbound client for FMCSA/Canopy/maps).

## MEDIUM (summary)
- M1 accessorial charge listing no role guard (`accessorials.ts:195`).
- M2 stop-event injection on unassigned loads (`accessorials.ts:50,79`).
- M3 compliance policy doc read/sign IDOR (`compliance.ts:358,369`).
- M4 unauthenticated waitlist email-bomb (`beta.ts:49`).
- M5 COI/LOA/shipper-policy uploads no MIME allowlist + 100KB json cap functional bug (`compliance.ts:204,228,329`).
- M6 dashboard N x full-Loads-scan fan-out (`ownerOperator.ts:507`, `org.ts:769`).
- M7 loadboard scans locks table per poll (`negotiationService.ts:131`).
- M8 invitation accept not identity-bound to invite.email (`orgService.ts:659`); revoke not org-bound (`org.ts:586`).
- M9 load mass-assignment via unfiltered req.body spread (`loadService.ts:173`).
- M10 invitation bearer tokens + full Didit event body (PII) logged in cleartext (`orgService.ts:653,675,720`, `verification.ts:407`).
- M11 frontend Maps key hygiene - confirm referrer+API restrictions, separate FE vs server key (git-ignored, no server secrets in bundle).

## LOW / Trust-boundary
- TB1 base role trusted from the JWT (7-day TTL, no revocation/deny-list; logout only clears the cookie). Demoted/offboarded user keeps base role <=7 days. Sensitive tiers re-derive from DB and are unaffected. The "never trust JWT for role" bar is NOT met for base role; dominated by SEC-C1. COA: fix C1, add short TTL + tokenVersion revocation check.
- L1 policy accept/compute IDOR (`accessorials.ts:108,165`). L2 setup bootstrap well-defended, residual no explicit prod hard-stop. L3 adminCompliance no router-level requireAdmin backstop. L4 moderate deps (qs DoS, uuid <11.1.1).

## Verified-safe (checked, correctly defended)
JWT alg pinned HS256 sign+verify; bootGuard refuses deployed boot on missing/dev-secret JWT_SECRET. No DynamoDB expression injection (parameterized names/values). W9 TIN KMS-envelope AES-256-GCM, fail-closed, ciphertext + last4 only, never logged. Crown-jewel W9/COI/LOA + hauler-packet reads gated by resolveShipperHaulerRelationship or ownerId equality. Webhook signatures: Tally, Canopy (Stripe-style + replay window, rejects unsigned in prod - the previously-flagged undocumented signature is RESOLVED), Didit (when secret set) all correct. Negotiation/attestation/BOL-read/offer-accept/shipper-load party-bound. CORS disallowed origin -> 403; cookies httpOnly + Secure(prod) + SameSite=Strict (CSRF mitigated). Required-GSI boot guard neutralizes negotiation/accessorial/compliance scan-fallbacks in prod. Committed .env.staging holds placeholders only; frontend-v2/.env.production git-ignored; no AWS keys / private keys / live tokens in source, infra, or scripts.

**Top 3 to fix now:** SEC-C1 (self-signup admin), SEC-C2 (org member tenant-binding), SEC-H7 (Didit fail-open) - each a single-file, low-risk patch with outsized blast-radius reduction.
