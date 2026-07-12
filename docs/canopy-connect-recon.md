# Canopy Connect integration - Phase 1 recon (read-only)

Status: recon complete. This document is the input to Phases 2 through 11. It records
what the Canopy docs and the LoadLead repo actually say (not what we assume), and it
lists every ambiguity as a question for the Canopy technical contact.

Sources: https://docs.usecanopy.com/llms.txt, the OpenAPI definition at
https://docs.usecanopy.com/openapi/documentation.json, and the referenced doc pages
(SDK reference, apps-create, policy check, monitoring, consent-and-documents,
about-webhooks, schemas-pull). Repo recon covered the compliance v2 seams.

No em dashes or en dashes anywhere in this build. Money is integer cents. Sentence case.

---

## Part A - Canopy docs findings

### Auth
- HTTP Basic. `Authorization: Basic base64(clientId:clientSecret)`. Client ID is the
  username, Client Secret is the password. TLS 1.2+. Server-side only.
- Base URL: `https://app.usecanopy.com/api/v1.0.0`.
- Sandbox vs production is a credential-set distinction (dashboard issues each set),
  so `CANOPY_ENV` selects which credentials and base host we talk to.

### The Pull object (the core artifact)
Top-level fields (from schemas-pull + OpenAPI):
- `pull_id` (uuid), `team_id` (uuid), `widget_id` (uuid)
- `status` enum (see below)
- `type` enum: `PULLING_DATA`, `SERVICING`, `DOCUMENT_UPLOAD`, `DOCUMENT_PARSING`,
  `AGENT`, `MANUAL_ENTRY`, `POLICY_LOOKUP`, `CONTACT_ME`
- `meta_data` (string | null) - "Developer-supplied arbitrary JSON-serializable data
  as a string". This echoes back on the pull. This is our carrier-id + nonce carrier.
- identity fields: first/middle/last name, emails, phones
- `insurance_provider_name`, `insurance_provider_friendly_name`
- `policy_check_status` enum: `COMPLIANT`, `NOT_COMPLIANT`, `REVIEW_REQUIRED`
- arrays: `policies`, `drivers`, `documents`, `addresses`, `claims`, `driving_records`,
  `loss_events`, `agents`, `answers`
- `skipped_product_types` (enum values: `personal`, `commercial`, `agent`)
- `parent_pull_id` (uuid | null) - links monitoring re-pulls to the original
- flags: `encountered_mfa`, `no_policies`, `no_drivers`, `no_documents`, etc.
- `created_at`, `is_archived`, `public_alias`, `public_url`

Pull status enum (confirmed present): `NOT_AUTHENTICATED`, `PROVIDER_ERROR`,
`INTERNAL_ERROR`, `SUCCESS`. (login_error_message surfaces on the not-authenticated
path per the sandbox credential docs.)

### The Policy object (commercial shape)
- `policy_id` (uuid)
- `carrier_policy_number` (string) - note: NOT `policy_number`
- `carrier_name` (string, machine name) and `carrier_friendly_name` (display)
- `effective_date`, `expiry_date`, `renewal_date`, `canceled_date` (all date-time)
- `status` enum: `ACTIVE`, `CANCELLED`, `EXPIRED`, `UNVERIFIED`, `PENDING_ACTIVATION`,
  `PENDING_CANCELLATION`, `RESCINDED`, `QUOTE`
- `policy_type` enum. Commercial values relevant to trucking:
  `COMMERCIAL_AUTO` (auto liability), `INLAND_MARINE` (motor truck cargo lives here),
  plus `COMMERCIAL_UMBRELLA`, `GENERAL_LIABILITY`, `WORKERS_COMPENSATION`,
  `COMMERCIAL_PROPERTY`, `BUSINESS_OWNERS`, `COMMERCIAL_PACKAGE`, `COMMERCIAL_FIRE`,
  `ERRORS_AND_OMISSIONS`, `MANAGEMENT_LIABILITY`, `CYBER`.
- `named_insureds` array and `commercial_named_insureds` array
- `vehicles` array
- `policy_check` field on each policy (PolicyCheck schema - verification status +
  detail). Used by Policy Check product.

### Coverage / limit shape
- All monetary amounts are integers in CENTS. Confirmed field names include
  `premium_cents`, `per_person_limit_cents`, `per_incident_limit_cents`,
  `per_day_limit_cents`, `deductible_cents`, plus `*_unlimited` booleans and
  `max_days`. This matches our internal integer-cents convention exactly - no
  dollars-to-cents conversion needed on the Canopy side (only the manual COI form
  converts, client-side, as today).
