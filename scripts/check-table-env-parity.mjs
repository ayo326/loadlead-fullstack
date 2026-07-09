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

// Two ways the backend resolves a table name:
//  1. Config tables go through environment.ts's `t('DYNAMODB_X_TABLE', 'default')`
//     prefix deriver. In a non-prod stack these are satisfied by a single
//     DYNAMODB_TABLE_PREFIX (each derives to prefix + default-minus-LoadLead_).
//  2. Service-file-direct tables read `process.env.DYNAMODB_X_TABLE || 'default'`
//     with no config slot, so the prefix does NOT reach them - each still needs
//     its own explicit override in every non-prod stack.
const PREFIX_DERIVED_RE = /\bt\('(DYNAMODB_[A-Z_]+_TABLE)',\s*'([^']+)'\)/g;
const ENV_VAR_RE = /process\.env\.(DYNAMODB_[A-Z_]+_TABLE)(?:\s*\|\|\s*'([^']+)')?/g;
const TF_KEY_RE = /(DYNAMODB_[A-Z_]+_TABLE)\s*=/g;
const TF_PREFIX_RE = /DYNAMODB_TABLE_PREFIX\s*=/;

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

// 1. Collect every DYNAMODB_*_TABLE the backend reads, split by resolution path:
//    - prefixDerived: config tables via `t('X', 'default')`  -> satisfied by DYNAMODB_TABLE_PREFIX
//    - directRead:    service tables via `process.env.X`     -> need an explicit per-table override
const prefixDerived = new Map(); // envVar -> defaultName
const directRead = new Map();    // envVar -> defaultName | null
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(PREFIX_DERIVED_RE)) {
    const [, envVar, def] = m;
    prefixDerived.set(envVar, def);
  }
  for (const m of text.matchAll(ENV_VAR_RE)) {
    const [, envVar, def] = m;
    // A table routed through t() may also appear elsewhere as a raw read; the
    // t() classification wins (it's the config source of truth).
    if (prefixDerived.has(envVar)) continue;
    if (!directRead.has(envVar) || (def && !directRead.get(envVar))) {
      directRead.set(envVar, def ?? directRead.get(envVar) ?? null);
    }
  }
}

function suffixFor(envVar) {
  const def = prefixDerived.get(envVar) ?? directRead.get(envVar);
  if (def) return def.replace(/^LoadLead[-_]/, '');
  return KNOWN_SUFFIX[envVar] ?? null;
}

// 2. For each non-prod stack, check coverage. A config (prefix-derived) table is
//    covered by a single DYNAMODB_TABLE_PREFIX OR its own explicit override; a
//    service-direct table must have its own explicit override.
let failed = false;
const derivedKeys = [...prefixDerived.keys()].sort();
const directKeys = [...directRead.keys()].sort();
console.log(
  `Backend reads ${derivedKeys.length + directKeys.length} DynamoDB table env vars ` +
    `(${derivedKeys.length} prefix-derived, ${directKeys.length} service-direct).\n`,
);

for (const [env, tfPath] of Object.entries(ENV_STACKS)) {
  let tf;
  try {
    tf = readFileSync(tfPath, 'utf8');
  } catch {
    console.log(`⚠  ${env}: ${tfPath} not found — skipping.`);
    continue;
  }
  const present = new Set([...tf.matchAll(TF_KEY_RE)].map((m) => m[1]));
  const hasPrefix = TF_PREFIX_RE.test(tf);

  // Prefix-derived config tables: fine if the stack sets DYNAMODB_TABLE_PREFIX
  // (all derive) or pins the table explicitly.
  const missingDerived = hasPrefix ? [] : derivedKeys.filter((k) => !present.has(k));
  // Service-direct tables always need their own override.
  const missingDirect = directKeys.filter((k) => !present.has(k));
  const missing = [...missingDerived, ...missingDirect];

  if (missing.length === 0) {
    const how = hasPrefix
      ? `DYNAMODB_TABLE_PREFIX covers ${derivedKeys.length} config tables + ${directKeys.length} explicit service overrides`
      : `all ${derivedKeys.length + directKeys.length} table overrides present`;
    console.log(`✅ ${env}: ${how}.`);
    continue;
  }
  failed = true;
  if (missingDerived.length && !hasPrefix) {
    console.log(
      `❌ ${env}: no DYNAMODB_TABLE_PREFIX and ${missingDerived.length} config table override(s) missing — ` +
        `set DYNAMODB_TABLE_PREFIX = local.prefix (covers all config tables at once).`,
    );
  }
  for (const k of missingDirect) {
    const suffix = suffixFor(k);
    const line = suffix
      ? `    ${k} = "\${local.prefix}${suffix}"`
      : `    ${k} = "\${local.prefix}???"  # TODO: no code default; set the real suffix`;
    console.log(`❌ ${env}: service-direct table missing override:\n${line}`);
  }
  console.log('');
}

if (failed) {
  console.error('\nParity check FAILED. Every non-prod environment must set DYNAMODB_TABLE_PREFIX (covers');
  console.error('config tables) plus an explicit override for each service-direct table, so it can never');
  console.error('read or write production data.');
  process.exit(1);
}
console.log('\nParity check passed: every non-prod stack fully namespaces every table the backend reads.');
