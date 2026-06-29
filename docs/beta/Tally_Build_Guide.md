---
connie-publish: true
connie-page-id: '4456449'
---
# LoadLead Beta Application — Complete Tally Build Guide

_A single, click-by-click guide to build the public beta application form in Tally, wire it to the LoadLead admin pipeline via a signed webhook, capture Texas focus, and score applicants. Work top to bottom. The form captures raw answers; your admin Beta Program dashboard is the authoritative scorer._

## How Tally editing works (quick primer)
- Add a block: press Enter for a new line, then type `/` to open the block menu (or hover the left margin and click `+`).
- Edit a block: click it; a small toolbar appears with the **Required** toggle and a settings/cog icon.
- Conditional logic lives in a block's settings (cog icon) as **Show block if** (visibility) or **Add logic / Jump to** (routing).
- Webhooks only appear after you **Publish**; later edits stay a draft until you Publish again.

## 0. Before you start
Sign in at tally.so. The free plan covers everything here, including the signed webhook. Have your admin webhook URL ready, or a placeholder to swap in at Step 11.

## 1. Create the form
1. Click **+ Create form**, choose **Start from scratch**.
2. Click the form name (top left) and rename to `LoadLead Beta Application`.

## 2. Page 1: opening, About you, and Texas focus
1. `/` then **Title**: `LoadLead private beta`
2. `/` then **Text**: `We're inviting a limited founding group of active shippers and carriers to test with real freight and shape the roadmap. Takes about 3 minutes. If you're a fit, we'll reach out with access and next steps.`
3. Add these question blocks in order (Required on unless noted):

| Block type | Label | Required |
|---|---|---|
| Short answer | `Full name` | Yes |
| Email | `Work email` | Yes |
| Phone number | `Phone` | Yes |
| Short answer | `Company name` | Yes |
| Short answer | `LinkedIn URL` | No |
| Short answer | `Primary operating region (city, state)` | Yes |
| Multiple choice | `Do you primarily operate in Texas?` | Yes |

For `Do you primarily operate in Texas?`, add exactly three options:
- `Yes, mostly Texas`
- `Partly Texas (Texas plus other regions)`
- `No, mostly outside Texas`

This three-way split is deliberate: "mostly Texas" is the bullseye, "partly" is still useful for Texas lanes, "outside" is de-prioritized, and none is auto-rejected. It maps to a `texasFocus` field (MOSTLY / PARTLY / OUTSIDE) and feeds the Geography score in Section 13. Leave this question with no visibility condition so everyone answers it.

Optional, for tighter matching later: add a **Checkboxes** block `Which Texas markets? (if any)` with `Dallas-Fort Worth`, `Houston`, `Austin`, `San Antonio`, `El Paso`, `Other Texas`. Nice-to-have; the three-way question alone is enough to capture and score.

## 3. The branch question
1. **Multiple choice**, label: `Which best describes you?`
2. Three options:
   - `Shipper (I have freight that needs to move)`
   - `Hauler / carrier (I move freight)`
   - `Both`
3. Required on.

This drives the branching and the `side` field. Keep the wording exactly as above.

## 4. Shipper questions
Insert below the branch question, in order:

| Block type | Label | Options |
|---|---|---|
| Multiple choice | `What type of company are you?` | Manufacturer, Distributor, Retailer, E-commerce, 3PL, Other |
| Long answer | `What do you ship? (commodities or product types)` | - |
| Multiple choice | `How many shipments do you move per week?` | Under 5, 5 to 20, 21 to 50, 50+ |
| Checkboxes | `Which modes do you use?` | Full truckload (FTL), Less than truckload (LTL), Partial, Other |
| Long answer | `Primary lanes or regions (shipper)` | - |
| Multiple choice | `How do you book freight today?` | In-house team, Brokers, 3PL, Load board, Other |
| Long answer | `Your single biggest pain in moving freight right now` | - |

All Required. Then make these seven blocks shipper-only: on each, open settings, set **Show block if** `Which best describes you?` **is one of** `Shipper`, `Both`. (You set the same condition seven times; it is the foolproof way to branch.)

## 5. Carrier questions
Insert next, in order:

