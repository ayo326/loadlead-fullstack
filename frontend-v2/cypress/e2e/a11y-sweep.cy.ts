// Accessibility sweep — cypress-axe / axe-core against WCAG 2.1 AA
//
// Spec contract: "report a11y status on the key screens; violations
// listed". This sweep RUNS axe on each key screen and CAPTURES every
// violation it finds — it does NOT auto-fail on cosmetic / serious
// issues (that would hide the report). It DOES fail on `critical`
// impact (broken keyboard nav, missing label on a submit button, etc.).
//
// Output: each test logs a structured report via cy.task('log'). Run
// summary (across all screens) is aggregated into a single object that
// the audit doc reads. Screens covered:
//   /login                    (no auth)
//   /shipper                  dashboard
//   /shipper/post             load-creation form (taxonomy dropdowns)
//   /driver                   dashboard
//   /carrier                  dashboard (will hit honest empty state)
//   /owner-operator           dashboard (honest empty state)
//   /receiver                 dashboard
//
// /admin is on a separate bundle (admin.loadleadapp.com) gated by
// PlatformRole; not reachable from the customer dev server, so it's
// excluded from this sweep and will be its own spec when ADMIN seed
// exists.

import 'cypress-axe';

type AxeViolation = {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  description: string;
  nodes: { html?: string; target?: any[] }[];
};

const axeOptions = {
  // WCAG 2.1 AA — covers the standard the spec asks for.
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  // Skip rules that are noisy in a single-page-app dev build and not
  // meaningful for the audit (e.g. landmark-one-main fires on the
  // shadcn portal mount). Keep the security / keyboard rules ON.
  rules: {
    'landmark-one-main':   { enabled: false },
    'page-has-heading-one':{ enabled: false },
    'region':              { enabled: false },
  },
};

// Aggregate across the whole sweep so the audit doc has one source.
const aggregatedReport: Record<string, AxeViolation[]> = {};

function logReport(label: string, violations: AxeViolation[]) {
  aggregatedReport[label] = violations;
  const counts = violations.reduce(
    (acc, v) => { acc[v.impact ?? 'unknown'] = (acc[v.impact ?? 'unknown'] ?? 0) + 1; return acc; },
    {} as Record<string, number>,
  );
  cy.task('log', `axe [${label}] violations=${violations.length} ${JSON.stringify(counts)}`);
  violations.forEach((v) => {
    cy.task('log', `  - [${v.impact}] ${v.id}: ${v.description} (×${v.nodes.length})`);
  });
}

after(() => {
  // Write the full report to disk so docs/E2E_UI_AUDIT.md and the Jira
  // sync can pick it up without re-running cypress.
  cy.writeFile(
    'cypress/.state/a11y-report.json',
    JSON.stringify(aggregatedReport, null, 2),
    { log: false },
  );
});

function sweep(label: string, path: string, persona?: Parameters<Cypress.Chainable['loginAs']>[0]) {
  it(`a11y: ${label} (${path})`, function () {
    if (persona) cy.loginAs(persona);
    cy.visit(path);
    cy.injectAxe();
    // Give SPA a moment to settle async fetches before scanning.
    cy.wait(1000);
    cy.checkA11y(
      undefined,
      axeOptions,
      (violations) => logReport(label, violations as AxeViolation[]),
      /* skipFailures = */ true,   // log everything, fail only on critical
    );
    // Second pass: strict on `critical` only — that catches genuinely
    // broken interactions (missing form labels, untouchable controls).
    cy.checkA11y(
      undefined,
      { ...axeOptions, includedImpacts: ['critical'] },
      (violations) => {
        if (violations.length) {
          cy.task('log', `CRITICAL a11y violations on ${label}:`);
          logReport(`${label}:CRITICAL`, violations as AxeViolation[]);
        }
      },
      /* skipFailures = */ false,
    );
  });
}

describe('a11y sweep — WCAG 2.1 AA across key screens', () => {
  sweep('login (unauthenticated)', '/login');
  sweep('shipper dashboard',       '/shipper',      'shipper1');
  sweep('shipper post-load form',  '/shipper/post', 'shipper1');
  sweep('driver dashboard',        '/driver',       'driver1');
  sweep('carrier dashboard',       '/carrier',      'carrier1');
  sweep('owner-operator dashboard','/owner-operator', 'oo1');
  sweep('receiver dashboard',      '/receiver',     'receiver1');
});
