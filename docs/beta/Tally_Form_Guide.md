---
connie-title: LoadLead — Beta Application Form (Tally) — Field Guide
connie-publish: true
status: Authoritative
audience: 'form builder · webhook implementer'
---

# LoadLead Beta Application — Tally Form Field Guide

This document is the **authoritative mapping** between the Tally form's
question labels and the `BetaApplication` model. The webhook handler
(`backend/src/services/tallyWebhook.ts`) reads form fields **by label**, so
the labels below must match the Tally form exactly. If you rename a Tally
field, you also rename it here AND ship the code change.

## Webhook setup (one-time, in Tally)

1. Tally → Form → Integrations → "Webhooks" → add a new webhook
2. **URL:** `https://api.loadleadapp.com/api/beta/tally-webhook`
3. **Secret:** copy the value from `TALLY_WEBHOOK_SECRET` in `.env.production`
4. Tally will sign every POST with `Tally-Signature: <base64 HMAC-SHA256>`
   over the raw request body using that secret. The webhook handler verifies
   the signature; unsigned or wrong-signature requests get 401.

If `TALLY_WEBHOOK_SECRET` is unset, the endpoint is **inert** — it returns
`503 form_not_connected` and the admin dashboard surfaces the same status.
There is no fabricated-data fallback.

## Required fields (every applicant)

| Tally label (exact) | BetaApplication field | Type | Notes |
|---|---|---|---|
| `Which side are you?` | `side` | `SHIPPER\|CARRIER\|BOTH` | Drives the branching below |
| `Full name` | `fullName` | string | |
| `Work email` | `workEmail` | string | lowercased server-side; dedupe key |
| `Phone` | `phone` | string? | optional |
| `Company` | `company` | string? | |
| `LinkedIn URL` | `linkedinUrl` | string? | |
| `Region` | `region` | string? | free-text (e.g. "DFW", "Houston metro") |
| `Do you primarily operate in Texas?` | `texasFocus` | `MOSTLY\|PARTLY\|OUTSIDE` | **Drives Geography scoring** |
| `Are you running freight right now?` | `commitment.realFreight` | bool | **Hard gate** |
| `Will you take a 15-min feedback call and a weekly check-in?` | `commitment.feedbackCall` | bool | **Hard gate** |
| `Preferred contact` | `commitment.contactPref` | `email\|phone\|sms` | |
| `Referred by` | `referredBy` | string? | |
| `source` (hidden) | `source` | string? | UTM / channel hidden field |

## SHIPPER branch (when `side` is `SHIPPER` or `BOTH`)

| Tally label | BetaApplication path | Notes |
|---|---|---|
| `What kind of shipper are you?` | `sideSpecificData.shipper.companyType` | |
| `What do you ship?` (multi) | `sideSpecificData.shipper.commodities[]` | |
| `How many shipments per week?` | `sideSpecificData.shipper.loadsPerWeek` | int. **Hard gate**: < 5 → WAITLISTED |
| `Which modes do you use?` (multi) | `sideSpecificData.shipper.modes[]` | |
| `Top 3 lanes` (multi) | `sideSpecificData.shipper.lanes[]` | feeds lane-overlap helper |
| `How do you book today?` | `sideSpecificData.shipper.bookingMethod` | non-empty → Tools=1 |
| `Biggest pain in booking` | `sideSpecificData.shipper.pain` | staff sets Pain dimension from this |

## CARRIER branch (when `side` is `CARRIER` or `BOTH`)

| Tally label | BetaApplication path | Notes |
|---|---|---|
| `MC or DOT number` | `sideSpecificData.carrier.mcOrDot` | **Hard gate**: missing/invalid → DISQUALIFIED |
| `How many trucks?` | `sideSpecificData.carrier.truckCount` | int |
| `Loads per week` | `sideSpecificData.carrier.loadsPerWeek` | int (capacity proxy) |
| `Equipment` (multi) | `sideSpecificData.carrier.equipment[]` | |
| `Top 3 lanes you serve` (multi) | `sideSpecificData.carrier.lanes[]` | feeds lane-overlap helper |
| `How do you find loads today?` | `sideSpecificData.carrier.findMethod` | non-empty → Tools=1 |
| `Biggest pain in finding loads` | `sideSpecificData.carrier.pain` | staff sets Pain dimension |

## Field mapping is by LABEL, not by question id

Tally re-generates question IDs whenever you reorder the form. The webhook
handler treats labels as keys. Renaming a label in Tally requires a code
change. Adding a new field is safe — unmapped fields get dropped.

## Texas focus is mandatory

`texasFocus` is the only required-strict field beyond identity + the
hard-gate commitments. The webhook rejects the submission (4xx) if it's
missing — applicants can re-submit. This is by design: Texas focus is the
single most important variable in the Geography scoring dimension and the
balance widget.

## See also

- [`Recruitment_Kit.md`](Recruitment_Kit.md) — the scorecard rubric, hard-gate
  rationale, and cohort balance targets that this form feeds.
- `backend/src/services/tallyWebhook.ts` — the implementation that reads
  these labels at runtime.
- `backend/src/services/betaAutoQualify.ts` — encodes the hard gates listed
  above into status transitions.
- `backend/src/services/betaScoring.ts` — encodes the score dimensions.
