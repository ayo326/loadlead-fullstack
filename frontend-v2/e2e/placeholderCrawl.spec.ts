// D12: rendered-surface crawl.
//
// Visits every route that renders WITHOUT an authenticated session (the public
// marketing + auth-funnel surface) and asserts three things per route:
//   1. zero console errors,
//   2. zero uncaught page errors (the ReferenceError class frontend-lint guards
//      against, caught here at runtime),
//   3. no user-facing placeholder / filler copy in the rendered DOM.
//
// The authenticated persona dashboards are covered statically by the D10
// placeholder gate (scripts/check-placeholders.sh) plus the negotiation E2E
// suite. A full authed runtime crawl needs a per-persona login fixture (a real
// or fully-mocked backend for every dashboard endpoint); that fixture is the
// documented follow-up. The public crawl here already catches the highest-
// frequency regression: a broken or placeholder screen on the funnel a logged-
// out visitor hits first.

import { test, expect, type ConsoleMessage } from "@playwright/test";

// Routes reachable with no auth. Kept in sync with App.tsx's public <Route>s.
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/private-beta",
  "/accept-invite",
  "/setup/admin",
  "/sandbox/taxonomy",
];

// Filler copy that must never render. Mirrors scripts/check-placeholders.sh.
const FILLER = /lorem ipsum|coming soon|under construction|not implemented yet|placeholder text|to be implemented/i;

for (const route of PUBLIC_ROUTES) {
  test(`public route ${route} renders clean`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const resp = await page.goto(route, { waitUntil: "networkidle" });

    // The SPA serves index.html for every path (200); a hard 4xx/5xx here would
    // mean the static host misrouted.
    expect(resp?.status(), `HTTP status for ${route}`).toBeLessThan(400);

    // Let the lazy route chunk resolve and paint.
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("body")).toBeVisible();

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText, `filler copy on ${route}`).not.toMatch(FILLER);
    // The SPA 404 screen renders "not found"; a public route must not land there.
    expect(bodyText, `unexpected 404 screen on ${route}`).not.toContain("page not found");

    // Ignore third-party console noise (fonts/maps/analytics) AND backend-
    // availability noise: this crawl is hermetic with no API server, so a
    // page's data fetch (e.g. Landing's /api/beta/status) returns 500 by
    // design. Those resource-load failures are environmental, not app defects.
    // What we DO catch: app-thrown console.error and uncaught pageerrors
    // (the ReferenceError class), plus rendered placeholder copy.
    const appErrors = consoleErrors.filter(
      (e) =>
        !/google|maps|font|analytics|favicon|manifest/i.test(e) &&
        !/failed to load resource|\/api\/|net::err|status of (4|5)\d\d/i.test(e),
    );
    expect(appErrors, `console errors on ${route}`).toEqual([]);
    expect(pageErrors, `uncaught page errors on ${route}`).toEqual([]);
  });
}
