const fs = require('fs');
const path = require('path');

const SOURCES = [
  path.resolve(__dirname, '.out/vitest.json'),
  // Cross-persona contract tests (H5..H10) live in frontend-v2; merge
  // their results so the dashboard + Jira manifest see them too.
  path.resolve(__dirname, '../../frontend-v2/tests/.out/contract.json'),
];
const OUT = path.resolve(__dirname, '../../test-results.json');

const MAP = { passed: 'pass', failed: 'fail', skipped: 'blocked', todo: 'blocked', pending: 'blocked' };
const ID  = /\[([A-H]\d+[a-z]?)\]/;

// Start with existing results so a partial run (one workspace only)
// doesn't drop the other workspace's previously-recorded IDs.
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
delete out.__meta;

for (const IN of SOURCES) {
  if (!fs.existsSync(IN)) { console.log(`No test results at ${IN} — skipping.`); continue; }
  const run = JSON.parse(fs.readFileSync(IN, 'utf8'));
  for (const file of run.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      const m = (a.fullName || a.title || '').match(ID);
      if (!m) continue;
      const status = MAP[a.status] ?? 'blocked';
      // Worst-result-wins per [Hn]: if any matching assertion failed,
      // the whole ID is fail.
      out[m[1]] = out[m[1]] === 'fail' ? 'fail' : (status === 'fail' ? 'fail' : (out[m[1]] || status));
    }
  }
}
out.__meta = { syncedAt: new Date().toISOString(), total: Object.keys(out).length - 1 };

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Wrote ${OUT} (${out.__meta.total} ids)`);
