############################################################################
# imported-tables.tf — prod DDB tables brought UNDER Terraform management
# via `terraform import`. Each block here MUST mirror the live AWS config
# of that table exactly; `terraform plan` after a fresh import must be
# no-op or the next apply will silently mutate prod.
#
# How a table gets in this file:
#   1. aws dynamodb describe-table --table-name LoadLead_<X>  (survey)
#   2. Write the block below, matching every key/attr/GSI/billing/PITR/
#      deletion_protection field 1:1 with the survey
#   3. tofu import aws_dynamodb_table.ddb_<x> LoadLead_<X>
#   4. tofu plan — must say "No changes." If it doesn't, the block is wrong,
#      not the live state. Edit the block, plan again, never apply with diffs.
#
# Signatures + PodPhotos are NOT in this file — they're declared via the
# shared dynamodb_table module in main.tf and imported as
#   module.ddb_signatures.aws_dynamodb_table.this   LoadLead_Signatures
#   module.ddb_pod_photos.aws_dynamodb_table.this   LoadLead_PodPhotos
############################################################################

# ─── LoadLead_Users ────────────────────────────────────────────────────────
# First table brought under management. Single GSI on email for login lookup.
# PITR ON (enabled during attestation-bootstrap-ops.sh). No deletion protection
# yet — pending the prod-table-protection sweep (logged as a separate backlog
# item; tracked alongside the rest of the 11 still-unmanaged tables).
resource "aws_dynamodb_table" "ddb_users" {
  name         = "LoadLead_Users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "email"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false

  tags = local.tags
}

output "users_table_arn" { value = aws_dynamodb_table.ddb_users.arn }


# ─── 9 critical-path tables, brought under TF Phase 2 item 1 (cont.) ───

