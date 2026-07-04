// Em/en-dash gate. The project style forbids em dashes (U+2014) and en dashes
// (U+2013) anywhere in code, comments, or copy - regular hyphens only.
//
// Runs in CI (frontend-lint) and locally: `node scripts/check-dashes.mjs`.
// Scans src/ + e2e/ .ts/.tsx/.css. Exit 1 (with file:line list) if any found.
//
// Note: a plain `grep '\|'` pattern is unreliable on BSD/macOS grep, which is
// why this is a dedicated script rather than a one-line grep step.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "e2e"];
const EXTS = [".ts", ".tsx", ".css"];
const BAD = /[—–]/; // — em dash, – en dash

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.some((e) => p.endsWith(e))) out.push(p);
  }
}

const files = [];
for (const r of ROOTS) {
  try { walk(r, files); } catch { /* root may not exist */ }
}

const hits = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (BAD.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}

if (hits.length) {
  console.error(`Dash gate: found ${hits.length} em/en dash(es). Use regular hyphens.`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.error("Dash gate: clean (no em/en dashes in src + e2e).");
