# LoadLead infra — convenience targets.
#
# Staging rests at ~$0. TWO ways to pause the (only) billable piece, the EB env:
#
#   1. QUICK pause — the "Start/Pause staging env" button on the staging
#      homepage. Scales the env's instances to 0 ($0 compute) but leaves the env
#      provisioned; ~2-3 min each way. This is the day-to-day control.
#
#   2. FULL teardown — `make staging-pause` below (backend_enabled=false).
#      Destroys the EB env entirely; ~5 min to rebuild with staging-resume. Use
#      only to decommission. NOTE: a plain `tofu apply` keeps the env (default
#      true) and reconciles instances back to 1 — pause via the button/target,
#      not by editing tfvars.
#
#   make staging-resume   # ensure the env exists + running (t3.micro ~$0.01/hr)
#   make staging-pause    # FULL teardown of the env → ~$0
#   make staging-status    # is the env provisioned?
#   make staging-plan      # dry-run whatever the current tfvars imply

STAGING := envs/staging
TF      := tofu   # OpenTofu (drop-in terraform CLI)

.PHONY: staging-resume staging-pause staging-status staging-plan

staging-resume:
	cd $(STAGING) && $(TF) apply -var 'backend_enabled=true' -auto-approve
	@echo "Backend resuming. API will be live at the api_staging_domain in a few minutes."

staging-pause:
	cd $(STAGING) && $(TF) apply -var 'backend_enabled=false' -auto-approve
	@echo "Backend paused. Staging is back to ~\$$0 (tables + CloudFront idle)."

staging-status:
	@cd $(STAGING) && $(TF) output -raw backend_enabled 2>/dev/null \
		| sed 's/true/UP (billing ~\$$0.01\/hr)/; s/false/PAUSED (~\$$0)/' \
		|| echo "unknown (run tofu init/apply first)"

staging-plan:
	cd $(STAGING) && $(TF) plan
