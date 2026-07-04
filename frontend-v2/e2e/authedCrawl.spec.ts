// D12 (full): authenticated per-persona rendered-surface crawl.
//
// For each persona we seed a session (installAuthMock mocks /api/auth/me +
// the dashboard endpoints) and visit that persona's authed routes, asserting
// per route:
//   1. no app-origin console errors,
//   2. no uncaught page errors (the ReferenceError class),
//   3. no rendered placeholder / filler copy,
//   4. it did not fall through to the SPA 404 screen.
//
// Scope: the non-parameterised authed surface (dashboards, history, analytics,
// settings, members, post, verification, factoring). Entity-detail routes
// (/.../loads/:id) need per-entity fixtures and are a documented follow-up;
// the pages themselves are exercised structurally here via their list roots.

import { test, expect, type ConsoleMessage } from "@playwright/test";
import { installAuthMock, type CrawlRole } from "./support/authMock";

const FILLER = /lorem ipsum|coming soon|under construction|not implemented yet|placeholder text|to be implemented/i;

// Authed routes per persona (no route params). Kept in sync with App.tsx.
const ROUTES: Record<CrawlRole, string[]> = {
  DRIVER: ["/driver", "/driver/history", "/driver/analytics", "/driver/verification/idv", "/settings"],
  SHIPPER: ["/shipper", "/shipper/post", "/settings"],
  RECEIVER: ["/receiver", "/settings"],
  OWNER_OPERATOR: ["/owner-operator", "/owner-operator/history", "/owner-operator/analytics", "/owner-operator/factoring", "/owner-operator/settings", "/settings"],
  CARRIER_ADMIN: ["/carrier", "/carrier/members", "/carrier/factoring", "/settings"],
  ADMIN: ["/admin", "/settings"],
};

for (const [role, routes] of Object.entries(ROUTES) as [CrawlRole, string[]][]) {
  test.describe(`authed crawl: ${role}`, () => {
    for (const route of routes) {
      test(`${role} ${route} renders clean`, async ({ page }) => {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on("console", (m: ConsoleMessage) => { if (m.type() === "error") consoleErrors.push(m.text()); });
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await installAuthMock(page, role);

        const resp = await page.goto(route, { waitUntil: "networkidle" });
        expect(resp?.status(), `HTTP status for ${route}`).toBeLessThan(400);

        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator("body")).toBeVisible();
        // Give the lazy route chunk + first data fetch a beat to settle.
        await page.waitForTimeout(300);

        const bodyText = (await page.locator("body").innerText()).toLowerCase();
        expect(bodyText, `filler copy on ${role} ${route}`).not.toMatch(FILLER);
        expect(bodyText, `unexpected 404 screen on ${role} ${route}`).not.toContain("page not found");

        const appErrors = consoleErrors.filter(
          (e) =>
            !/google|maps|font|analytics|favicon|manifest/i.test(e) &&
            !/failed to load resource|\/api\/|net::err|status of (4|5)\d\d/i.test(e),
        );
        expect(appErrors, `console errors on ${role} ${route}`).toEqual([]);
        expect(pageErrors, `uncaught page errors on ${role} ${route}`).toEqual([]);
      });
    }
  });
}
