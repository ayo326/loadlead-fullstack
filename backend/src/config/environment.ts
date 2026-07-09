import dotenv from 'dotenv';
import path from 'path';

// Always load backend/.env (works even when running from repo root)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Table-name resolution with a single-knob prefix override.
//
// Prod sets neither a per-table DYNAMODB_*_TABLE var nor DYNAMODB_TABLE_PREFIX,
// so every table falls through to its hardcoded `LoadLead_*` default - prod
// behavior is byte-for-byte unchanged. Non-prod stacks (staging/dev) set a
// single DYNAMODB_TABLE_PREFIX (e.g. "LoadLead-Staging-") instead of enumerating
// ~50 individual table overrides, which busted Elastic Beanstalk's 4096-char
// aggregate EnvironmentVariables limit (each override resolves to the same
// value the enumerated var used to: prefix + the default minus its LoadLead_
// stem). A per-table DYNAMODB_*_TABLE var still wins when present, so a stack
// can pin any single table explicitly.
const tablePrefix = process.env.DYNAMODB_TABLE_PREFIX;
function t(envVar: string, prodDefault: string): string {
  const explicit = process.env[envVar];
  if (explicit) return explicit;
  if (tablePrefix) return tablePrefix + prodDefault.replace(/^LoadLead[_-]/, '');
  return prodDefault;
}

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // APP_ENV is the deliberate, explicit environment signal - distinct from
  // NODE_ENV, which EB/npm tooling often forces to "production" for every
  // environment (dev/staging included) as a build optimization flag. Every
  // production-lockdown decision (services/integrations) keys off APP_ENV,
  // never NODE_ENV.
  appEnv: process.env.APP_ENV || 'development',

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },

  dynamodb: {
    endpoint: process.env.DYNAMODB_ENDPOINT,

    usersTable: t('DYNAMODB_USERS_TABLE', 'LoadLead_Users'),
    driversTable: t('DYNAMODB_DRIVERS_TABLE', 'LoadLead_Drivers'),
    shippersTable: t('DYNAMODB_SHIPPERS_TABLE', 'LoadLead_Shippers'),
    receiversTable: t('DYNAMODB_RECEIVERS_TABLE', 'LoadLead_Receivers'),
    loadsTable: t('DYNAMODB_LOADS_TABLE', 'LoadLead_Loads'),
    offersTable: t('DYNAMODB_OFFERS_TABLE', 'LoadLead_Offers'),
    bolTable: t('DYNAMODB_BOL_TABLE', 'LoadLead_BOL'),
    orgsTable: t('DYNAMODB_ORGS_TABLE', 'LoadLead_Organizations'),
    membershipsTable: t('DYNAMODB_MEMBERSHIPS_TABLE', 'LoadLead_Memberships'),
    // Append-only membership audit log (role change / invite / removal).
    // NOTE: the live prod table is dash-named `LoadLead-MembershipAuditLogs`
    // (created out-of-band; holds real data) - the default MUST match it or prod
    // silently writes to a nonexistent table. Non-prod stacks derive from the
    // prefix (LoadLead[_-] stem stripped, so both forms map to the same suffix).
    membershipAuditTable: t('DYNAMODB_MEMBERSHIP_AUDIT_TABLE', 'LoadLead-MembershipAuditLogs'),
    invitationsTable: t('DYNAMODB_INVITATIONS_TABLE', 'LoadLead_Invitations'),
    betaAllowlistTable: t('DYNAMODB_BETA_ALLOWLIST_TABLE', 'LoadLead_BetaAllowlist'),
    waitlistTable: t('DYNAMODB_WAITLIST_TABLE', 'LoadLead_Waitlist'),
    betaApplicationsTable: t('DYNAMODB_BETA_APPLICATIONS_TABLE', 'LoadLead_BetaApplications'),
    // Beta-admin trust/operational events (no-show, trust incident). Intentionally
    // separate from the Load model; records reference a load and carrier by id only.
    betaTrustEventsTable: t('DYNAMODB_BETA_TRUST_EVENTS_TABLE', 'LoadLead_BetaTrustEvents'),
    // ── Support / helpdesk ──────────────────────────────────────────────────
    // Routed through config (not inline in supportTicket.ts) so the boot guard
    // and check-table-env-parity cover them like every other table. Default is
    // the prod `LoadLead_` form; non-prod stacks derive from DYNAMODB_TABLE_PREFIX.
    supportTicketsTable: t('DYNAMODB_SUPPORT_TICKETS_TABLE', 'LoadLead_SupportTickets'),
    supportMessagesTable: t('DYNAMODB_SUPPORT_MESSAGES_TABLE', 'LoadLead_SupportMessages'),
    supportSettingsTable: t('DYNAMODB_SUPPORT_SETTINGS_TABLE', 'LoadLead_SupportSettings'),
    supportInboundTable: t('DYNAMODB_SUPPORT_INBOUND_TABLE', 'LoadLead_SupportInbound'),
    // Append-only platform fee policy changes (linehaul take rate + beta waiver).
    // Current policy = newest row; never updated or deleted. Each change carries
    // an actor and timestamp. Falls back to the seeded default when empty/missing.
    platformFeePolicyTable: t('DYNAMODB_PLATFORM_FEE_POLICY_TABLE', 'LoadLead_PlatformFeePolicy'),
    // Per-load accessorial policy (detention/layover terms), keyed by loadId.
    // Pre-filled from defaults + the load's rate class; charges freeze a snapshot.
    accessorialPoliciesTable: t('DYNAMODB_ACCESSORIAL_POLICIES_TABLE', 'LoadLead_AccessorialPolicies'),
    // Append-only ESIGN/UETA acceptances of a load's accessorial policy. References
    // the load by id; pins the accepted version + policy hash. Never updated/deleted.
    accessorialPolicyAcceptancesTable:
      t('DYNAMODB_ACCESSORIAL_POLICY_ACCEPTANCES_TABLE', 'LoadLead_AccessorialPolicyAcceptances'),
    // Append-only shipper agreements to a load's accessorial terms at posting.
    // Pins the agreed policy version + exact values; never updated or deleted.
    shipperAgreementsTable:
      t('DYNAMODB_SHIPPER_AGREEMENTS_TABLE', 'LoadLead_ShipperAgreements'),

    // ── Platform-admin compliance/oversight layer ───────────────────────────
    // Append-only admin audit log (the audit of the auditors): every sensitive
    // read, export, disclosure, adjudication, hold, and intercept.
    adminAuditLogTable: t('DYNAMODB_ADMIN_AUDIT_LOG_TABLE', 'LoadLead_AdminAuditLog'),
    // Per-user compliance-role grants (DISPUTE_ADMIN, LEGAL_ADMIN, LAW_ENFORCEMENT_LIAISON).
    complianceGrantsTable: t('DYNAMODB_COMPLIANCE_GRANTS_TABLE', 'LoadLead_ComplianceGrants'),
    // Append-only dispute/discrepancy adjudication outcomes (compensating entries).
    adjudicationsTable: t('DYNAMODB_ADJUDICATIONS_TABLE', 'LoadLead_Adjudications'),
    // Append-only legal hold registry (place/release events) keyed by entity.
    legalHoldsTable: t('DYNAMODB_LEGAL_HOLDS_TABLE', 'LoadLead_LegalHolds'),
    // Append-only law-enforcement request intake records (counsel-gated).
    lawEnforcementRequestsTable:
      t('DYNAMODB_LAW_ENFORCEMENT_REQUESTS_TABLE', 'LoadLead_LawEnforcementRequests'),
    // Append-only disclosure records (what left the platform, to whom, when, under which request).
    disclosuresTable: t('DYNAMODB_DISCLOSURES_TABLE', 'LoadLead_Disclosures'),
    // Append-only payout-intercept records (garnishment, levy, lien).
    payoutInterceptsTable: t('DYNAMODB_PAYOUT_INTERCEPTS_TABLE', 'LoadLead_PayoutIntercepts'),
    // Load negotiation (engage/bid/counter): session rows, append-only offer
    // rows, and the per-load exclusivity lock. The Load model is never touched;
    // everything references the load and the parties by id.
    loadNegotiationsTable: t('DYNAMODB_LOAD_NEGOTIATIONS_TABLE', 'LoadLead_LoadNegotiations'),
    negotiationOffersTable: t('DYNAMODB_NEGOTIATION_OFFERS_TABLE', 'LoadLead_NegotiationOffers'),
    negotiationLocksTable: t('DYNAMODB_NEGOTIATION_LOCKS_TABLE', 'LoadLead_NegotiationLocks'),
    // Append-only stop-events log (check-in/check-out). Detention/layover are
    // computed from these immutable events. References load + stop by id only.
    stopEventsTable: t('DYNAMODB_STOP_EVENTS_TABLE', 'LoadLead_StopEvents'),
    // Accessorial charge ledger (DETENTION/LAYOVER), keyed by deterministic
    // chargeId so a recompute updates in place. Live status/amount; the immutable
    // trail is the status-history table below.
    accessorialChargesTable: t('DYNAMODB_ACCESSORIAL_CHARGES_TABLE', 'LoadLead_AccessorialCharges'),
    // Append-only charge status transitions (original/new amounts on adjust).
    chargeStatusHistoryTable:
      t('DYNAMODB_CHARGE_STATUS_HISTORY_TABLE', 'LoadLead_AccessorialChargeStatusHistory'),
    // Append-only factoring assignment log. A release/change is a new row; the
    // active assignment resolves with invoice-level precedence over account-level.
    factoringAssignmentsTable:
      t('DYNAMODB_FACTORING_ASSIGNMENTS_TABLE', 'LoadLead_FactoringAssignments'),
    // Append-only Notices of Assignment. Snapshots the legal redirection text;
    // references the assignment, carrier, invoice, and debtor by id.
    noticesOfAssignmentTable:
      t('DYNAMODB_NOTICES_OF_ASSIGNMENT_TABLE', 'LoadLead_NoticesOfAssignment'),
    // Append-only funding advances. No advance against a non-APPROVED accessorial;
    // idempotent per (invoice, line). References invoice/carrier/charge by id.
    fundingAdvancesTable: t('DYNAMODB_FUNDING_ADVANCES_TABLE', 'LoadLead_FundingAdvances'),
    // Append-only reconciliation + recourse outcomes (payment routing, reserve
    // release, supplemental advance, recourse buyback, non-recourse loss).
    reconciliationOutcomesTable:
      t('DYNAMODB_RECONCILIATION_OUTCOMES_TABLE', 'LoadLead_ReconciliationOutcomes'),
    // Saved factor contact per carrier/owner-operator (pre-fills the send recipient).
    factorContactsTable: t('DYNAMODB_FACTOR_CONTACTS_TABLE', 'LoadLead_FactorContacts'),
    // Append-only factoring submission records (export-and-send disclosure trail).
    factoringSubmissionsTable:
      t('DYNAMODB_FACTORING_SUBMISSIONS_TABLE', 'LoadLead_FactoringSubmissions'),
    // Attestation chain - append-only, IAM-deny-update/delete, attribute_not_exists Put.
    signaturesTable: t('DYNAMODB_SIGNATURES_TABLE', 'LoadLead_Signatures'),
    // Pod photo finalize step records contentHash + stage; same DDB row as the
    // photo metadata. Same table as load attachments in the long run; isolated
    // for now so app reads stay simple.
    podPhotosTable: t('DYNAMODB_POD_PHOTOS_TABLE', 'LoadLead_PodPhotos'),
    // ── Carrier compliance documents (W9, COI, Letter of Authority) ─────────
    // Append-only, versioned compliance documents on the hauler (or driver)
    // entity. A re-upload is a new row that supersedes the prior version; old
    // rows are never deleted. The W9 TIN is never stored here in plaintext.
    complianceDocumentsTable:
      t('DYNAMODB_COMPLIANCE_DOCUMENTS_TABLE', 'LoadLead_ComplianceDocuments'),
    // Append-only verification events for a compliance document (SUBMITTED,
    // AUTO_CHECK_PASSED/FAILED, VERIFIED, REJECTED, EXPIRED). Never mutated.
    complianceVerificationEventsTable:
      t('DYNAMODB_COMPLIANCE_VERIFICATION_EVENTS_TABLE', 'LoadLead_ComplianceVerificationEvents'),
    // Append-only access log of every full-W9 open (viewer, relationship basis,
    // when). The most sensitive read on the platform; never mutated or deleted.
    w9AccessLogTable: t('DYNAMODB_W9_ACCESS_LOG_TABLE', 'LoadLead_W9AccessLog'),
    // Versioned shipper compliance policies (Phase 7). Editing creates a new
    // version; prior versions are never mutated. Snapshotted onto a load at accept.
    shipperCompliancePoliciesTable:
      t('DYNAMODB_SHIPPER_COMPLIANCE_POLICIES_TABLE', 'LoadLead_ShipperCompliancePolicies'),
    // Append-only snapshots of the shipper policy version pinned onto a load at
    // acceptance, plus the hauler's signature reference. References load by id.
    shipperPolicyAttachmentsTable:
      t('DYNAMODB_SHIPPER_POLICY_ATTACHMENTS_TABLE', 'LoadLead_ShipperPolicyAttachments'),
  },

  // KMS-backed envelope encryption for the W9 TIN (the most sensitive field on
  // the platform). keyId is provisioned by platform Terraform; in local/test
  // mode the fieldCrypto helper falls back to a deterministic local stub so dev
  // and CI run without AWS. See src/utils/fieldCrypto.ts.
  kms: {
    w9TinKeyId: process.env.W9_TIN_KMS_KEY_ID || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  google: {
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  },

  app: {
    broadcastRadius: parseInt(process.env.BROADCAST_RADIUS_MILES || '50'),
    offerTtl: parseInt(process.env.OFFER_TTL_MINUTES || '15'),
    minMcMaturity: parseInt(process.env.MIN_MC_MATURITY_DAYS || '90'),
  },
};

export default config;
