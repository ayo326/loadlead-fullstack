#!/usr/bin/env node
// check-table-env-parity.mjs
//
// Guards against the H1 defect: a non-prod environment silently falling back
// to the production `LoadLead_*` DynamoDB tables because an env-var override
// was never added to its Terraform stack.
//
// It cross-references EVERY `process.env.DYNAMODB_*_TABLE` the backend reads
// against the env-var maps in each non-prod Terraform stack, and fails (exit 1)
// if any environment is missing an override. Run locally or in CI.
//
//   node scripts/check-table-env-parity.mjs
//
// Zero dependencies; pure Node.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'backend', 'src');
const ENV_STACKS = {
  staging: join(ROOT, 'infra', 'terraform', 'envs', 'staging', 'main.tf'),
  dev: join(ROOT, 'infra', 'terraform', 'envs', 'dev', 'main.tf'),
};

// A few tables are read via process.env with no inline `|| 'default'`, so their
// canonical (prod) name can't be inferred from the code. Pin the known suffix
// here so the report can suggest a ready-to-paste Terraform line.
const KNOWN_SUFFIX = {
  DYNAMODB_MEMBERSHIP_AUDIT_TABLE: 'MembershipAuditLogs',
};

const ENV_VAR_RE = /process\.env\.(DYNAMODB_[A-Z_]+_TABLE)(?:\s*\|\|\s*'([^']+)')?/g;
const TF_KEY_RE = /(DYNAMODB_[A-Z_]+_TABLE)\s*=/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// 1. Collect every DYNAMODB_*_TABLE the backend actually reads, with its
//    default (prod) name when the code provides one.
const required = new Map(); // envVar -> defaultName | null
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(ENV_VAR_RE)) {
    const [, envVar, def] = m;
    if (!required.has(envVar) || (def && !required.get(envVar))) {
      required.set(envVar, def ?? required.get(envVar) ?? null);
    }
  }
}

function suffixFor(envVar) {
  const def = required.get(envVar);
  if (def) return def.replace(/^LoadLead[-_]/, '');
  return KNOWN_SUFFIX[envVar] ?? null;
}

// 2. For each non-prod stack, find which overrides are present.
let failed = false;
const requiredKeys = [...required.keys()].sort();
console.log(`Backend reads ${requiredKeys.length} DynamoDB table env vars.\n`);

for (const [env, tfPath] of Object.entries(ENV_STACKS)) {
  let tf;
  try {
    tf = readFileSync(tfPath, 'utf8');
  } catch {
    console.log(`⚠  ${env}: ${tfPath} not found — skipping.`);
    continue;
  }
  const present = new Set([...tf.matchAll(TF_KEY_RE)].map((m) => m[1]));
  const missing = requiredKeys.filter((k) => !present.has(k));

  if (missing.length === 0) {
    console.log(`✅ ${env}: all ${requiredKeys.length} table overrides present.`);
    continue;
  }
  failed = true;
  console.log(`❌ ${env}: ${missing.length} missing override(s) — this env would hit PROD tables for:`);
  for (const k of missing) {
    const suffix = suffixFor(k);
    const line = suffix
      ? `    ${k} = "\${local.prefix}${suffix}"`
      : `    ${k} = "\${local.prefix}???"  # TODO: no code default; set the real suffix`;
    console.log(line);
  }
  console.log('');
}

if (failed) {
  console.error('\nParity check FAILED. Add the missing DYNAMODB_*_TABLE overrides above so every');
  console.error('non-prod environment is fully namespaced and cannot read or write production data.');
  process.exit(1);
}
console.log('\nParity check passed: every non-prod stack overrides every table the backend reads.');
