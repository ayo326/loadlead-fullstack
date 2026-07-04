#!/usr/bin/env node
// check-terraform-staging-first.mjs
//
// Codifies the "staging before prod" rule for Terraform, as a PR gate.
//
// The invariant: an infrastructure change reaches STAGING before PROD. CI can't
// see the order of out-of-band `tofu apply`s, so we enforce the closest thing it
// CAN see in a PR diff:
//
//   * HARD FAIL — the PR changes prod's stack (infra/terraform/envs/prod/**) but
//     does NOT change staging's stack (infra/terraform/envs/staging/**). A prod
//     stack change that was never mirrored to staging skipped the pre-prod step.
//     Override for a genuinely prod-only change: put [terraform-prod-only] in the
//     PR body (or add the `terraform-prod-only` label — surfaced via PR_BODY/LABELS).
//
//   * WARN — the PR changes a shared module (infra/terraform/modules/**). Modules
//     are consumed by every env; apply to staging and verify before you dispatch
//     the prod apply. Non-blocking.
//
// Inputs (from the workflow):
//   BASE_REF   the PR base branch (e.g. "main"); diff is origin/$BASE_REF...HEAD
//   PR_BODY    the pull request body (for the override token)          [optional]
//   PR_LABELS  comma/space-separated PR labels                          [optional]

import { execSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'main';
const PR_BODY = process.env.PR_BODY || '';
const PR_LABELS = process.env.PR_LABELS || '';

const OVERRIDE =
  /\[terraform-prod-only\]/i.test(PR_BODY) ||
  /(^|[\s,])terraform-prod-only([\s,]|$)/i.test(PR_LABELS);

function changedFiles() {
  try {
    // origin/<base>...HEAD = files changed on this branch since it forked base.
    const out = execSync(`git diff --name-only origin/${BASE_REF}...HEAD`, { encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.error(`could not diff against origin/${BASE_REF}: ${err?.message || err}`);
    process.exit(1);
  }
}

const files = changedFiles();
const touched = (prefix) => files.some((f) => f.startsWith(prefix));

const touchesProd = touched('infra/terraform/envs/prod/');
const touchesStaging = touched('infra/terraform/envs/staging/');
const touchesModules = touched('infra/terraform/modules/');

if (touchesModules) {
  console.log(
    '::warning::Shared Terraform module changed. Apply + verify on STAGING before ' +
      'you dispatch the prod apply (staging-before-prod).'
  );
}

if (touchesProd && !touchesStaging) {
  if (OVERRIDE) {
    console.log(
      'staging-first: prod stack changed without a staging change, but override ' +
        '([terraform-prod-only]) is present — allowed.'
    );
    process.exit(0);
  }
  console.error(
    '::error::staging-before-prod: this PR changes infra/terraform/envs/prod/** but not ' +
      'infra/terraform/envs/staging/**.\n' +
      'Mirror the change into the staging stack and validate it there first, or — if it is ' +
      'genuinely prod-only — add [terraform-prod-only] to the PR body (or the ' +
      '`terraform-prod-only` label).'
  );
  process.exit(1);
}

console.log('staging-before-prod: OK');
