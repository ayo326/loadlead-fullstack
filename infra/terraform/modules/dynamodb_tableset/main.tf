############################################################################
# The full LoadLead table set, reconstructed for dev/staging from the
# backend's code (table names, hash/range keys, and GSIs as referenced by
# Database.query() calls and bug-fix notes in testing-dashboard.html).
#
# ⚠ Before the FIRST apply, reconcile each table against prod with:
#     aws dynamodb describe-table --table-name LoadLead_Drivers
#   for every table below, and fix any GSI name/key mismatch here. This list
#   is a best-effort mirror, not an export of prod's actual schema — drift
#   here means dev/staging "pass" tests that prod would fail (or vice versa).
############################################################################

locals {
  tables = {
    Users = {
      hash_key   = "userId"
      attributes = [{ name = "userId", type = "S" }, { name = "email", type = "S" }]
      gsis       = [{ name = "email-index", hash_key = "email" }]
    }
    Drivers = {
      hash_key   = "driverId"
      attributes = [{ name = "driverId", type = "S" }, { name = "userId", type = "S" }]
      # Prod currently Scans for this lookup (no GSI) — giving dev/staging the
      # index from day one is a deliberate improvement, not parity-breaking.
      gsis = [{ name = "userId-index", hash_key = "userId" }]
    }
    Organizations = {
      hash_key   = "orgId"
      attributes = [{ name = "orgId", type = "S" }]
      gsis       = []
    }
    Memberships = {
      hash_key   = "membershipId"
      attributes = [{ name = "membershipId", type = "S" }, { name = "orgId", type = "S" }, { name = "userId", type = "S" }]
      gsis = [
        { name = "orgId-index", hash_key = "orgId" },
        { name = "userId-index", hash_key = "userId" },
      ]
    }
    Invitations = {
      hash_key   = "token"
      attributes = [{ name = "token", type = "S" }, { name = "orgId", type = "S" }]
      gsis       = [{ name = "orgId-index", hash_key = "orgId" }]
    }
    OwnerOperators = {
      hash_key   = "operatorId"
      attributes = [{ name = "operatorId", type = "S" }, { name = "userId", type = "S" }]
      gsis       = [{ name = "userId-index", hash_key = "userId" }]
    }
    FleetInvites = {
      hash_key   = "inviteId"
      attributes = [{ name = "inviteId", type = "S" }, { name = "operatorId", type = "S" }, { name = "token", type = "S" }]
      gsis = [
        { name = "operatorId-index", hash_key = "operatorId" },
        { name = "token-index", hash_key = "token" },
      ]
    }
    Verifications = {
      hash_key   = "entityId"
      attributes = [{ name = "entityId", type = "S" }, { name = "verificationStatus", type = "S" }]
      gsis       = [{ name = "status-index", hash_key = "verificationStatus" }]
    }
    Loads = {
      hash_key = "loadId"
      attributes = [
        { name = "loadId", type = "S" }, { name = "status", type = "S" },
        { name = "createdAt", type = "N" }, { name = "shipperId", type = "S" },
      ]
      gsis = [
        { name = "status-createdAt-index", hash_key = "status", range_key = "createdAt" },
        { name = "shipperId-index", hash_key = "shipperId" },
        # loadService.getLoadsByStatus queries "status-index" (HASH status, no
        # range). Prod's LoadLead_Loads carries exactly this index; without it
        # the OO loadboard 500s (ValidationException: index does not exist).
        # Added out-of-band to staging earlier — reconciled here for parity.
        { name = "status-index", hash_key = "status" },
      ]
    }
    Offers = {
      hash_key = "offerId"
      attributes = [
        { name = "offerId", type = "S" }, { name = "loadId", type = "S" },
        { name = "driverId", type = "S" }, { name = "status", type = "S" },
      ]
      gsis = [
        { name = "loadId-driverId-index", hash_key = "loadId", range_key = "driverId" },
        { name = "driverId-index", hash_key = "driverId" },
        # offerService.getOffersByDriver queries "driverId-status-index"
        # (HASH driverId + RANGE status). Prod's LoadLead_Offers carries this
        # index; added out-of-band to staging earlier — reconciled here.
        { name = "driverId-status-index", hash_key = "driverId", range_key = "status" },
      ]
    }
    FactoringOptIns = {
      hash_key   = "optInId"
      attributes = [{ name = "optInId", type = "S" }, { name = "loadId", type = "S" }]
      gsis       = [{ name = "loadId-index", hash_key = "loadId" }]
    }
    Shippers = {
      hash_key   = "shipperId"
      attributes = [{ name = "shipperId", type = "S" }, { name = "userId", type = "S" }]
      gsis       = [{ name = "userId-index", hash_key = "userId" }]
    }
    Receivers = {
      hash_key   = "receiverId"
      attributes = [{ name = "receiverId", type = "S" }, { name = "userId", type = "S" }]
      gsis       = [{ name = "userId-index", hash_key = "userId" }]
    }
    BOL = {
      hash_key   = "bolId"
      attributes = [{ name = "bolId", type = "S" }, { name = "loadId", type = "S" }]
      gsis       = [{ name = "loadId-index", hash_key = "loadId" }]
    }
    PushSubscriptions = {
      hash_key   = "userId"
      attributes = [{ name = "userId", type = "S" }]
      gsis       = []
    }
    PasswordResets = {
      hash_key   = "token"
      attributes = [{ name = "token", type = "S" }]
      gsis       = []
      ttl        = "expiresAt"
    }
    SetupTokens = {
      hash_key   = "token"
      attributes = [{ name = "token", type = "S" }]
      gsis       = []
      ttl        = "expiresAt"
    }
    MembershipAuditLogs = {
      hash_key   = "logId"
      attributes = [{ name = "logId", type = "S" }, { name = "orgId", type = "S" }]
      gsis       = [{ name = "orgId-index", hash_key = "orgId" }]
    }

    # Attestation chain — append-only, IAM-Deny update/delete (see
    # ../iam_signatures/), PutItem with attribute_not_exists guard at the
    # app layer. PITR comes from the module default. Holds Signature rows
    # bound to documentHash + proofPhotoIds for non-repudiation.
    Signatures = {
      hash_key = "signatureId"
      attributes = [
        { name = "signatureId", type = "S" },
        { name = "loadId", type = "S" },
        { name = "signedAt", type = "S" },
      ]
      gsis = [
        { name = "loadId-signedAt-index", hash_key = "loadId", range_key = "signedAt" },
      ]
    }

    # POD photo metadata + finalize state. Bytes live in S3 (loadlead-pod-uploads,
    # delete-resistant by bucket policy; Phase-2 migrating to Object Lock v2).
    # This table records s3Key + status (PENDING/READY) + contentHash. Allows
    # UpdateItem because PENDING→READY is the one allowed transition; the
    # condition guard pins the state machine to exactly one direction.
    PodPhotos = {
      hash_key = "photoId"
      attributes = [
        { name = "photoId", type = "S" },
        { name = "loadId", type = "S" },
      ]
      gsis = [
        { name = "loadId-index", hash_key = "loadId" },
      ]
    }

    # ── Beta program ─────────────────────────────────────────────────────
    # Runtime-editable allowlist for private-beta self-signup. EMAIL rows
    # match one address; DOMAIN rows let everyone-at-acme.com self-sign-up.
    # value-index lets the beta gate do a fast PK-style lookup on either form
    # without a full scan; the gate normalises (lowercase, strip leading '@')
    # before querying.
    BetaAllowlist = {
      hash_key = "allowlistId"
      attributes = [
        { name = "allowlistId", type = "S" },
        { name = "value", type = "S" },
      ]
      gsis = [
        { name = "value-index", hash_key = "value" },
      ]
    }

    # Capture from the private-beta landing page (unauthenticated visitor
    # asks to be let in). The dashboard promotes these into real invites.
    # email-index makes "is this email already on the waitlist?" cheap.
    Waitlist = {
      hash_key = "waitlistId"
      attributes = [
        { name = "waitlistId", type = "S" },
        { name = "email", type = "S" },
      ]
      gsis = [
        { name = "email-index", hash_key = "email" },
      ]
    }

    # Tally form submissions → BetaApplication. The responseId GSI is the
    # idempotency lock for the webhook (dedupe by Tally's response id).
    # status-index drives the pipeline kanban; workEmail-index is for the
    # "did this person already apply?" check before insert.
    BetaApplications = {
      hash_key = "applicationId"
      attributes = [
        { name = "applicationId", type = "S" },
        { name = "responseId", type = "S" },
        { name = "status", type = "S" },
        { name = "workEmail", type = "S" },
      ]
      gsis = [
        { name = "responseId-index", hash_key = "responseId" },
        { name = "status-index", hash_key = "status" },
        { name = "workEmail-index", hash_key = "workEmail" },
      ]
    }

    # Beta-admin trust/operational events (no-show, trust incident). Deliberately
    # SEPARATE from the Loads table: rows reference a load and carrier by id only
    # and never live on the Load model. Mirrors the prod ddb_beta_trust_events
    # block in envs/prod/main.tf. PITR comes from the module default.
    BetaTrustEvents = {
      hash_key   = "eventId"
      attributes = [{ name = "eventId", type = "S" }]
      gsis       = []
    }

    # ── Carrier payments + financing ─────────────────────────────────────
    # Append-only platform fee policy changes (linehaul take rate + beta
    # waiver). The current policy is the newest row; rows are never updated
    # or deleted. Each change carries an actor and a timestamp. PITR comes
    # from the module default.
    PlatformFeePolicy = {
      hash_key   = "changeId"
      attributes = [{ name = "changeId", type = "S" }]
      gsis       = []
    }

    # Per-load accessorial policy (detention/layover terms), keyed by loadId.
    # Editable until a charge freezes a snapshot of it; references the load by
    # id only and never lives on the Load model.
    AccessorialPolicies = {
      hash_key   = "loadId"
      attributes = [{ name = "loadId", type = "S" }]
      gsis       = []
    }

    # Append-only ESIGN/UETA acceptances of a load's accessorial policy. Pins the
    # accepted version + policy hash; rows are never updated or deleted.
    AccessorialPolicyAcceptances = {
      hash_key   = "acceptanceId"
      attributes = [{ name = "acceptanceId", type = "S" }]
      gsis       = []
    }

    # Append-only shipper agreements to a load's accessorial terms at posting.
    # Pins the agreed policy version + exact values; never updated or deleted.
    ShipperAgreements = {
      hash_key   = "agreementId"
      attributes = [{ name = "agreementId", type = "S" }]
      gsis       = []
    }

    # ── Platform-admin compliance/oversight layer ──────────────────────────
    # Append-only admin audit log, per-user compliance grants, adjudications,
    # legal holds, law-enforcement requests, disclosures, and payout intercepts.
    AdminAuditLog = {
      hash_key   = "auditId"
      attributes = [{ name = "auditId", type = "S" }]
      gsis       = []
    }
    ComplianceGrants = {
      hash_key   = "userId"
      attributes = [{ name = "userId", type = "S" }]
      gsis       = []
    }
    Adjudications = {
      hash_key   = "adjudicationId"
      attributes = [{ name = "adjudicationId", type = "S" }]
      gsis       = []
    }
    LegalHolds = {
      hash_key   = "holdId"
      attributes = [{ name = "holdId", type = "S" }]
      gsis       = []
    }
    LawEnforcementRequests = {
      hash_key   = "recordId"
      attributes = [{ name = "recordId", type = "S" }]
      gsis       = []
    }
    Disclosures = {
      hash_key   = "disclosureId"
      attributes = [{ name = "disclosureId", type = "S" }]
      gsis       = []
    }
    PayoutIntercepts = {
      hash_key   = "interceptId"
      attributes = [{ name = "interceptId", type = "S" }]
      gsis       = []
    }

    # Append-only stop-events log (check-in/check-out). Detention/layover compute
    # from these immutable events; references load + stop by id only. A loadId GSI
    # can be added before scale; reads scan + filter at beta volume.
    StopEvents = {
      hash_key   = "eventId"
      attributes = [{ name = "eventId", type = "S" }]
      gsis       = []
    }

    # Accessorial charge ledger (DETENTION/LAYOVER). Deterministic chargeId so a
    # recompute updates in place; the live row carries status + amount and the
    # immutable trail lives in AccessorialChargeStatusHistory.
    AccessorialCharges = {
      hash_key = "chargeId"
      # loadId-index (audit v4 COA-3A): every load-detail view listed charges
      # via a full-table scan; this turns it into a per-load query.
      attributes = [{ name = "chargeId", type = "S" }, { name = "loadId", type = "S" }]
      gsis       = [{ name = "loadId-index", hash_key = "loadId" }]
    }

    # Append-only charge status transitions (original/new amounts on adjust).
    AccessorialChargeStatusHistory = {
      hash_key   = "historyId"
      attributes = [{ name = "historyId", type = "S" }]
      gsis       = []
    }

    # Append-only factoring assignment log. A release/change is a new row; the
    # active assignment resolves with invoice-level precedence over account-level.
    FactoringAssignments = {
      hash_key   = "assignmentId"
      attributes = [{ name = "assignmentId", type = "S" }]
      gsis       = []
    }

    # Append-only Notices of Assignment (legal redirection snapshots).
    NoticesOfAssignment = {
      hash_key   = "noaId"
      attributes = [{ name = "noaId", type = "S" }]
      gsis       = []
    }

    # Append-only funding advances (no advance vs non-APPROVED accessorial;
    # idempotent per invoice line).
    FundingAdvances = {
      hash_key = "advanceId"
      attributes = [
        { name = "advanceId", type = "S" },
        { name = "invoiceId", type = "S" },
      ]
      # V2-M1: listForInvoice queries this instead of scanning the ledger.
      gsis = [{ name = "invoiceId-index", hash_key = "invoiceId" }]
    }

    # Append-only reconciliation + recourse outcomes (payment routing, reserve
    # release, supplemental advance, recourse buyback, non-recourse loss).
    ReconciliationOutcomes = {
      hash_key = "outcomeId"
      attributes = [
        { name = "outcomeId", type = "S" },
        { name = "invoiceId", type = "S" },
      ]
      # V2-M1: outcomesForInvoice queries this instead of scanning the ledger.
      gsis = [{ name = "invoiceId-index", hash_key = "invoiceId" }]
    }

    # Saved factor contact per carrier/owner-operator (pre-fills the recipient).
    FactorContacts = {
      hash_key   = "carrierId"
      attributes = [{ name = "carrierId", type = "S" }]
      gsis       = []
    }

    # Append-only factoring submission records (export-and-send disclosure trail:
    # what financial documents left the platform, to whom, and when).
    FactoringSubmissions = {
      hash_key   = "submissionId"
      attributes = [{ name = "submissionId", type = "S" }]
      gsis       = []
    }

    # ── Load negotiation (engage/bid/counter/accept) ─────────────────────
    # Session rows, append-only offer rows, and the per-load exclusivity lock.
    # The Load model is never touched; everything references load + parties by
    # id. M3: the loadId / negotiationId GSIs let latestForLoad + offersFor query
    # instead of scanning the whole table (the long-poll hot path). The service
    # prefers these indexes and falls back to a scan until they're live, so this
    # is safe to apply to prod (add the same GSIs there) independently of deploy.
    LoadNegotiations = {
      hash_key = "negotiationId"
      attributes = [
        { name = "negotiationId", type = "S" },
        { name = "loadId", type = "S" },
        { name = "createdAt", type = "N" },
      ]
      gsis = [{ name = "loadId-createdAt-index", hash_key = "loadId", range_key = "createdAt" }]
    }
    NegotiationOffers = {
      hash_key = "negOfferId"
      attributes = [
        { name = "negOfferId", type = "S" },
        { name = "negotiationId", type = "S" },
        { name = "createdAt", type = "N" },
      ]
      gsis = [{ name = "negotiationId-createdAt-index", hash_key = "negotiationId", range_key = "createdAt" }]
    }
    NegotiationLocks = {
      hash_key   = "loadId"
      attributes = [{ name = "loadId", type = "S" }]
      gsis       = []
    }

    # In-app notification inbox (per-user feed). userId-index powers the
    # "my notifications" list without a scan.
    Notifications = {
      hash_key = "notificationId"
      attributes = [
        { name = "notificationId", type = "S" },
        { name = "userId", type = "S" },
      ]
      gsis = [{ name = "userId-index", hash_key = "userId" }]
    }

    # Saved carrier factoring profile (opt-in status + factor details), keyed by
    # carrierId (owner-operator or org — the carrier of record).
    CarrierFactoringProfiles = {
      hash_key   = "carrierId"
      attributes = [{ name = "carrierId", type = "S" }]
      gsis       = []
    }

    # Append-only admin-bootstrap attempt log (the race-safe record behind the
    # one-time ADMIN bootstrap; referenced by the bootstrap flow's guard).
    AdminBootstrapAttempts = {
      hash_key   = "attemptId"
      attributes = [{ name = "attemptId", type = "S" }]
      gsis       = []
    }

    # ── Support / helpdesk (inbound email -> ticket lifecycle) ────────────────
    # Schemas mirror the live prod LoadLead_Support* tables exactly (simple hash
    # keys, no GSIs). Previously created out-of-band and absent from IaC — added
    # so every env provisions them and reads its OWN, not prod's.
    SupportTickets = {
      hash_key   = "ticketId"
      attributes = [{ name = "ticketId", type = "S" }]
      gsis       = []
    }
    SupportMessages = {
      hash_key   = "messageId"
      attributes = [{ name = "messageId", type = "S" }]
      gsis       = []
    }
    SupportSettings = {
      hash_key   = "settingsId"
      attributes = [{ name = "settingsId", type = "S" }]
      gsis       = []
    }
    SupportInbound = {
      hash_key   = "emailId"
      attributes = [{ name = "emailId", type = "S" }]
      gsis       = []
    }

    # ── Carrier compliance documents (W9 / COI / Letter of Authority) ──────────
    # SCRUM-59. Append-only, versioned compliance records on the hauler/driver:
    # a re-upload writes a NEW row that supersedes the prior version; rows are
    # never deleted. Services read via full-table Scan today (no GSI needed yet
    # — do not add one until a follow-up asks). Hash keys mirror the ids the
    # backend generates (see backend/src/services/compliance/*). The W9 TIN is
    # never stored here in plaintext — it's KMS-envelope-encrypted (see the
    # per-env w9-tin KMS key) before the ciphertext lands on the document row.
    ComplianceDocuments = {
      hash_key = "documentId"
      # ownerId-index (audit v4 COA-3A): badge/current/version reads scanned the
      # whole table; this scopes them to one hauler's documents.
      attributes = [{ name = "documentId", type = "S" }, { name = "ownerId", type = "S" }]
      gsis       = [{ name = "ownerId-index", hash_key = "ownerId" }]
    }
    ComplianceVerificationEvents = {
      hash_key   = "eventId"
      attributes = [{ name = "eventId", type = "S" }]
      gsis       = []
    }
    W9AccessLog = {
      hash_key   = "accessId"
      attributes = [{ name = "accessId", type = "S" }]
      gsis       = []
    }
    ShipperCompliancePolicies = {
      hash_key   = "policyVersionId"
      attributes = [{ name = "policyVersionId", type = "S" }]
      gsis       = []
    }
    ShipperPolicyAttachments = {
      hash_key   = "attachmentId"
      attributes = [{ name = "attachmentId", type = "S" }]
      gsis       = []
    }
  }
}

module "table" {
  source   = "../dynamodb_table"
  for_each = local.tables

  name                     = "${var.prefix}${each.key}"
  hash_key                 = each.value.hash_key
  attributes               = each.value.attributes
  global_secondary_indexes = each.value.gsis
  ttl_attribute            = lookup(each.value, "ttl", null)
  deletion_protection      = var.deletion_protection
  tags                     = merge(var.tags, { Environment = var.env, Table = each.key })
}