| Block type | Label | Options |
|---|---|---|
| Short answer | `MC or DOT number` | - |
| Multiple choice | `How many trucks do you run?` | 1, 2 to 5, 6 to 20, 20+ |
| Multiple choice | `How many loads do you haul per week?` | Under 5, 5 to 20, 21 to 50, 50+ |
| Checkboxes | `What equipment types do you run?` | Dry van, Reefer, Flatbed, Step deck, Lowboy / RGN, Conestoga, Tanker, Hopper, Car hauler, Box truck, Other |
| Long answer | `Primary lanes or regions (carrier)` | - |
| Multiple choice | `How do you find loads today?` | Load board, Broker relationships, Dispatcher, Other |
| Long answer | `Your single biggest pain in finding good loads right now` | - |

All Required. Make these seven carrier-only: on each, set **Show block if** `Which best describes you?` **is one of** `Hauler / carrier`, `Both`.

Result: a shipper sees only shipper questions, a carrier only carrier questions, and "Both" sees both sets.

## 6. Commitment and close
Insert last, with no visibility condition (everyone answers):

| Block type | Label | Options | Required |
|---|---|---|---|
| Multiple choice | `Can you test LoadLead with real freight over the next few weeks?` | Yes, No | Yes |
| Multiple choice | `Will you commit to one 20-minute feedback call plus a short weekly check-in?` | Yes, No | Yes |
| Multiple choice | `Best way to reach you for onboarding?` | Email, Phone, Text | Yes |
| Long answer | `Anything else we should know?` | - | No |
| Short answer | `Referred by anyone?` | - | No |

## 7. End screens (qualified vs waitlist)
1. Click the default **Thank you** page and set the **Qualified** message: `You're a strong fit. We'll reach out shortly with access and next steps. Thanks for applying to the LoadLead founding cohort.`
2. Add a second end page (**+ Add page** near the thank-you controls), the **Waitlist** page: `Thanks for applying. We're admitting our founding group in small, balanced waves, and we've added you to the list. We'll be in touch as seats open.`

## 8. The qualifying gates (route failures to Waitlist)
Add three logic rules so hard-gate failures land on the Waitlist screen; everyone else falls through to Qualified. On the relevant question, open settings, **Add logic / Jump to**:

1. IF `How many shipments do you move per week?` is `Under 5` then jump to the **Waitlist** page.
2. IF `Can you test LoadLead with real freight over the next few weeks?` is `No` then jump to the **Waitlist** page.
3. IF `Will you commit to one 20-minute feedback call plus a short weekly check-in?` is `No` then jump to the **Waitlist** page.

Notes:
- Leave **MC or DOT number Required** (Section 5). The form guarantees an entry; your admin dashboard does the real authority validation, so no end-screen rule is needed for it.
- The "Under 5" rule only fires for people who saw the shipper question. A "Both" applicant who ships under 5 but hauls actively lands on Waitlist here; that is fine, you can promote them from the admin dashboard, which holds the final decision. Conservative on the form, precise in the console.
- Reaching either end screen still submits the response, so waitlisted applicants' data still flows to your pipeline.

## 9. Hidden field for attribution
1. Form **Settings** then **Hidden fields**, add one named `source`.
2. Share with the value in the URL: `.../your-form?source=linkedin`. Make different links for your LinkedIn post (`source=linkedin`), profile (`source=profile`), and direct outreach (`source=direct`). The value rides along in the webhook and maps to `BetaApplication.source`.

## 10. Publish
Click **Publish** (top right).

## 11. Connect the webhook (with signature verification)
1. Generate a signing secret: `openssl rand -hex 32`, or any 32+ char random string. Save it safely.
2. In the published form, open the **Integrations** tab and **Connect** on **Webhooks**.
3. **Endpoint URL:** your admin beta webhook, e.g. `https://api.loadleadapp.com/api/admin/beta/webhook`.
4. **Signing secret:** paste the secret. Tally signs each request and sends a `Tally-Signature` header (SHA256 HMAC, base64). Give this exact secret to whoever wires the admin webhook so it can verify each request.
5. **Custom header (optional):** add `X-Beta-Source` = `tally` so the endpoint can also cheaply reject anything without it.
6. Save. Tally retries failed deliveries (5 min, 30 min, 1 hr, 6 hr, 1 day); your endpoint must reply 2XX within 10 seconds, so the admin route should acknowledge fast and process the rest in the background.

## 12. Field mapping for the admin webhook
The webhook sends each answer as `{ key, label, type, value }`. Map by **label** (exactly as typed) into `BetaApplication`:

