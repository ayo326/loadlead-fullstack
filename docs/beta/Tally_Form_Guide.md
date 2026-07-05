---
connie-title: LoadLead - Beta Application Form (Tally) - Field Guide
connie-publish: true
status: Authoritative
audience: form builder · webhook implementer
connie-page-id: '4521985'
---

# LoadLead Beta Application - Tally Form Field Guide

This document is the **authoritative mapping** between the Tally form's
question labels and the `BetaApplication` model. The webhook handler
(`backend/src/services/tallyWebhook.ts`) reads form fields **by label**, so
the labels below must match the Tally form exactly. If you rename a Tally
field, you also rename it here AND ship the code change.

## Webhook setup (one-time, in Tally)

1. Tally → Form → Integrations → "Webhooks" → add a new webhook
2. **URL:** `https://api.loadleadapp.com/api/admin/beta/webhook`
3. **Secret:** copy the value from `TALLY_SIGNING_SECRET` in `.env.production`
4. Tally will sign every POST with `Tally-Signature: <base64 HMAC-SHA256>`
   over the **raw request body** using that secret. The webhook handler
   captures the raw body before JSON parsing and verifies the HMAC against
   those exact bytes (timing-safe compare); unsigned or wrong-signature
   requests get 401.
5. (optional, defence-in-depth) set a custom header `X-Beta-Source: tally`
   on the Tally webhook and set `TALLY_REQUIRE_SOURCE_HEADER=true` - the
   endpoint then also requires that header.

If `TALLY_SIGNING_SECRET` is unset, the endpoint is **inert** - it returns
`503 form_not_connected` and the admin dashboard surfaces the same status.
There is no fabricated-data fallback. (`TALLY_WEBHOOK_SECRET` is accepted
as a back-compat alias for the signing secret.)

The webhook is machine-to-machine: it is secured by the signature, NOT by
an admin session cookie, so it is mounted outside the `requireAdmin` gate.

> Payload shape (Tally): `{ eventType: "FORM_RESPONSE", createdAt, data: {
> responseId, formId, formName, fields: [{ key, label, type, value }] } }`.
> Idempotency key is `data.responseId`.

## Section 12 - Field mapping (BY LABEL)

The webhook maps **by label** (`backend/src/services/betaApplicationService.ts`).
Labels are matched loosely (older alias labels still accepted) so a minor
Tally rename doesn't silently drop a field, but the **authoritative** labels
below are what the form should use.

### Required fields (every applicant)

| Tally label (authoritative) | BetaApplication field | Type | Notes |
|---|---|---|---|
| `Which best describes you?` | `side` | `SHIPPER\|CARRIER\|BOTH` | "Shipper"→SHIPPER, "Hauler / carrier"→CARRIER, "Both"→BOTH |
| `Full name` | `fullName` | string | |
| `Work email` | `workEmail` | string | lowercased server-side; **required**; dedupe is by responseId |
| `Phone` | `phone` | string? | optional |
| `Company name` | `company` | string? | |
| `LinkedIn URL` | `linkedinUrl` | string? | |
| `Primary operating region (city, state)` | `region` | string? | free-text (e.g. "Dallas, TX") |
| `Do you primarily operate in Texas?` | `texasFocus` | `MOSTLY\|PARTLY\|OUTSIDE` | "Yes, mostly Texas"→MOSTLY; "Partly Texas"→PARTLY; "No, mostly outside Texas"→OUTSIDE. **Required. Drives Geography score.** |
| `Can you test LoadLead with real freight over the next few weeks?` | `commitment.realFreight` | bool | **Hard gate (NO_COMMITMENT)** |
| `Will you commit to one 20-minute feedback call plus a short weekly check-in?` | `commitment.feedbackCall` | bool | **Hard gate (NO_COMMITMENT)** |
| `Best way to reach you for onboarding?` | `commitment.contactPref` | `email\|phone\|sms` | |
| `Referred by anyone?` | `referredBy` | string? | |
| `source` (hidden) | `source` | string? | UTM / channel hidden field |

### SHIPPER block (when `side` is `SHIPPER` or `BOTH`)

