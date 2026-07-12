############################################################################
# canopy.tf - Canopy Connect insurance data infra (SCRUM-60).
#
# Two NEW append-friendly DynamoDB tables (no `terraform import` needed):
#   1. CarrierInsuranceConnections - one row per carrier connection to Canopy
#      (pull id, monitoring id, status, source mode). carrierId + pullId GSIs.
#   2. CoiCrossReferenceResults - append-only per-field COI-vs-insurer
#      comparison results. carrierId GSI.
# Both carry deletion_protection + PITR (module defaults). Table names equal the
# code defaults (LoadLead_*), so no DYNAMODB_*_TABLE override is strictly needed
# in prod.
#
# Prod's EB environment is identity-only in TF (see eb-imported.tf,
# ignore_changes = [setting]), so the Canopy APP env vars are NOT set here. They
# are wired OUT-OF-BAND - see the note at the bottom of this file. No secret ever
# lives in Terraform state.
############################################################################

module "ddb_carrier_insurance_connections" {
  source   = "../../modules/dynamodb_table"
  name     = "LoadLead_CarrierInsuranceConnections"
  hash_key = "connectionId"
  attributes = [
    { name = "connectionId", type = "S" },
    { name = "carrierId", type = "S" },
    { name = "pullId", type = "S" },
  ]
  global_secondary_indexes = [
    { name = "carrierId-index", hash_key = "carrierId", projection_type = "ALL" },
    { name = "pullId-index", hash_key = "pullId", projection_type = "ALL" },
  ]
  deletion_protection = true
  tags                = local.tags
}

module "ddb_coi_crossreference_results" {
  source   = "../../modules/dynamodb_table"
  name     = "LoadLead_CoiCrossReferenceResults"
  hash_key = "resultId"
  attributes = [
    { name = "resultId", type = "S" },
    { name = "carrierId", type = "S" },
  ]
  global_secondary_indexes = [
    { name = "carrierId-index", hash_key = "carrierId", projection_type = "ALL" },
  ]
  deletion_protection = true
  tags                = local.tags
}

output "carrier_insurance_connections_table_arn" { value = module.ddb_carrier_insurance_connections.arn }
output "coi_crossreference_results_table_arn" { value = module.ddb_coi_crossreference_results.arn }

############################################################################
# OUT-OF-BAND WIRING (prod EB settings are not TF-managed - see eb-imported.tf)
#
# Canopy is sandbox-first. Prod stays connect-disabled (manual path only) until
# real Canopy production credentials exist, because canopyConfig.connectEnabled
# requires CANOPY_CLIENT_ID + CANOPY_CLIENT_SECRET + CANOPY_PUBLIC_ALIAS to be
# set. So provisioning these tables is safe on its own - nothing calls Canopy in
# prod until the secrets below are set.
#
# When Canopy production access is granted, set on loadlead-backend-prod (one
# time; the deploy pipeline preserves them thereafter):
#
#   CANOPY_CLIENT_ID       = <from Canopy dashboard, production credential set>
#   CANOPY_CLIENT_SECRET   = <from Canopy dashboard, production credential set>
#   CANOPY_WEBHOOK_SECRET  = <from Canopy dashboard webhook settings>
#   CANOPY_PUBLIC_ALIAS    = <the production link/widget public alias>
#   CANOPY_WIDGET_ID       = <the production widget id, for monitoring API>
#   CANOPY_UI_MODE         = widget          # or components once it passes the suite
#   COMPLIANCE_EVALUATOR   = local           # local | shadow | policy_check
#
# Do NOT set CANOPY_ENV in prod (or set it exactly to "production"): the
# production lock resolves Canopy to "production" unconditionally, and the
# contamination guard refuses boot if CANOPY_ENV is present with any other value.
############################################################################