- `Full name` -> fullName, `Work email` -> workEmail, `Phone` -> phone, `Company name` -> company, `LinkedIn URL` -> linkedinUrl, `Primary operating region (city, state)` -> region
- `Do you primarily operate in Texas?` -> texasFocus (Yes, mostly Texas -> MOSTLY; Partly Texas -> PARTLY; No, mostly outside Texas -> OUTSIDE)
- `Which best describes you?` -> side (Shipper / Hauler / carrier / Both -> SHIPPER / CARRIER / BOTH)
- Shipper block -> sideSpecificData.shipper: companyType, commodities (What do you ship), loadsPerWeek, modes, lanes (Primary lanes or regions (shipper)), bookingMethod, pain
- Carrier block -> sideSpecificData.carrier: mcOrDot, truckCount, loadsPerWeek, equipment, lanes (Primary lanes or regions (carrier)), findMethod, pain
- Commitment -> commitment: realFreight, feedbackCall, contactPref
- `Referred by anyone?` -> referredBy, hidden `source` -> source
- Dedupe on the payload's `responseId`.

The two "Primary lanes" questions have distinct labels (shipper vs carrier) on purpose, so the webhook never confuses which side's lanes it received.

## 13. Scoring (apply in the admin Beta Program dashboard)
The form only captures inputs; the admin dashboard is the authoritative scorer. Updated scorecard with Geography added as its own dimension (15-point max):

| Dimension | Looking for | Points |
|---|---|---|
| Volume | More loads per week = more usage and richer feedback | 0 to 3 |
| Segment fit | Matches your ICP | 0 to 3 |
| Geography (Texas focus) | Mostly Texas = bullseye; partly = useful; outside = de-prioritized | 0 to 3 |
| Lane overlap | Shares lanes with testers on the other side | 0 to 2 |
| Pain intensity | A real, specific, current pain in their own words | 0 to 2 |
| Tool sophistication | Already uses a load board or TMS, so they can compare | 0 to 1 |
| Responsiveness | Replied fast, complete answers, clear commitment | 0 to 1 |

Geography rule: `Yes, mostly Texas` = 3, `Partly Texas` = 2, `No, mostly outside Texas` = 0. Texas is a meaningful but not dominant share (3 of 15), so a high-volume, high-pain out-of-state applicant can still score into contention while Texas applicants get a clear, deliberate boost. Treat Texas as a hard preference, not a hard gate.

Weight Texas alongside lane overlap, not instead of it: a Texas shipper and a Texas carrier are exactly the kind of pair that matches, so Texas focus should compound with lane overlap. The strongest pick is an applicant who is both Texas-focused and shares a lane with someone already admitted on the other side.

Which question feeds which dimension: loads-per-week -> Volume; company type and equipment -> Segment fit; `Do you primarily operate in Texas?` -> Geography; the lanes fields -> Lane overlap; the pain text -> Pain intensity; booking/finding method -> Tool sophistication. Responsiveness has no question (it reflects how fast and completely they replied), so set it by hand.

If the Claude-built intake artifact also scores, mirror this same Geography rule there so the two do not diverge. The dashboard is the one that counts.

## 14. Test the round-trip before sharing
1. Submit as a **qualified Texas carrier** (MC filled, 5 to 20 loads, mostly Texas, both commitments Yes): you should land on Qualified, a `BetaApplication` should appear in the admin dashboard with texasFocus = MOSTLY and a Geography score of 3.
2. Submit as an **under-5 shipper**: you should land on Waitlist, and the admin record should auto-flag to waitlist.
3. Resubmit the same response: confirm it does not create a duplicate.
4. Once those pass, drop your `?source=linkedin` link in the post.

---

## Quick reference: full question order
1. Full name
2. Work email
3. Phone
4. Company name
5. LinkedIn URL (optional)
6. Primary operating region (city, state)
7. Do you primarily operate in Texas?
8. Which best describes you? (branch)
9-15. Shipper block (visible to Shipper/Both): company type, what you ship, shipments per week, modes, lanes (shipper), booking method, biggest pain
16-22. Carrier block (visible to Hauler/Both): MC/DOT, trucks, loads per week, equipment, lanes (carrier), find method, biggest pain
23. Can you test with real freight?
24. Will you commit to the feedback call + weekly check-in?
25. Best way to reach you?
26. Anything else? (optional)
27. Referred by anyone? (optional)
Hidden: source
