#!/usr/bin/env node
// smoke-admin-mfa.mjs — security smoke test (audit rec #4).
//
// Asserts the LL-AC-004 control end-to-end against a REAL running environment:
// an ADMIN account with NO enrolled MFA must be REFUSED at login (403
// MFA_REQUIRED) and must never receive an auth token or a 2FA ticket.
//
// This exists because the mocked unit test (M2) rotted into a false green once
// the beta gate started fronting /login — a mock can't catch that; a real HTTP
// call through the whole middleware stack can. Run it post-deploy against staging
// (or any env with a seeded ADMIN-without-MFA account).
//
// Config (skips cleanly with exit 0 when unset, so it is safe in CI before the
// staging environment + a seeded account exist):
//   SMOKE_BASE_URL            e.g. https://staging.loadleadapp.com
//   SMOKE_ADMIN_NO_MFA_EMAIL  a seeded ADMIN account with 2FA NOT enrolled
//   SMOKE_ADMIN_PASSWORD      that account's password
//
//   node scripts/smoke-admin-mfa.mjs

const base = process.env.SMOKE_BASE_URL;
const email = process.env.SMOKE_ADMIN_NO_MFA_EMAIL;
const password = process.env.SMOKE_ADMIN_PASSWORD;

if (!base || !email || !password) {
  console.log(
    'smoke-admin-mfa: SKIPPED — set SMOKE_BASE_URL + SMOKE_ADMIN_NO_MFA_EMAIL + SMOKE_ADMIN_PASSWORD to enable ' +
      '(seed an ADMIN account with no enrolled 2FA in that environment).'
  );
  process.exit(0);
}

const url = `${base.replace(/\/$/, '')}/api/auth/login`;

let res, body;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  body = await res.json().catch(() => ({}));
} catch (err) {
  console.error(`smoke-admin-mfa: FAILED to reach ${url}: ${err?.message ?? err}`);
  process.exit(1);
}

// The control: refused with MFA_REQUIRED, and no token / ticket / auth signal leaked.
const refused = res.status === 403 && body?.error === 'MFA_REQUIRED';
const leaked = Boolean(body?.token || body?.twoFactorTicket || body?.needsTwoFactor);

if (refused && !leaked) {
  console.log('smoke-admin-mfa: PASS — ADMIN without MFA refused (403 MFA_REQUIRED), no token issued.');
  process.exit(0);
}

console.error('smoke-admin-mfa: SECURITY FAIL — ADMIN login without enrolled MFA was not properly refused.');
console.error('  expected: HTTP 403 { "error": "MFA_REQUIRED" }, no token/ticket');
console.error(`  got:      HTTP ${res.status} ${JSON.stringify(body)}`);
process.exit(1);
