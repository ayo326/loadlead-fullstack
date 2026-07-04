// Authed-crawl support: seed a session + mock the API at the network boundary.
//
// The app authenticates via an httpOnly cookie and GET /api/auth/me. There is
// no dev-login shortcut, so to render an authed dashboard hermetically we
// intercept every /api/** call:
//   - GET /auth/me            -> a persona user object (this "logs in" the SPA)
//   - everything else         -> a permissive default so pages reach their
//                                empty/loaded state instead of throwing.
//
// Most list endpoints read `res.key ?? []`, so returning {} yields empty
// states. A few endpoints that front-load the dashboard get slightly richer
// stubs below. The goal is a rendered page with zero app console/page errors,
// not realistic data.

import type { Page, Route } from "@playwright/test";

export type CrawlRole =
  | "DRIVER"
  | "SHIPPER"
  | "RECEIVER"
  | "OWNER_OPERATOR"
  | "CARRIER_ADMIN"
  | "ADMIN";

const USER_ID = "test-user-1";

function userFor(role: CrawlRole) {
  return {
    userId: USER_ID,
    email: `${role.toLowerCase()}@example.test`,
    role,
    // ADMIN Settings/Staff UI gates on a platform tier; give the highest so
    // every admin panel renders for the crawl.
    platformRole: role === "ADMIN" ? "STAFF_ADMIN" : undefined,
    displayName: "Test User",
    createdAt: 1_700_000_000_000,
  };
}

// Endpoint-specific stubs (matched by suffix of the path after /api).
// Keep minimal; only what a dashboard needs to render without throwing.
function stubFor(path: string, role: CrawlRole): unknown {
  // Auth
  if (path.endsWith("/auth/me")) return { user: userFor(role) };

  // Profiles - return a null-ish profile so "complete your profile" states show
  // rather than crashing on a missing object.
  if (path.endsWith("/driver/profile")) return { driver: null };
  if (path.endsWith("/shipper/profile")) return { shipper: null };
  if (path.endsWith("/receiver/profile")) return { receiver: null };

  // Common list shapes seen across dashboards. Returning all of these keys is
  // harmless: a consumer reads whichever one it expects and ignores the rest.
  return {
    loads: [],
    offers: [],
    items: [],
    entries: [],
    members: [],
    invites: [],
    drivers: [],
    notifications: [],
    applications: [],
    apps: [],
    assignments: [],
    submissions: [],
    contact: null,
    data: null,
    loadboard: [],
    stats: {},
    dashboard: {},
  };
}

export interface AuthMockOptions {
  /** Leave the Shepherd tour armed. Default false (suppressed) so its modal
   *  overlay does not intercept the crawl. */
  keepTour?: boolean;
}

export async function installAuthMock(
  page: Page,
  role: CrawlRole,
  opts: AuthMockOptions = {},
): Promise<void> {
  // Suppress the onboarding tour for every persona + variant (the app's own
  // localStorage gate) so it never auto-starts mid-crawl.
  if (!opts.keepTour) {
    await page.addInitScript(() => {
      const personas = ["CARRIER_ADMIN", "OWNER_OPERATOR", "DRIVER", "SHIPPER", "RECEIVER"];
      for (const p of personas) {
        localStorage.setItem(`loadlead.tour.completed.${p}`, "1");
        localStorage.setItem(`loadlead.tour.completed.${p}.dashboard`, "1");
        localStorage.setItem(`loadlead.tour.completed.${p}.settings`, "1");
      }
    });
  }

  // Intercept the whole API surface.
  await page.route("**/api/**", (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api/, ""); // strip host + /api prefix
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(stubFor(path, role)),
    });
  });

  // Block external assets (maps, fonts, analytics) so the run is hermetic.
  await page.route(/^https?:\/\/(?!localhost)/, (route: Route) => {
    const t = route.request().resourceType();
    if (t === "document" || t === "xhr" || t === "fetch") return route.continue();
    return route.abort();
  });
}
