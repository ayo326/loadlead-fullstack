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

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = false
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
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
  tags = local.tags
}
output "verifications_table_arn" { value = aws_dynamodb_table.ddb_verifications.arn }

# NOTE: LoadLead_PodPhotos is intentionally NOT declared here — it's
# managed via module.ddb_pod_photos in main.tf and was imported under
# that address. Adding a second aws_dynamodb_table.ddb_podphotos would
# either fail with "already exists" or attempt to create a duplicate.
