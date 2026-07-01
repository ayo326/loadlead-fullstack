import dotenv from 'dotenv';
import path from 'path';

// Always load backend/.env (works even when running from repo root)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // APP_ENV is the deliberate, explicit environment signal — distinct from
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

    usersTable: process.env.DYNAMODB_USERS_TABLE || 'LoadLead_Users',
    driversTable: process.env.DYNAMODB_DRIVERS_TABLE || 'LoadLead_Drivers',
    shippersTable: process.env.DYNAMODB_SHIPPERS_TABLE || 'LoadLead_Shippers',
    receiversTable: process.env.DYNAMODB_RECEIVERS_TABLE || 'LoadLead_Receivers',
    loadsTable: process.env.DYNAMODB_LOADS_TABLE || 'LoadLead_Loads',
    offersTable: process.env.DYNAMODB_OFFERS_TABLE || 'LoadLead_Offers',
    bolTable: process.env.DYNAMODB_BOL_TABLE || 'LoadLead_BOL',
    orgsTable: process.env.DYNAMODB_ORGS_TABLE || 'LoadLead_Organizations',
    membershipsTable: process.env.DYNAMODB_MEMBERSHIPS_TABLE || 'LoadLead_Memberships',
    invitationsTable: process.env.DYNAMODB_INVITATIONS_TABLE || 'LoadLead_Invitations',
    betaAllowlistTable: process.env.DYNAMODB_BETA_ALLOWLIST_TABLE || 'LoadLead_BetaAllowlist',
    waitlistTable: process.env.DYNAMODB_WAITLIST_TABLE || 'LoadLead_Waitlist',
    betaApplicationsTable: process.env.DYNAMODB_BETA_APPLICATIONS_TABLE || 'LoadLead_BetaApplications',
    // Beta-admin trust/operational events (no-show, trust incident). Intentionally
    // separate from the Load model; records reference a load and carrier by id only.
    betaTrustEventsTable: process.env.DYNAMODB_BETA_TRUST_EVENTS_TABLE || 'LoadLead_BetaTrustEvents',
    // Append-only platform fee policy changes (linehaul take rate + beta waiver).
    // Current policy = newest row; never updated or deleted. Each change carries
    // an actor and timestamp. Falls back to the seeded default when empty/missing.
    platformFeePolicyTable: process.env.DYNAMODB_PLATFORM_FEE_POLICY_TABLE || 'LoadLead_PlatformFeePolicy',
    // Per-load accessorial policy (detention/layover terms), keyed by loadId.
    // Pre-filled from defaults + the load's rate class; charges freeze a snapshot.
    accessorialPoliciesTable: process.env.DYNAMODB_ACCESSORIAL_POLICIES_TABLE || 'LoadLead_AccessorialPolicies',
    // Append-only ESIGN/UETA acceptances of a load's accessorial policy. References
    // the load by id; pins the accepted version + policy hash. Never updated/deleted.
    accessorialPolicyAcceptancesTable:
      process.env.DYNAMODB_ACCESSORIAL_POLICY_ACCEPTANCES_TABLE || 'LoadLead_AccessorialPolicyAcceptances',
    // Append-only stop-events log (check-in/check-out). Detention/layover are
    // computed from these immutable events. References load + stop by id only.
    stopEventsTable: process.env.DYNAMODB_STOP_EVENTS_TABLE || 'LoadLead_StopEvents',
    // Accessorial charge ledger (DETENTION/LAYOVER), keyed by deterministic
    // chargeId so a recompute updates in place. Live status/amount; the immutable
    // trail is the status-history table below.
    accessorialChargesTable: process.env.DYNAMODB_ACCESSORIAL_CHARGES_TABLE || 'LoadLead_AccessorialCharges',
    // Append-only charge status transitions (original/new amounts on adjust).
    chargeStatusHistoryTable:
      process.env.DYNAMODB_CHARGE_STATUS_HISTORY_TABLE || 'LoadLead_AccessorialChargeStatusHistory',
    // Append-only factoring assignment log. A release/change is a new row; the
    // active assignment resolves with invoice-level precedence over account-level.
    factoringAssignmentsTable:
      process.env.DYNAMODB_FACTORING_ASSIGNMENTS_TABLE || 'LoadLead_FactoringAssignments',
    // Append-only Notices of Assignment. Snapshots the legal redirection text;
    // references the assignment, carrier, invoice, and debtor by id.
    noticesOfAssignmentTable:
      process.env.DYNAMODB_NOTICES_OF_ASSIGNMENT_TABLE || 'LoadLead_NoticesOfAssignment',
    // Append-only funding advances. No advance against a non-APPROVED accessorial;
    // idempotent per (invoice, line). References invoice/carrier/charge by id.
    fundingAdvancesTable: process.env.DYNAMODB_FUNDING_ADVANCES_TABLE || 'LoadLead_FundingAdvances',
    // Append-only reconciliation + recourse outcomes (payment routing, reserve
    // release, supplemental advance, recourse buyback, non-recourse loss).
    reconciliationOutcomesTable:
      process.env.DYNAMODB_RECONCILIATION_OUTCOMES_TABLE || 'LoadLead_ReconciliationOutcomes',
    // Saved factor contact per carrier/owner-operator (pre-fills the send recipient).
    factorContactsTable: process.env.DYNAMODB_FACTOR_CONTACTS_TABLE || 'LoadLead_FactorContacts',
    // Append-only factoring submission records (export-and-send disclosure trail).
    factoringSubmissionsTable:
      process.env.DYNAMODB_FACTORING_SUBMISSIONS_TABLE || 'LoadLead_FactoringSubmissions',
    // Attestation chain — append-only, IAM-deny-update/delete, attribute_not_exists Put.
    signaturesTable: process.env.DYNAMODB_SIGNATURES_TABLE || 'LoadLead_Signatures',
    // Pod photo finalize step records contentHash + stage; same DDB row as the
    // photo metadata. Same table as load attachments in the long run; isolated
    // for now so app reads stay simple.
    podPhotosTable: process.env.DYNAMODB_POD_PHOTOS_TABLE || 'LoadLead_PodPhotos',
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