| Tally label | BetaApplication path | Notes |
|---|---|---|
| `What type of company are you?` | `sideSpecificData.shipper.companyType` | |
| `What do you ship? (commodities or product types)` (multi) | `sideSpecificData.shipper.commodities[]` | |
| `How many shipments do you move per week?` | `sideSpecificData.shipper.loadsPerWeek` | **band string** ("Under 5", "5-20", …). **Hard gate (LOW_VOLUME)**: "Under 5" → WAITLISTED |
| `Which modes do you use?` (multi) | `sideSpecificData.shipper.modes[]` | |
| `Primary lanes or regions (Shipper)` (multi) | `sideSpecificData.shipper.lanes[]` | feeds lane-overlap helper |
| `How do you book freight today?` | `sideSpecificData.shipper.bookingMethod` | load board / TMS → Tools score = 1 |
| `Your single biggest pain in moving freight right now` | `sideSpecificData.shipper.pain` | staff sets Pain dimension from this |

### CARRIER block (when `side` is `CARRIER` or `BOTH`)

| Tally label | BetaApplication path | Notes |
|---|---|---|
| `MC or DOT number` | `sideSpecificData.carrier.mcOrDot` | **Hard gate (NO_AUTHORITY)**: missing/blank/invalid → WAITLISTED |
| `How many trucks do you run?` | `sideSpecificData.carrier.truckCount` | int |
| `How many loads do you haul per week?` | `sideSpecificData.carrier.loadsPerWeek` | band string (capacity proxy) |
| `What equipment type do you run?` (multi) | `sideSpecificData.carrier.equipment[]` | |
| `Primary lanes or regions (Carrier)` (multi) | `sideSpecificData.carrier.lanes[]` | feeds lane-overlap helper |
| `How do you find loads today?` | `sideSpecificData.carrier.findMethod` | load board / TMS → Tools score = 1 |
| `Your single biggest pain in finding good loads right now` | `sideSpecificData.carrier.pain` | staff sets Pain dimension |

## Section 13 - Scorecard (objective dims computed on ingest)

The webhook pre-computes the **objective** dimensions; staff fill the
subjective ones in the dashboard. Max 15.

| Dimension | Max | Source | Computed on ingest? |
|---|---|---|---|
| Volume | 3 | loadsPerWeek band (<5=0, 5-9=1, 10-24=2, 25+=3) | ✅ |
| Geography / Texas | 3 | texasFocus (MOSTLY=3, PARTLY=2, OUTSIDE=0) | ✅ |
| Tool sophistication | 1 | bookingMethod/findMethod non-empty (load board/TMS) | ✅ |
| Segment fit | 3 | staff | ⛔ (dashboard) |
| Lane overlap | 2 | staff (helper surfaces other-side matches) | ⛔ (dashboard) |
| Pain intensity | 2 | staff | ⛔ (dashboard) |
| Responsiveness | 1 | staff | ⛔ (dashboard) |

## Field mapping is by LABEL, not by question id

Tally re-generates question IDs whenever you reorder the form. The webhook
handler treats labels as keys. Renaming a label in Tally requires a code
change. Adding a new field is safe - unmapped fields get dropped.

## Texas focus is mandatory

`texasFocus` is the only required-strict field beyond identity + the
hard-gate commitments. The webhook rejects the submission (4xx) if it's
missing - applicants can re-submit. This is by design: Texas focus is the
single most important variable in the Geography scoring dimension and the
balance widget.

## See also

- [`Recruitment_Kit.md`](Recruitment_Kit.md) - the scorecard rubric, hard-gate
  rationale, and cohort balance targets that this form feeds.
- `backend/src/routes/tallyWebhook.ts` - the endpoint (raw-body capture +
  signature verify + ingest).
- `backend/src/services/tallySignature.ts` - the HMAC verifier.
- `backend/src/services/betaApplicationService.ts` - `ingestFromTally()`
  reads these labels at runtime.
- `backend/src/services/betaAutoQualify.ts` - encodes the hard gates
  (NO_AUTHORITY / LOW_VOLUME / NO_COMMITMENT) into status transitions.
- `backend/src/services/betaScoring.ts` - encodes the score dimensions.