- OPEN: the exact coverage container that carries the commercial-auto combined-
  single-limit / cargo limit for `COMMERCIAL_AUTO` and `INLAND_MARINE` policy types
  was not fully expanded in the truncated OpenAPI excerpt (the vehicle/dwelling
  coverage sub-schemas were the visible ones). We map defensively and confirm the
  precise coverage-code taxonomy with the contact (question A1).

### Implementation styles
- SDK (hosted widget): `CanopyConnect.create(options)` returns a Handler.
  - Required: `options.publicAlias` (the link's public alias).
  - Optional: `options.modal` (default true), `options.mount`, `options.hideCloseButton`,
    `options.pullMetaData` (arbitrary JSON, echoes back as `Pull.meta_data`),
    `options.consentToken`, `options.reconnectToken`.
  - Handler events via `.on(...)`: `onAuthenticationSuccess`, `onSectionViewed`,
    `onUserAction`, `onExit`, `onSelectCustomInsuranceProvider`, `onError`, `onDestroy`.
  - Pull id arrives in the callback payload as `data.pull.pull_id`.
  - OPEN: exact script-tag `src` URL / npm package for loading `CanopyConnect` was not
    printed verbatim in the reference page (question A2).
- Components: a fully custom flow in the host app's own UI. The docs describe the SDK's
  modal-vs-mount options but did NOT enumerate a separate Components primitive catalog
  (insurer search / credential entry / MFA challenge as discrete embeddable pieces) on
  the pages fetched. Treat Components availability and its primitive set as plan-gated
  and unconfirmed (question A3). Build to the documented interface; keep the mode
  switchable but guarded.
- Apps (agent channel): an integration other Canopy users operate on their own behalf.
  Creation requires a "Request Developer Access" form and a Canopy representative to
  complete setup; apps start in Sandbox Mode (team-only) and need support contact to
  reach production. Required app settings: `Name`, `Description`, `Marketing URI`,
  `Logo` (SVG, maskable), `Redirect URIs`. Optional/conditional: IP Whitelist,
  Auth Start URI, `Dashboard Send URI` (Canopy POSTs here when a user clicks
  "Open in [App]" - this is the agent-initiated push path), Dashboard Select Types,
  Dashboard Logo. This is partnership/plan gated -> Phase 10 is GATED CLOSED for the
  build; we produce the requirements brief instead (question A4).

### Metadata attach and echo
- Widget: `options.pullMetaData` (JSON-serializable) attaches at connect time and the
  API returns it verbatim as `Pull.meta_data` (a string). We put `{carrierId, nonce}`
  there. Components/manual-entry: `meta_data` field on the consent request.

### Manual-entry / document pull
- `POST /widget/pull/consentAndDocuments`. Fields: `consent_language` (<=1024 chars),
  `terms_version`, `documents` (1-20 files, <=10MB each, <=200MB combined),
  `device_identifier`, `public_alias`, optional `insurerName` (carrier id),
  `meta_data`. Creates a pull whose exact `type` (MANUAL_ENTRY vs DOCUMENT_PARSING)
  and whether docs are parsed into structured policies is not spelled out (question
  A5). We do NOT need this for the core flow - our own manual path (COI upload +
  structured form + FMCSA) already exists and is authoritative. This is noted for
  completeness only.

### Policy Check (compliance-rules product)
- `POST /policyCheck` ("Evaluate Policy Check on pull"). Result surfaces as
  `pull.policy_check_status` (`COMPLIANT` / `NOT_COMPLIANT` / `REVIEW_REQUIRED`) and a
  per-policy `policy.policy_check` object. Rule definition mechanism (a team-settings
  endpoint) was referenced in llms.txt (get/post policyChecks/settings) but the rule
  schema was not printed (question A6). Pricing/plan implication unconfirmed (A6).
  -> Phase 8 builds this behind the evaluator seam in SHADOW mode; the local minimums
  table stays the decider until a clean shadow period.

### Webhooks
- Event catalog (about-webhooks + monitoring): `AUTH_STATUS`, `POLICY_AVAILABLE`,
  `POLICIES_AVAILABLE`, `COMPLETE`, `ERROR`, `MONITORING_RECONNECT`, `DATA_UPDATED`,
  `SERVICING_WAITING_FOR_CONSUMER_CONFIRMATION`, `MONITORING_EVENTS`.
- Completion signal: `POLICIES_AVAILABLE` / `COMPLETE` indicate the pull's data is
  ready to retrieve. `ERROR` covers `PROVIDER_ERROR` / `INTERNAL_ERROR` outcomes.
- Registration: dashboard Settings page or the Webhooks API (CRUD `/webhooks`).
- SIGNATURE SCHEME: NOT documented on any fetched page or in the OpenAPI definition.
  No `x-canopy-signature` / `x-hub-signature` header, algorithm, or signed-bytes
  definition is published. THIS IS THE HEADLINE UNKNOWN (question A7). Mitigation for
  the build: implement the webhook handler exactly like the Didit handler - capture
  the raw body, compute an HMAC-SHA256 over the raw bytes with `CANOPY_WEBHOOK_SECRET`,
  timing-safe compare, support an optional timestamp replay window, and make the header
  name(s) and signing recipe a small config-driven table so we snap to Canopy's real
  scheme the moment the contact confirms it, with zero pipeline change. Until confirmed,
  the handler is defensive: verify if a recognized signature header is present, and in
  sandbox additionally correlate by `pull_id` + retrieve-and-validate against the pulls
  API so an unsigned sandbox event still cannot forge state.

### Monitoring
- Enable: email support@usecanopy.com to set an automatic refresh interval (>=30 days)
  OR use the Monitoring API endpoints to toggle per pull. Refresh is billed at the same
  price as a pull.
- On refresh, Canopy fires `POLICY_AVAILABLE` / `POLICIES_AVAILABLE` / `COMPLETE` for
  the new data; `MONITORING_EVENTS` carries deterministic change events (sandbox
  `user_good_diffs`). `MONITORING_RECONNECT` signals a needed reconnection and carries
  `initial_pull_id`, `reconnect_token` (or `reconnectUrl` for non-whitelabel), and an
  `auth_status` of `NOT_AUTHENTICATED` / `IDENTITY_VERIFICATION_OPTIONS` /
  `IDENTITY_VERIFICATION`.
- OPEN: the granular change taxonomy inside `MONITORING_EVENTS` (cancellation vs limit
  change vs renewal, and their exact field names) was not enumerated (question A8). We
  map defensively: re-retrieve the pull on any monitoring event and diff the policy
  status/limits ourselves, so our status-flip logic does not depend on Canopy's event
  sub-type naming.

---

## Part B - LoadLead repo seams (from compliance v2)

Greenfield confirmation: `grep -ril canopy` over backend and frontend-v2 returns zero.
Nothing references Canopy today. Insurance structured fields already use integer cents
(`CoiFields.autoLiabilityCents` / `cargoCents` / `generalLiabilityCents`, guarded by
`assertCents()`); dates are epoch ms; FMCSA filing amounts are dollars converted at the
boundary.

1. Insurance onboarding UI - `frontend-v2/src/pages/owner-operator/OwnerOperatorCompliance.tsx`.
   Single page, three stacked sections (W9 / COI / LOA) above a 3-badge status grid.
   COI form converts dollars to cents client-side and dates via `getTime()`.
   -> Phases 3/4 add the "Connect your insurance" primary action + manual alternative here.
2. Provider seam - `backend/src/services/compliance/insuranceVerification.ts`.
   `InsuranceVerificationProvider { name; submit(); getStatus() }`, factory
   `resolveInsuranceProvider()` switches on `INSURANCE_VERIFICATION_PROVIDER` (plain env,
   default manual). A `case 'canopy'` slots a new provider here. This is a plain env
   switch, NOT the modeResolver seam.
3. Mode seam - `backend/src/services/integrations/modeResolver.ts`. `IntegrationName`
   union + `MODE_ENV_VAR` / `LIVE_MODE` / `DEFAULT_NONPROD_MODE` maps; prod returns live
   unconditionally. -> add `'canopy'` (CANOPY_MODE, live, sandbox default). bootGuard
   `NEVER_LIVE_OUTSIDE_PROD` should include canopy (pulls real consumer PII, like didit).
4. Five-state machine - `backend/src/services/complianceDocumentService.ts`.
   `ComplianceVerificationStatus = UNVERIFIED|PENDING|VERIFIED|REJECTED|EXPIRED`.
   Every transition = `setVerificationStatus(documentId, status, event, source, detail?)`
   = one live-status update + one append-only `recordVerificationEvent`. Event types:
   `SUBMITTED|AUTO_CHECK_PASSED|AUTO_CHECK_FAILED|VERIFIED|REJECTED|EXPIRED|SUPERSEDED|REFRESH_REQUIRED`.
   Canopy outcomes flow through this exactly; source string `CANOPY`.
5. COI service - `backend/src/services/compliance/coiService.ts`. `CoiFields`,
   `submitCoi()` (hash + S3 + createDocument PENDING + provider.submit + auto-check),
   `runInsuranceAutoCheck()` (FMCSA corroboration, MIN_LIABILITY_DOLLARS 750_000),
   `decideCoi()`, `expireDueCois()`. Cross-reference engine (Phase 6) reads these fields.
6. FMCSA - `backend/src/services/integrations/fmcsaInsurance.ts`
   `getInsuranceFilings(dot)` -> `{hasActiveInsurance, insurerNames[], bipdOnFileDollars}`.
   Always runs. Canopy adds truth, does not replace this.
7. Trust events - `backend/src/services/betaTrustEventService.ts`.
   `BetaTrustEvent {eventId, eventType: NO_SHOW|TRUST_INCIDENT, loadId, carrierId, ...}`,
   references by id only, own table. CRITICAL_DISCREPANCY raises one here (needs a new
   eventType or a reason payload - decide in Phase 6).
8. Admin review queue - `backend/src/routes/adminCompliance.ts` + doc-decide route
   `POST /api/compliance/admin/:documentId/decide`. "Hold for admin review" = the PENDING
   state itself. CRITICAL cross-reference holds the record here.
9. Webhook conventions - Tally (`routes/tallyWebhook.ts`, express.raw + HMAC-SHA256
   base64 over raw bytes + timingSafeEqual) and Didit (`verifyDiditSignature` in
   `services/verification.ts`: `X-Timestamp` + `X-Signature-V2`
   = HMAC-SHA256(secret, `${ts}.${rawBody}`) + `X-Signature-Simple`, timing-safe,
   10-min replay window, raw body via `express.json({verify})`). Canopy webhook mirrors
   Didit's shape.
10. Envelope crypto - `backend/src/utils/fieldCrypto.ts` `encryptField`/`decryptField`/
    `tinLast4`. Reuse for any Canopy-returned PII we must persist (e.g. reconnect tokens).
11. Notification seam - `notificationService.ts` (inbox row, kinds include COMPLIANCE,
    VERIFICATION_UPDATE) + `notificationOutboxService.ts` (durable push). Compliance
    wrappers in `complianceNotifications.ts`.
12. Consent pattern - append-only rows with `consentGiven` hard-gate + sha256 hash
    pinning exact attestation text + version + actor id + signedAt (accessorial
    acceptances, W9 certification). Mirror for agent-channel consent (Phase 10).
13. Config loader - `backend/src/config/environment.ts`. Table names via
    `t('DYNAMODB_..._TABLE', 'LoadLead_...')`. Integration API keys read straight from
    `process.env`. Canopy follows the same: table names via `t()`, secrets via env.

---

## Questions for the Canopy technical contact

A1. For a `COMMERCIAL_AUTO` policy and an `INLAND_MARINE` (motor truck cargo) policy,
    which exact coverage object/field carries the combined-single-limit (auto liability)
    and the cargo limit? Confirm the coverage-code taxonomy and that all limits are
    `*_cents` integers.
A2. What is the exact web SDK load mechanism - the `<script src="...">` URL and/or npm
    package name that exposes `CanopyConnect.create`? Any SRI/version pinning guidance?
A3. Is Components (a fully custom in-app flow with discrete insurer-search / credential /
    MFA primitives) available on our plan, and where is its primitive catalog documented?
    If plan-gated, what unlocks it?
A4. Apps / agent channel: what does "Request Developer Access" require of us, what is the
    review/partnership timeline, and what does acting on another Canopy user's behalf
    permit and restrict (scopes, consent record, data path)?
A5. `POST /widget/pull/consentAndDocuments`: what `type` does the resulting pull carry,
    and are uploaded documents parsed into structured policy data or returned as files
    only?
A6. Policy Check: what is the rule-definition schema and endpoint (policyChecks/settings),
    where exactly do per-rule pass/fail reasons surface on the pull, and what is the
    pricing/plan implication of enabling it?
A7. WEBHOOKS (blocking for hardening): what is the signature scheme - the exact header
    name(s), the HMAC algorithm, the secret used, and precisely which bytes are signed
    (raw body only, or timestamp + body)? Is there a timestamp/replay header and a
    recommended tolerance? What are the retry and idempotency semantics (retry cadence,
    max attempts, and is there a stable event id we can dedupe on)?
A8. `MONITORING_EVENTS`: what is the full change-event taxonomy inside it (cancellation,
    lapse, limit change, renewal) and the field names, so we can map changes to our
    EXPIRED/PENDING status flips? Confirm `parent_pull_id` links a monitoring re-pull to
    the original.
A9. Rate limits and error envelope for the pulls API (`GET /pull/{id}`) so our ingestion
    retry/backoff is correct.

Build decisions that do not block on the above (defensive by design):
- Webhook handler verifies via a config-driven signature table (Didit-style), and in
  sandbox additionally re-retrieves and validates the pull by id, so state cannot be
  forged even before A7 is answered.
- Monitoring status flips are computed by re-retrieving the pull and diffing policy
  status/limits ourselves, so they do not depend on A8's event sub-type naming.
- Coverage mapping reads every plausible commercial-auto/inland-marine limit field and
  asserts integer cents, so A1 tightens (not unblocks) the mapping.
