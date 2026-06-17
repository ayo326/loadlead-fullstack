const fs = require('fs');
const path = require('path');

const IN  = path.resolve(__dirname, '.out/vitest.json');
const OUT = path.resolve(__dirname, '../../test-results.json');

if (!fs.existsSync(IN)) {
  console.log(`No test results at ${IN} — skipping sync.`);
  process.exit(0);
}

const run = JSON.parse(fs.readFileSync(IN, 'utf8'));
const MAP = { passed: 'pass', failed: 'fail', skipped: 'blocked', todo: 'blocked', pending: 'blocked' };
const ID  = /\[([A-H]\d+[a-z]?)\]/;

const out = {};
for (const file of run.testResults ?? []) {
  for (const a of file.assertionResults ?? []) {
    const m = (a.fullName || a.title || '').match(ID);
    if (!m) continue;
    const status = MAP[a.status] ?? 'blocked';
    out[m[1]] = out[m[1]] === 'fail' ? 'fail' : (status === 'fail' ? 'fail' : (out[m[1]] || status));
  }
}
out.__meta = { syncedAt: new Date().toISOString(), total: Object.keys(out).length - 1 };

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Wrote ${OUT} (${out.__meta.total} ids)`);
