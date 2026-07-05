---
connie-title: LoadLead - Beta Recruitment Kit (cohort plan + scorecard)
connie-publish: true
status: Authoritative
audience: staff scoring applicants · founders setting cohort policy
connie-page-id: '4489217'
---

# LoadLead - Beta Recruitment Kit

The **policy** behind who gets into the private beta. Code under
`backend/src/services/beta*.ts` encodes this kit verbatim - if you change
this doc, you ship the corresponding code change in the same PR.

## Cohort plan

| | Wave 1 | Wave 2 |
|---|---|---|
| Target size | ~30 accounts | ~60 accounts |
| Shipper : Carrier ratio | 1 : 1 (±20%) | 1 : 1 (±20%) |
| Texas focus | ≥80% MOSTLY-Texas | ≥60% MOSTLY-Texas |
| Use real freight from day 1 | Required | Required |
| Weekly feedback cadence | Required | Required |

The shipper:carrier ratio is the **headline metric** on the dashboard. Out
of balance ratios make Wave-N freight unmatchable - a 10-shipper / 2-carrier
imbalance means most loads sit unaccepted, the cohort produces bad data,
and we lose feedback signal. Don't admit any side past +20% of the other
without an explicit override note from a founder.

## Hard gates (auto-applied on Tally ingest)

Every BetaApplication runs these checks the moment the webhook lands. The
auto-qualifier sets `status` and writes `autoFlags[]` so staff can see why.

| Flag | Condition | Status set |
|---|---|---|
| `NO_AUTHORITY` | side ∈ {CARRIER, BOTH} ∧ `mcOrDot` missing/blank or fails `^(MC\|DOT)?[\s-]?\d{4,8}$` | **WAITLISTED** |
| `LOW_VOLUME` | side ∈ {SHIPPER, BOTH} ∧ shipper.loadsPerWeek band is "Under 5" (< 5) | **WAITLISTED** |
| `NO_COMMITMENT` | `commitment.realFreight === false` OR `commitment.feedbackCall === false` | **WAITLISTED** |
| _(no flags)_ | passes all the above | **QUALIFIED** (ready to score) |

**Auto-qualify never assigns DISQUALIFIED.** All auto-fails land WAITLISTED
so the applicant stays in the pipeline for a possible later wave; the
dashboard's waitlist tab shows them with their auto-flags so staff can
decide whether to override. `DISQUALIFIED` is a **staff-only** verdict
(e.g. fake credentials caught on manual review).

Geography/Texas is a **scoring** dimension, not an auto-gate: an
OUTSIDE-Texas applicant is QUALIFIED with Geography=0 - scored down, not
gated out.

## Scorecard (max 15 points)

Applied only after an applicant is `QUALIFIED`. Subjective dimensions
(Segment fit, Lane overlap, Pain, Responsiveness) are staff-edited; the
objective dimensions (Volume, Geography, Tools) are pre-computed at ingest.

| Dimension | Max | How |
|---|---|---|
| **Volume** | 3 | _Auto from loadsPerWeek_. 0=<5, 1=5-9, 2=10-24, 3=25+ |
| **Segment fit** | 3 | Staff. Does this applicant fit the cohort thesis (e.g. flatbed-on-Texas-triangle)? |
| **Geography / Texas** | 3 | _Auto from texasFocus_. MOSTLY=3, PARTLY=2, OUTSIDE=0 |
| **Lane overlap** | 2 | Staff. How well do their lanes overlap with already-admitted other-side accounts? The detail view surfaces overlapping accounts. |
| **Pain intensity** | 2 | Staff. How acute is the problem? Strong "I can't grow because of this" → 2. Mild → 1. Vague → 0. |
| **Tool sophistication** | 1 | _Auto from bookingMethod / findMethod_. Non-empty → 1, blank → 0 |
| **Responsiveness** | 1 | Staff. Replied within 24h to the first outreach? Yes → 1. |
| **Total** | **15** | |

Admit threshold is **soft**: typically ≥10 admits in Wave 1, ≥8 in Wave 2.
Founders can override either direction with a notes-row.

## Lane-overlap helper

When viewing a SHIPPER application, the detail panel shows all CARRIER
applications/admitted accounts whose `lanes[]` share an origin OR
destination region with the shipper's `lanes[]`. Same in reverse.
Carriers with overlap > 0 get a Lane-overlap score nudge (staff still
decides 0/1/2).

Texas weighting in the helper: a Texas-MOSTLY shipper paired with a
Texas-MOSTLY carrier shows up at the top of each other's overlap lists
even if the precise lane strings don't match, because the cohort thesis
favors that pairing.

## Admit flow (what happens on click)

1. Staff click **Admit** on a scored, QUALIFIED application
2. Server:
   - Adds `workEmail` to `BetaAllowlist` (type=EMAIL, addedByStaffId=<admin>)
   - Issues an `OrgInvitation` via the existing service:
     - For SHIPPER / OWNER_OPERATOR / RECEIVER / DRIVER side: a self-signup
       invite (orgId=null, userRole=<persona>)
     - For CARRIER side: a carrier-org admin invite (orgId=existing or
       pending - staff specifies)
   - Sets `BetaApplication.status = ADMITTED → INVITED`, stamps `cohort`,
     `wave`, `linkedInvitationToken`
3. When the applicant later signs up via that invite, the gate sets
   `user.betaUser=true`, `cohort=<from invite>`, `invitedVia=INVITE`, and
   the application transitions to `ONBOARDED`

Admit NEVER creates a parallel invite mechanism. It reuses `OrgInvitationService`.

## Public launch

Set `BETA_MODE=off` in production env. The gate stops gating; existing
`betaUser` accounts keep their cohort tag for filtering and post-launch
study. There is no "graduation" event - beta accounts simply convert to
normal accounts at the flag flip.

## See also

- [`Tally_Form_Guide.md`](Tally_Form_Guide.md) - the form fields that feed
  every column of `BetaApplication`.
- [`PendingRegister.md`](../PendingRegister.md) - open items including
  any beta-related gaps surfaced after build.
