#!/usr/bin/env -S npx tsx
/**
 * compliance/merge.ts
 *
 * Reads all compliance/out/*.ll.json + compliance/out/oscap.meta.json,
 * merges them into compliance-results.json next to the dashboard.
 *
 * Precedence: Open > NotAFinding > absent.
 * CAT I gating: if ANY CAT I LL-ID resolves to Open, exit non-zero so the
 * publish job fails and blocks the workflow. CAT II/III are reported only.
 *
 * Output shape:
 *   {
 *     "__meta": { "syncedAt": "...", "tools": [...], "host_pass_rate": 0.83 },
 *     "__gate": { "cat1": "RED|GREEN|HOLD", "open_cat1": ["LL-AC-002", ...] },
 *     "LL-IA-002": "Open",
 *     "LL-SC-001": "NotAFinding",
 *     ...
 *   }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

type Status = 'Open' | 'NotAFinding';

function loadMap(p: string) {
  return yaml.load(fs.readFileSync(p, 'utf8')) as {
    cat_levels: Record<string, 'I' | 'II' | 'III'>;
    titles: Record<string, string>;
  };
}

function listLlJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.ll.json')).map(f => path.join(dir, f));
}

function main() {
  const outDir = process.argv[2] ?? 'compliance/out';
  const outFile = process.argv[3] ?? 'compliance-results.json';
  const mapPath = 'compliance/llmap.yaml';

  const map = loadMap(mapPath);
  const files = listLlJson(outDir);
  if (files.length === 0) {
    console.error(`no tool outputs found in ${outDir} — did any compliance jobs run?`);
    process.exit(2);
  }

  // Merge with precedence: Open > NotAFinding > absent
  const merged: Record<string, Status> = {};
  const toolsUsed: string[] = [];
  for (const f of files) {
    const tool = path.basename(f).replace('.ll.json', '');
    toolsUsed.push(tool);
    const data = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, Status>;
    for (const [id, status] of Object.entries(data)) {
      if (merged[id] === 'Open') continue;  // sticky
      if (status === 'Open' || merged[id] === undefined) merged[id] = status;
    }
  }

  // Pull host pass-rate from oscap sidecar
  let hostPassRate: number | null = null;
  const oscapMeta = path.join(outDir, 'oscap.meta.json');
  if (fs.existsSync(oscapMeta)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(oscapMeta, 'utf8'));
      if (typeof sidecar.host_pass_rate === 'number') hostPassRate = sidecar.host_pass_rate;
    } catch { /* malformed sidecar — surface as null */ }
  }

  // Gate computation
  const openCat1: string[] = [];
  const pendingCat1: string[] = [];
  for (const [id, cat] of Object.entries(map.cat_levels)) {
    if (cat !== 'I') continue;
    const s = merged[id];
    if (s === 'Open') openCat1.push(id);
    else if (s === undefined) pendingCat1.push(id);
  }
  const cat1Gate: 'RED' | 'HOLD' | 'GREEN' =
    openCat1.length > 0 ? 'RED' : pendingCat1.length > 0 ? 'HOLD' : 'GREEN';

  const final: Record<string, any> = {
    __meta: {
      syncedAt: new Date().toISOString(),
      tools: toolsUsed.sort(),
      host_pass_rate: hostPassRate,
      total_llids: Object.keys(map.cat_levels).length,
      reported: Object.keys(merged).length,
    },
    __gate: {
      cat1: cat1Gate,
      open_cat1: openCat1.sort(),
      pending_cat1: pendingCat1.sort(),
    },
    ...merged,
  };

  // Keep keys sorted for deterministic diffs (meta + gate first, then LL-IDs)
  const sortedLlIds = Object.keys(merged).sort();
  const out: Record<string, any> = { __meta: final.__meta, __gate: final.__gate };
  for (const k of sortedLlIds) out[k] = merged[k];

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${outFile}`);
  console.log(`  tools:           ${toolsUsed.length} (${toolsUsed.join(', ')})`);
  console.log(`  llids reported:  ${Object.keys(merged).length} / ${Object.keys(map.cat_levels).length}`);
  console.log(`  cat I gate:      ${cat1Gate}`);
  if (openCat1.length) console.log(`  cat I open:      ${openCat1.join(', ')}`);
  if (hostPassRate !== null) console.log(`  host pass-rate:  ${(hostPassRate * 100).toFixed(1)}%`);

  // Exit non-zero if any CAT I LL-ID is Open — fails the publish job.
  if (cat1Gate === 'RED') {
    console.error('\n❌  COMPLIANCE GATE FAILED: CAT I open findings present. See open_cat1 above.');
    process.exit(1);
  }
}

main();
