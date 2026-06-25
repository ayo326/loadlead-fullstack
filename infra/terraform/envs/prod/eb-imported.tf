############################################################################
# eb-imported.tf — Elastic Beanstalk Application + Environment, identity-
# only import.
#
# WHY identity-only:
#   The live prod environment has 151 OptionSettings. Many are AWS-managed
#   defaults that drift with platform-version updates; the rest are managed
#   day-to-day via the EB console, `aws elasticbeanstalk update-environment`
#   from deploy-backend.sh, or .ebextensions. Declaring all 151 in TF would
#   (a) be a multi-hour transcription with one chance to get it wrong, and
#   (b) lose the war against EB's own defaults on the next plan.
#
#   So this file gives TF authoritative ownership of the env's IDENTITY —
#   name, application, solution stack, tier, tags — and tells TF to
#   ignore the OptionSettings list entirely (lifecycle.ignore_changes).
#   The env still exists in TF state, can be referenced, and is protected
#   from a stray `terraform destroy`, but OptionSettings stay out-of-band.
#
#   To migrate a specific setting INTO TF later:
#     1. Read the live value:
#          aws elasticbeanstalk describe-configuration-settings ... \
#            --query 'ConfigurationSettings[0].OptionSettings[?Namespace==`X` && OptionName==`Y`]'
#     2. Add a `setting {}` block here matching that exact value.
#     3. Remove that pair from the ignore_changes list.
#     4. tofu plan — must be no-op (config matches live).
#   Migrate one setting at a time; never a bulk takeover.
############################################################################

# ─── Application (thin namespace; tags + name only) ───────────────────────
# Pre-existing on prod since day one. The earlier _bootstrap stack declared
# a different-cased "LoadLead-Backend" Application that was never applied;
# real prod uses lowercase "loadlead-backend". This block matches the real
# thing, so the orphan declaration in _bootstrap stays commented-out until
# someone reconciles the naming question (rename one, or both can coexist).
resource "aws_elastic_beanstalk_application" "backend" {
  name        = "loadlead-backend"
  description = null

  # description-and-tags are the only fields here; no appversion_lifecycle
  # — the existing app doesn't have one set, and adding one would auto-
  # delete old app versions on the next apply (silent destructive op).
  # Tracked as a separate decision; not part of an identity-only import.

  tags = local.tags
}

# ─── Environment (identity-only — settings managed out-of-band) ───────────
resource "aws_elastic_beanstalk_environment" "backend_prod" {
  name                = "loadlead-backend-prod"
  application         = aws_elastic_beanstalk_application.backend.name
  solution_stack_name = "64bit Amazon Linux 2023 v6.11.1 running Node.js 22"
  tier                = "WebServer"

  # No setting {} blocks here — see header. AWS-side settings are the
  # source of truth, ignored by TF.

  lifecycle {
    # ignore_changes on the `setting` block: TF reads them on refresh but
    # never plans changes to them. Anyone running deploy-backend.sh or
    # `aws elasticbeanstalk update-environment` can mutate settings
    # without triggering a TF drift fight.
    ignore_changes = [
      setting,
      # version_label flips with every backend deploy — also out-of-band.
      version_label,
    ]
  }

  tags = local.tags
}

output "eb_app_name"        { value = aws_elastic_beanstalk_application.backend.name }
output "eb_environment_name" { value = aws_elastic_beanstalk_environment.backend_prod.name }
output "eb_environment_cname" { value = aws_elastic_beanstalk_environment.backend_prod.cname }
