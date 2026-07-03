import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url) });

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const endpoint = process.env.DYNAMODB_ENDPOINT;
const region = process.env.AWS_REGION || "us-east-1";

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "local",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "local",
  },
});

const TABLES = [
  {
    TableName: process.env.DYNAMODB_USERS_TABLE || "LoadLead_Users",
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "email", AttributeType: "S" },
    ],
    KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "email-index",
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_DRIVERS_TABLE || "LoadLead_Drivers",
    AttributeDefinitions: [
      { AttributeName: "driverId", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "N" },
    ],
    KeySchema: [{ AttributeName: "driverId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "status-index",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_SHIPPERS_TABLE || "LoadLead_Shippers",
    AttributeDefinitions: [{ AttributeName: "shipperId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "shipperId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_RECEIVERS_TABLE || "LoadLead_Receivers",
    AttributeDefinitions: [{ AttributeName: "receiverId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "receiverId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_LOADS_TABLE || "LoadLead_Loads",
    AttributeDefinitions: [
      { AttributeName: "loadId", AttributeType: "S" },
      { AttributeName: "shipperId", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "N" },
    ],
    KeySchema: [{ AttributeName: "loadId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "shipperId-index",
        KeySchema: [
          { AttributeName: "shipperId", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "status-createdAt-index",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_OFFERS_TABLE || "LoadLead_Offers",
    AttributeDefinitions: [
      { AttributeName: "loadId", AttributeType: "S" },
      { AttributeName: "driverId", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "loadId", KeyType: "HASH" },
      { AttributeName: "driverId", KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "driverId-status-index",
        KeySchema: [
          { AttributeName: "driverId", KeyType: "HASH" },
          { AttributeName: "status", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Beta-admin trust/operational events (no-show, trust incident). Separate
    // from the Load table on purpose; references a load and carrier by id only.
    TableName: process.env.DYNAMODB_BETA_TRUST_EVENTS_TABLE || "LoadLead_BetaTrustEvents",
    AttributeDefinitions: [{ AttributeName: "eventId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only platform fee policy changes (linehaul take rate + beta waiver).
    // Current policy = newest row; rows are never updated or deleted.
    TableName: process.env.DYNAMODB_PLATFORM_FEE_POLICY_TABLE || "LoadLead_PlatformFeePolicy",
    AttributeDefinitions: [{ AttributeName: "changeId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "changeId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Per-load accessorial policy (detention/layover terms), keyed by loadId.
    TableName: process.env.DYNAMODB_ACCESSORIAL_POLICIES_TABLE || "LoadLead_AccessorialPolicies",
    AttributeDefinitions: [{ AttributeName: "loadId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "loadId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only ESIGN/UETA acceptances of a load's accessorial policy.
    TableName:
      process.env.DYNAMODB_ACCESSORIAL_POLICY_ACCEPTANCES_TABLE || "LoadLead_AccessorialPolicyAcceptances",
    AttributeDefinitions: [{ AttributeName: "acceptanceId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "acceptanceId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only shipper agreements to a load's accessorial terms at posting.
    TableName: process.env.DYNAMODB_SHIPPER_AGREEMENTS_TABLE || "LoadLead_ShipperAgreements",
    AttributeDefinitions: [{ AttributeName: "agreementId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "agreementId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  // ── Platform-admin compliance/oversight layer ─────────────────────────────
  {
    TableName: process.env.DYNAMODB_ADMIN_AUDIT_LOG_TABLE || "LoadLead_AdminAuditLog",
    AttributeDefinitions: [{ AttributeName: "auditId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "auditId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_COMPLIANCE_GRANTS_TABLE || "LoadLead_ComplianceGrants",
    AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_ADJUDICATIONS_TABLE || "LoadLead_Adjudications",
    AttributeDefinitions: [{ AttributeName: "adjudicationId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "adjudicationId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_LEGAL_HOLDS_TABLE || "LoadLead_LegalHolds",
    AttributeDefinitions: [{ AttributeName: "holdId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "holdId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_LAW_ENFORCEMENT_REQUESTS_TABLE || "LoadLead_LawEnforcementRequests",
    AttributeDefinitions: [{ AttributeName: "recordId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "recordId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_DISCLOSURES_TABLE || "LoadLead_Disclosures",
    AttributeDefinitions: [{ AttributeName: "disclosureId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "disclosureId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: process.env.DYNAMODB_PAYOUT_INTERCEPTS_TABLE || "LoadLead_PayoutIntercepts",
    AttributeDefinitions: [{ AttributeName: "interceptId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "interceptId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Load negotiation sessions (engage/bid/counter state machine).
    TableName: process.env.DYNAMODB_LOAD_NEGOTIATIONS_TABLE || "LoadLead_LoadNegotiations",
    AttributeDefinitions: [{ AttributeName: "negotiationId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "negotiationId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only negotiation offers (every bid/counter/accept/reject).
    TableName: process.env.DYNAMODB_NEGOTIATION_OFFERS_TABLE || "LoadLead_NegotiationOffers",
    AttributeDefinitions: [{ AttributeName: "negOfferId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "negOfferId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Per-load exclusivity lock: conditional put = one active negotiation per load.
    TableName: process.env.DYNAMODB_NEGOTIATION_LOCKS_TABLE || "LoadLead_NegotiationLocks",
    AttributeDefinitions: [{ AttributeName: "loadId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "loadId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only stop-events log (check-in/check-out evidence).
    TableName: process.env.DYNAMODB_STOP_EVENTS_TABLE || "LoadLead_StopEvents",
    AttributeDefinitions: [{ AttributeName: "eventId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Accessorial charge ledger (DETENTION/LAYOVER), deterministic chargeId.
    TableName: process.env.DYNAMODB_ACCESSORIAL_CHARGES_TABLE || "LoadLead_AccessorialCharges",
    AttributeDefinitions: [{ AttributeName: "chargeId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "chargeId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only charge status transitions.
    TableName:
      process.env.DYNAMODB_CHARGE_STATUS_HISTORY_TABLE || "LoadLead_AccessorialChargeStatusHistory",
    AttributeDefinitions: [{ AttributeName: "historyId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "historyId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only factoring assignment log (release/change = new row).
    TableName: process.env.DYNAMODB_FACTORING_ASSIGNMENTS_TABLE || "LoadLead_FactoringAssignments",
    AttributeDefinitions: [{ AttributeName: "assignmentId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "assignmentId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only Notices of Assignment (legal redirection snapshots).
    TableName: process.env.DYNAMODB_NOTICES_OF_ASSIGNMENT_TABLE || "LoadLead_NoticesOfAssignment",
    AttributeDefinitions: [{ AttributeName: "noaId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "noaId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only funding advances (no advance vs non-APPROVED accessorial).
    TableName: process.env.DYNAMODB_FUNDING_ADVANCES_TABLE || "LoadLead_FundingAdvances",
    AttributeDefinitions: [{ AttributeName: "advanceId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "advanceId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only reconciliation + recourse outcomes.
    TableName: process.env.DYNAMODB_RECONCILIATION_OUTCOMES_TABLE || "LoadLead_ReconciliationOutcomes",
    AttributeDefinitions: [{ AttributeName: "outcomeId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "outcomeId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Saved factor contact per carrier/owner-operator (pre-fills the recipient).
    TableName: process.env.DYNAMODB_FACTOR_CONTACTS_TABLE || "LoadLead_FactorContacts",
    AttributeDefinitions: [{ AttributeName: "carrierId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "carrierId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // Append-only factoring submission records (export-and-send disclosure trail).
    TableName: process.env.DYNAMODB_FACTORING_SUBMISSIONS_TABLE || "LoadLead_FactoringSubmissions",
    AttributeDefinitions: [{ AttributeName: "submissionId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "submissionId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST",
  },
];

async function tableExists(TableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName }));
    return true;
  } catch (e) {
    if (e?.name === "ResourceNotFoundException") return false;
    throw e;
  }
}

async function waitActive(TableName) {
  for (let i = 0; i < 30; i++) {
    const r = await client.send(new DescribeTableCommand({ TableName }));
    if (r.Table?.TableStatus === "ACTIVE") return;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`Timeout waiting for ${TableName} to become ACTIVE`);
}

for (const def of TABLES) {
  const name = def.TableName;
  if (await tableExists(name)) {
    console.log(`✅ Exists: ${name}`);
    continue;
  }
  console.log(`🛠 Creating: ${name}`);
  await client.send(new CreateTableCommand(def));
  await waitActive(name);
  console.log(`✅ Created: ${name}`);
}

console.log("🎉 DynamoDB Local tables ready.");
