# Canopy Apps (agent channel) - requirements brief

Status: GATED CLOSED for the build. The Apps style is a partnership/plan track,
not something the code can unlock on its own, so Phase 10 produces this brief
instead of a shipped integration. The backend is already built so that the day
Apps access is granted, agent-sourced pulls drop into the SAME ingestion
pipeline with source `agent` and verify, cross-reference, and monitor identically
(see "How it lands when opened" below).

## What Apps is, and why LoadLead wants it

An App is an integration that OTHER Canopy Connect users operate on their own
behalf. For LoadLead this is the agent channel: a hauler's insurance agent, who
is already a Canopy user, pushes verified policy data to LoadLead with the
hauler's consent. Many owner-operators run everything through their agent, so
this is a real acquisition and verification channel, not a nice-to-have.

## What the Canopy docs require (from recon)

Creating an App is not self-serve:

- Complete Canopy's "Request Developer Access" form, stating the intent to build
  a Canopy Connect App. A Canopy representative then completes setup.
- Apps start in Sandbox Mode (team-only access); moving to production requires
  contacting Canopy support.

Required App settings (from the docs):

- `Name` - public name shown to Canopy Connect users
- `Description` - short description of the App's purpose
- `Marketing URI` - a landing page on our site explaining the App
- `Logo` - SVG preferred, must be maskable
- `Redirect URIs` - where the user is sent after granting access on the Canopy
  Connect Dashboard

Recommended / conditional settings:

- `IP Whitelist` (recommended), `Auth Start URI` (recommended)
- `Dashboard Send URI` - Canopy POSTs here when a user clicks the "Open in
  [App]" button; this is the agent-initiated data-transfer (send-to) path
- `Dashboard Select Types`, `Dashboard Logo`

The model is OAuth-style: the user authorizes the App on the Canopy dashboard,
and the App then acts on their behalf within the granted scope.

## Open questions for the Canopy technical contact (blocking the build)

1. What exactly does "Request Developer Access" require of us, and what is the
   review / partnership timeline to reach production?
2. Acting on another Canopy user's behalf: what scopes exist, what data does the
   agent channel expose, and what are the consent and revocation semantics?
3. `Dashboard Send URI`: what is the exact POST payload (pull id? a token to
   exchange? the full pull?), and how is it authenticated (the same webhook
   signature scheme as question A7, or an OAuth bearer)?
4. Redirect URI / OAuth: is there a token exchange we must implement, and where
   do the resulting pulls surface (the pulls API by id, same as widget)?
5. Is Apps available on our current plan, or does it require an upgrade?

The founder conversation with Canopy answers 1, 2, and 5; the technical contact
answers 3 and 4.

## How it lands when opened (already built)

The ingestion pipeline is source-agnostic by construction, so the agent build is
a thin front door, not a second pipeline:

- The connection store already carries `sourceMode: 'widget' | 'components' |
  'agent'` (see `carrierInsuranceConnectionsTable`). An agent pull records
  `sourceMode: 'agent'` and is otherwise identical.
- `ingestPullObject(pull, 'agent')` maps the commercial policies, creates the
  INSURER_POLICY document (source CANOPY), runs the verification decision, and
  triggers the COI cross-reference - exactly as for widget/Components pulls.
- The webhook dispatcher (`/api/webhooks/canopy`) already routes pull-completion
  events through the same path; an agent pull needs no new event handling.

## Build plan (when gated open)

1. Register the App per the settings above; capture the client credentials in
   env config (server-side only), mirroring the widget credentials.
2. Implement the `Dashboard Send URI` endpoint (or the OAuth redirect/token
   exchange, per answers to questions 3 and 4). Land the resulting pull id into
   `ingestPull({ pullId, source: 'agent' })`.
3. Record the hauler's authorization of the agent channel as an append-only
   consent row, following the existing consent pattern (a `consentGiven` hard
   gate + a sha256 hash pinning the exact disclosure text + version + actor id +
   signedAt), referencing the carrier by id only.
4. Verify against the sandbox agent flow: an agent-pushed transportation policy
   verifies, cross-references against an uploaded COI, and monitors identically
   to a widget pull.

Nothing else in the pipeline changes: the five-state machine, the append-only
events, the FMCSA check, the cross-reference engine, and monitoring all treat an
agent pull the same as a widget pull.
