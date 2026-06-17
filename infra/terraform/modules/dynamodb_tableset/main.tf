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
      hash_key   = "loadId"
      attributes = [
        { name = "loadId", type = "S" }, { name = "status", type = "S" },
        { name = "createdAt", type = "N" }, { name = "shipperId", type = "S" },
      ]
      gsis = [
        { name = "status-createdAt-index", hash_key = "status", range_key = "createdAt" },
        { name = "shipperId-index", hash_key = "shipperId" },
      ]
    }
    Offers = {
      hash_key   = "offerId"
      attributes = [{ name = "offerId", type = "S" }, { name = "loadId", type = "S" }, { name = "driverId", type = "S" }]
      gsis = [
        { name = "loadId-driverId-index", hash_key = "loadId", range_key = "driverId" },
        { name = "driverId-index", hash_key = "driverId" },
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
  }
}

module "table" {
  source = "../dynamodb_table"
  for_each = local.tables

  name                     = "${var.prefix}${each.key}"
  hash_key                 = each.value.hash_key
  attributes               = each.value.attributes
  global_secondary_indexes = each.value.gsis
  ttl_attribute            = lookup(each.value, "ttl", null)
  deletion_protection      = var.deletion_protection
  tags                     = merge(var.tags, { Environment = var.env, Table = each.key })
}
