#!/usr/bin/env -S npx tsx
/**
 * compliance/normalize.ts
 *
 * Reads a single tool's native report (SARIF / JSON / oscap ARF / etc.) and
 * the shared llmap.yaml, then emits compliance/out/<tool>.ll.json shaped as:
 *   { "LL-IA-002": "Open", "LL-SC-001": "NotAFinding", ... }
 *
 * Per the spec:
 *  - any mapped finding present → LL-ID = Open
 *  - tool attests an LL-ID, no matching finding → NotAFinding
 *  - tool cannot attest an LL-ID → omitted from this tool's output
 *
 * The merge step (merge.ts) then resolves cross-tool conflicts.
 *
 * Usage:
 *   npx tsx compliance/normalize.ts \
 *     --tool gitleaks --report path/to/gitleaks.json \
 *     [--out compliance/out/gitleaks.ll.json]
 *
 * Status: report only. This script does not modify code or remediate findings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

type Status = 'Open' | 'NotAFinding';
type LLMap = {
  cat_levels: Record<string, 'I' | 'II' | 'III'>;
  titles: Record<string, string>;
  tools: Record<
    string,
    {
      attests?: string[];
      rules?: Record<string, string[]>;
      severity_rules?: Record<string, string[]>;
    }
  >;
};

function loadMap(p: string): LLMap {
  const raw = fs.readFileSync(p, 'utf8');
  return yaml.load(raw) as LLMap;
}

function matchRule(ruleId: string, patterns: Record<string, string[]>): string[] {
  // Exact match first, then glob (* anywhere) match.
  if (patterns[ruleId]) return patterns[ruleId];
  for (const pat of Object.keys(patterns)) {
    if (!pat.includes('*')) continue;
    const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(ruleId)) return patterns[pat];
  }
  return [];
}

function emit(attests: string[], opened: Set<string>, outPath: string) {
  const result: Record<string, Status> = {};
  for (const id of attests) result[id] = opened.has(id) ? 'Open' : 'NotAFinding';
  // Any LL-ID flagged Open by this tool that isn't in attests is also emitted
  // (a rule may "tag" an LL-ID a tool didn't formally attest — that's still a
  // genuine finding worth surfacing).
  for (const id of opened) if (!attests.includes(id)) result[id] = 'Open';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`wrote ${outPath} (${Object.keys(result).length} LL-IDs)`);
}

// ── Tool-specific parsers ────────────────────────────────────────────────────

function parseGitleaks(reportPath: string): Set<string> {
  const opened = new Set<string>();
  if (!fs.existsSync(reportPath)) return opened;
  const raw = fs.readFileSync(reportPath, 'utf8').trim();
  if (!raw) return opened;
  // gitleaks emits a JSON array. Any non-empty entry is a leak.
  const findings = JSON.parse(raw) as any[];
  if (Array.isArray(findings) && findings.length > 0) {
    opened.add('LL-IA-002');
  }
  return opened;
}

function parseSemgrep(reportPath: string, map: LLMap): Set<string> {
  const opened = new Set<string>();
  if (!fs.existsSync(reportPath)) return opened;
  // SARIF format from `semgrep --sarif`.
  const sarif = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const rules = map.tools.semgrep?.rules ?? {};
  for (const run of sarif.runs ?? []) {
    for (const result of run.results ?? []) {
      const ruleId = (result.ruleId || '') as string;
      // SARIF level: 'error' or 'warning' are real findings; 'note'/'none' are ignored
      const level = (result.level || 'warning') as string;
      if (!['error', 'warning'].includes(level)) continue;
      for (const llId of matchRule(ruleId, rules)) opened.add(llId);
    }
  }
  return opened;
}

function parseNpmAudit(reportPath: string, map: LLMap): Set<string> {
  const opened = new Set<string>();
  if (!fs.existsSync(reportPath)) return opened;
  const audit = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const severities = audit?.metadata?.vulnerabilities ?? {};
  const sevRules = map.tools['npm-audit']?.severity_rules ?? {};
  for (const [sev, count] of Object.entries(severities)) {
    if (typeof count === 'number' && count > 0 && sevRules[sev]) {
      for (const llId of sevRules[sev]) opened.add(llId);
    }
  }
  return opened;
}

function parseSbom(reportPath: string): Set<string> {
  // SBOM presence is itself the attestation — parse just to confirm valid JSON.
  if (!fs.existsSync(reportPath)) return new Set<string>();
  try {
    JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    // Invalid SBOM → don't attest (omit from result)
    return new Set<string>(['__invalid__']);
  }
  return new Set<string>(); // empty = attests succeed, no Opens
}

function parseProwler(reportPath: string, map: LLMap): Set<string> {
  const opened = new Set<string>();
  if (!fs.existsSync(reportPath)) return opened;
  // Prowler v3+ JSON-OCSF is an array of check results.
  const raw = fs.readFileSync(reportPath, 'utf8').trim();
  if (!raw) return opened;
  let entries: any[];
  try {
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
  } catch {
    return opened;
  }
  const rules = map.tools.prowler?.rules ?? {};
  for (const e of entries) {
    // Prowler check IDs live under check_id / metadata.event_code depending on version
    const ruleId: string = e.check_id || e.metadata?.event_code || '';
    const status: string = (e.status || e.status_code || '').toString().toUpperCase();
    if (status !== 'FAIL' && status !== 'FAILED') continue;
    for (const llId of matchRule(ruleId, rules)) opened.add(llId);
  }
  return opened;
}

function parseOscap(reportPath: string): { passRate: number | null; opened: Set<string> } {
  // oscap emits XML ARF. We do not pull in an XML lib here — instead we
  // require the host job to produce a small JSON summary (oscap-summary.json)
  // that wraps {pass_rate, failed_rules: [...]}. The runner produces this
  // via `oscap xccdf eval --results` + a small awk/xmllint extractor.
  if (!fs.existsSync(reportPath)) return { passRate: null, opened: new Set() };
  const summary = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return {
    passRate: typeof summary.pass_rate === 'number' ? summary.pass_rate : null,
    opened: new Set<string>(summary.opened_ll_ids ?? []),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const tool = arg('--tool');
  const report = arg('--report');
  const out = arg('--out') ?? `compliance/out/${tool}.ll.json`;
  const mapPath = arg('--map') ?? 'compliance/llmap.yaml';

  if (!tool || !report) {
    console.error('usage: normalize.ts --tool <name> --report <path> [--out <path>] [--map <path>]');
    process.exit(2);
  }

  const map = loadMap(mapPath);

  let opened = new Set<string>();
  let attests: string[] = [];
  let extras: Record<string, any> = {};

  switch (tool) {
    case 'gitleaks':
      opened = parseGitleaks(report);
      attests = map.tools.gitleaks?.attests ?? [];
      break;
    case 'semgrep':
      opened = parseSemgrep(report, map);
      attests = map.tools.semgrep?.attests ?? [];
      break;
    case 'npm-audit':
      opened = parseNpmAudit(report, map);
      attests = map.tools['npm-audit']?.attests ?? [];
      break;
    case 'sbom':
      opened = parseSbom(report);
      attests = opened.has('__invalid__') ? [] : (map.tools.sbom?.attests ?? []);
      opened.delete('__invalid__');
      break;
    case 'prowler':
      opened = parseProwler(report, map);
      attests = map.tools.prowler?.attests ?? [];
      break;
    case 'oscap': {
      const r = parseOscap(report);
      opened = r.opened;
      attests = map.tools.oscap?.attests ?? [];
      if (r.passRate !== null) extras.host_pass_rate = r.passRate;
      break;
    }
    default:
      console.error(`unknown tool: ${tool}`);
      process.exit(2);
  }

  emit(attests, opened, out);

  // Sidecar file for the oscap pass-rate gauge (merge.ts picks this up).
  if (Object.keys(extras).length > 0) {
    const sidecar = out.replace(/\.ll\.json$/, '.meta.json');
    fs.writeFileSync(sidecar, JSON.stringify(extras, null, 2) + '\n');
    console.log(`wrote ${sidecar}`);
  }
}

main();
