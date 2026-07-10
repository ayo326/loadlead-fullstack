/**
 * LoadLead staging load test (audit v4 COA-3B).
 *
 * Run against STAGING ONLY - never prod. Sized via env vars so the same
 * script does a smoke ramp or the pre-beta 10x run:
 *
 *   k6 run scripts/loadtest/k6-staging.js                       # smoke (default)
 *   k6 run -e TARGET_VUS=50 -e DURATION=5m scripts/loadtest/k6-staging.js
 *   k6 run -e AUTH_TOKEN=<jwt> ...                              # adds authed scenario
 *
 * Scenarios:
 *   - health:      cheap liveness at sustained RPS (baseline latency).
 *   - beta_status: the runtime-config read every SPA boot performs.
 *   - authed:      OO dashboard + compliance status (the query-first reads
 *                  from COA-3A), only when AUTH_TOKEN is provided.
 *
 * Deliberately NOT hammered: /api/compliance/w9/render-check (rate-limited
 * 10/min/IP by design - hitting it in a load test just measures the limiter)
 * and /api/auth/* (limited 15/15min; use AUTH_RATE_LIMIT_BYPASS=1 on the env
 * plus a pre-minted token instead).
 *
 * Thresholds encode the audit's pre-beta bar: p95 < 800ms on reads, <1%
 * errors. A threshold failure exits non-zero - CI-able.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://api-staging.loadleadapp.com';
const VUS = Number(__ENV.TARGET_VUS || 5);
const DURATION = __ENV.DURATION || '1m';
const TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  scenarios: {
    health: {
      executor: 'constant-vus',
      exec: 'health',
      vus: Math.max(1, Math.floor(VUS / 2)),
      duration: DURATION,
    },
    beta_status: {
      executor: 'constant-vus',
      exec: 'betaStatus',
      vus: Math.max(1, Math.floor(VUS / 2)),
      duration: DURATION,
    },
    ...(TOKEN
      ? {
          authed: {
            executor: 'constant-vus',
            exec: 'authed',
            vus: Math.max(1, Math.floor(VUS / 2)),
            duration: DURATION,
          },
        }
      : {}),
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:health}': ['p(95)<400'],
    'http_req_duration{scenario:beta_status}': ['p(95)<800'],
    ...(TOKEN ? { 'http_req_duration{scenario:authed}': ['p(95)<800'] } : {}),
  },
};

export function health() {
  const r = http.get(`${BASE}/api/health`);
  check(r, { 'health 200': (res) => res.status === 200 });
  sleep(1);
}

export function betaStatus() {
  const r = http.get(`${BASE}/api/beta/status`);
  check(r, { 'beta status 200': (res) => res.status === 200 });
  sleep(1);
}

export function authed() {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const dash = http.get(`${BASE}/api/owner-operator/dashboard`, { headers, tags: { name: 'oo-dashboard' } });
  check(dash, { 'dashboard 200': (res) => res.status === 200 });
  const status = http.get(`${BASE}/api/compliance/status`, { headers, tags: { name: 'compliance-status' } });
  check(status, { 'compliance status 200': (res) => res.status === 200 });
  sleep(1);
}