resource "aws_dynamodb_table" "ddb_loads" {
  name         = "LoadLead_Loads"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "loadId"

  attribute {
    name = "loadId"
    type = "S"
  }
  attribute {
    name = "shipperId"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  # assignedDriverId-index (audit v6 M6): getLoadsByAssignedDriver fans out once per
  # fleet driver on dashboards; this makes each a query instead of a full-table scan.
  attribute {
    name = "assignedDriverId"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "shipperId-index"
    hash_key        = "shipperId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "assignedDriverId-index"
    hash_key        = "assignedDriverId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "loads_table_arn" { value = aws_dynamodb_table.ddb_loads.arn }

resource "aws_dynamodb_table" "ddb_offers" {
  name         = "LoadLead_Offers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "offerId"

  attribute {
    name = "driverId"
    type = "S"
  }
  attribute {
    name = "loadId"
    type = "S"
  }
  attribute {
    name = "offerId"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "loadId-index"
    hash_key        = "loadId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "driverId-status-index"
    hash_key        = "driverId"
    range_key       = "status"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "driverId-index"
    hash_key        = "driverId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "loadId-driverId-index"
    hash_key        = "loadId"
    range_key       = "driverId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "offers_table_arn" { value = aws_dynamodb_table.ddb_offers.arn }

resource "aws_dynamodb_table" "ddb_drivers" {
  name         = "LoadLead_Drivers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "driverId"

  attribute {
    name = "driverId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "drivers_table_arn" { value = aws_dynamodb_table.ddb_drivers.arn }

resource "aws_dynamodb_table" "ddb_receivers" {
  name         = "LoadLead_Receivers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "receiverId"

  attribute {
    name = "receiverId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "receivers_table_arn" { value = aws_dynamodb_table.ddb_receivers.arn }

resource "aws_dynamodb_table" "ddb_shippers" {
  name         = "LoadLead_Shippers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "shipperId"

  attribute {
    name = "shipperId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "shippers_table_arn" { value = aws_dynamodb_table.ddb_shippers.arn }

resource "aws_dynamodb_table" "ddb_organizations" {
  name         = "LoadLead_Organizations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orgId"

  attribute {
    name = "orgId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "organizations_table_arn" { value = aws_dynamodb_table.ddb_organizations.arn }

resource "aws_dynamodb_table" "ddb_memberships" {
  name         = "LoadLead_Memberships"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "membershipId"

  attribute {
    name = "membershipId"
    type = "S"
  }
  attribute {
    name = "orgId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "orgId-index"
    hash_key        = "orgId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "memberships_table_arn" { value = aws_dynamodb_table.ddb_memberships.arn }

resource "aws_dynamodb_table" "ddb_bol" {
  name         = "LoadLead_BOL"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "bolId"

  attribute {
    name = "bolId"
    type = "S"
  }
  attribute {
    name = "loadId"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "loadId-index"
    hash_key        = "loadId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "bol_table_arn" { value = aws_dynamodb_table.ddb_bol.arn }

resource "aws_dynamodb_table" "ddb_verifications" {
  name         = "LoadLead_Verifications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "entityId"

  attribute {
    name = "entityId"
    type = "S"
  }
  attribute {
    name = "verificationStatus"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "verificationStatus"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags                        = local.tags
}
output "verifications_table_arn" { value = aws_dynamodb_table.ddb_verifications.arn }

# NOTE: LoadLead_PodPhotos is intentionally NOT declared here — it's
# managed via module.ddb_pod_photos in main.tf and was imported under
# that address. Adding a second aws_dynamodb_table.ddb_podphotos would
# either fail with "already exists" or attempt to create a duplicate.


# ─── 16 secondary tables (support/admin/audit/factoring/notifications) ───
# PITR was DISABLED on all of these in prod; the module config below ENABLES
# it as a strict upgrade. No key/attr/GSI/billing changes.

resource "aws_dynamodb_table" "ddb_membership_audit_logs" {
  name         = "LoadLead-MembershipAuditLogs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "logId"

  attribute {
    name = "logId"
    type = "S"
  }
  attribute {
    name = "orgId"
    type = "S"
  }

  global_secondary_index {
    name            = "orgId-index"
    hash_key        = "orgId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

# Audit v7 INF-3: aws_dynamodb_table.ddb_admin_audit (name "LoadLead_AdminAudit")
# was removed here. It has NO backend reader - the app's admin audit log is the
# separate LoadLead_AdminAuditLog table (config slot adminAuditLogTable, managed
# by module.ddb_admin_audit_log). The physical LoadLead_AdminAudit table does NOT
# exist in AWS (describe-table -> ResourceNotFoundException); `tofu plan
# -refresh-only` reports the resource "has been deleted". So it was stale state
# for a non-existent table, and a normal `tofu apply` would have RE-CREATED an
# unused table.
#
# REQUIRED before applying (see the PR runbook): drop the stale state entry so
# this is a true no-op rather than a create:
#   tofu state rm aws_dynamodb_table.ddb_admin_audit
# After that, `tofu plan` shows no change for this address.

resource "aws_dynamodb_table" "ddb_admin_bootstrap_attempts" {
  name         = "LoadLead_AdminBootstrapAttempts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "attemptId"

  attribute {
    name = "attemptId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_carrier_factoring_profiles" {
  name         = "LoadLead_CarrierFactoringProfiles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "carrierId"

  attribute {
    name = "carrierId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_factoring_opt_ins" {
  name         = "LoadLead_FactoringOptIns"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "optInId"

  attribute {
    name = "loadId"
    type = "S"
  }
  attribute {
    name = "optInId"
    type = "S"
  }

  global_secondary_index {
    name            = "loadId-index"
    hash_key        = "loadId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_fleet_invites" {
  name         = "LoadLead_FleetInvites"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "inviteId"

  attribute {
    name = "inviteId"
    type = "S"
  }
  attribute {
    name = "operatorId"
    type = "S"
  }
  attribute {
    name = "token"
    type = "S"
  }

  global_secondary_index {
    name            = "token-index"
    hash_key        = "token"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "operatorId-index"
    hash_key        = "operatorId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_invitations" {
  name         = "LoadLead_Invitations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token"

  attribute {
    name = "orgId"
    type = "S"
  }
  attribute {
    name = "token"
    type = "S"
  }

  global_secondary_index {
    name            = "orgId-index"
    hash_key        = "orgId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_notifications" {
  name         = "LoadLead_Notifications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "notificationId"

  attribute {
    name = "notificationId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_owner_operators" {
  name         = "LoadLead_OwnerOperators"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "operatorId"

  attribute {
    name = "operatorId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_password_resets" {
  name         = "LoadLead_PasswordResets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token"

  attribute {
    name = "token"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_push_subscriptions" {
  name         = "LoadLead_PushSubscriptions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_setup_tokens" {
  name         = "LoadLead_SetupTokens"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token"

  attribute {
    name = "token"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_support_inbound" {
  name         = "LoadLead_SupportInbound"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "emailId"

  attribute {
    name = "emailId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_support_messages" {
  name         = "LoadLead_SupportMessages"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_support_settings" {
  name         = "LoadLead_SupportSettings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "settingsId"

  attribute {
    name = "settingsId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_support_tickets" {
  name         = "LoadLead_SupportTickets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ticketId"

  attribute {
    name = "ticketId"
    type = "S"
  }


  point_in_time_recovery { enabled = true }
  deletion_protection_enabled = false
  tags                        = local.tags
}


# Resource-name <-> live-table mapping for the import commands:
#
#   aws_dynamodb_table.ddb_membership_audit_logs  ->  LoadLead-MembershipAuditLogs
#   aws_dynamodb_table.ddb_admin_audit  ->  LoadLead_AdminAudit
#   aws_dynamodb_table.ddb_admin_bootstrap_attempts  ->  LoadLead_AdminBootstrapAttempts
#   aws_dynamodb_table.ddb_carrier_factoring_profiles  ->  LoadLead_CarrierFactoringProfiles
#   aws_dynamodb_table.ddb_factoring_opt_ins  ->  LoadLead_FactoringOptIns
#   aws_dynamodb_table.ddb_fleet_invites  ->  LoadLead_FleetInvites
#   aws_dynamodb_table.ddb_invitations  ->  LoadLead_Invitations
#   aws_dynamodb_table.ddb_notifications  ->  LoadLead_Notifications
#   aws_dynamodb_table.ddb_owner_operators  ->  LoadLead_OwnerOperators
#   aws_dynamodb_table.ddb_password_resets  ->  LoadLead_PasswordResets
#   aws_dynamodb_table.ddb_push_subscriptions  ->  LoadLead_PushSubscriptions
#   aws_dynamodb_table.ddb_setup_tokens  ->  LoadLead_SetupTokens
#   aws_dynamodb_table.ddb_support_inbound  ->  LoadLead_SupportInbound
#   aws_dynamodb_table.ddb_support_messages  ->  LoadLead_SupportMessages
#   aws_dynamodb_table.ddb_support_settings  ->  LoadLead_SupportSettings
#   aws_dynamodb_table.ddb_support_tickets  ->  LoadLead_SupportTickets

# ─── Beta program tables (imported 2026-07-01; mirror live config) ──────────
# Hardened 2026-07-01: PITR + deletion protection enabled via TF apply
# (BetaApplications holds applicant PII).

resource "aws_dynamodb_table" "ddb_beta_allowlist" {
  name         = "LoadLead_BetaAllowlist"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "allowlistId"

  attribute {
    name = "allowlistId"
    type = "S"
  }
  attribute {
    name = "value"
    type = "S"
  }

  global_secondary_index {
    name            = "value-index"
    hash_key        = "value"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_beta_applications" {
  name         = "LoadLead_BetaApplications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "applicationId"

  attribute {
    name = "applicationId"
    type = "S"
  }
  attribute {
    name = "responseId"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "workEmail"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "workEmail-index"
    hash_key        = "workEmail"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "responseId-index"
    hash_key        = "responseId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
  tags                        = local.tags
}

resource "aws_dynamodb_table" "ddb_waitlist" {
  name         = "LoadLead_Waitlist"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "waitlistId"

  attribute {
    name = "waitlistId"
    type = "S"
  }
  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
  tags                        = local.tags
}

# ─── Append-only protection for beta application intake ─────────────────────
# A LoadLead_BetaApplications row is the applicant's full Tally submission (PII)
# and the record admins review to admit or waitlist. The app only ever creates
# and UPDATES these rows (status transitions, scoring, notes) - it never
# deletes one. An earlier row was lost to a manual console delete before PITR
# existed on this table; this policy makes that unrepeatable by DENYING
# DeleteItem on the table to the EB backend's instance role. Deny always wins,
# so even a future buggy or malicious code path cannot remove a submission.
# UpdateItem is intentionally NOT denied - the review workflow depends on it.
data "aws_iam_role" "eb_backend" {
  name = "aws-elasticbeanstalk-ec2-role"
}

resource "aws_iam_role_policy" "deny_beta_application_deletes" {
  name = "loadlead-deny-beta-application-row-deletes"
  role = data.aws_iam_role.eb_backend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "DenyBetaApplicationRowDeletes"
      Effect   = "Deny"
      Action   = ["dynamodb:DeleteItem"]
      Resource = aws_dynamodb_table.ddb_beta_applications.arn
    }]
  })
}
