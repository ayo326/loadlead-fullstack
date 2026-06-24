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
