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

// Full Owner-Operator dashboard payload. Mirrors the nested shape that
// OwnerOperatorDashboardView (My haul, Verification, Dispatcher + Exec views)
// consumes, so the de-stacked dashboard renders end to end. Telemetry fields
// are plain values (not the "unavailable" sentinel), so they show as metrics.
const OO_DASHBOARD = {
  myHaul: null,
  verification: {
    authority: { verificationCurrent: true, daysToExpiry: 120 },
    identity: { status: "APPROVED", daysToExpiry: 300 },
  },
  alerts: {
    activeLoads: { booked: 1, dispatched: 0, inTransit: 2, atPickup: 0, delivered: 5 },
    unassigned: [],
    etaAtRisk: [],
    hosWarnings: 0,
    reeferDeviations: 0,
    daysToExpiry: 120,
    verificationCurrent: true,
  },
  fleet: {
    drivers: [{ driverId: "d1", name: "Self Driver", isSelf: true, idvStatus: "APPROVED", availability: "free" }],
    onboarding: { verified: 1, blocked: 0 },
    insurance: "Active",
    hosRemaining: "8h 30m",
    equipmentHealth: "OK",
  },
  loadboard: { tendered: [], dwell: "1.2h", deadhead: "42 mi" },
  financial: {
    grossRevenue: { week: 4200, month: 18500 },
    rpm: { avg: 2.45, byLoad: [] },
    payeeBreakdown: { carrier: 16000, factor: 2500 },
    factoringPipeline: { submitted: 3, approved: 2, funded: 1 },
    fuelSpend: 1200,
    tolls: 180,
  },
  sla: {
    otp: { pickupPct: 0.96, deliveryPct: 0.94 },
    acceptance: { acceptanceRate: 0.88, rejectionRate: 0.12 },
    compliancePosture: { authorityActive: true },
    csaScores: "Good",
  },
};

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

  // Owner-Operator: a populated profile + full dashboard payload so the crawl
  // and visual QA exercise the real de-stacked dashboard (V1-V3) instead of the
  // onboarding gate. Shape mirrors what OwnerOperatorDashboardView consumes.
  if (path.endsWith("/owner-operator/profile")) {
    return { ownerOperator: { ownerOperatorId: "oo-1", legalName: "Test Hauling LLC", currentCity: "Chicago", currentState: "IL" } };
  }
  if (path.endsWith("/owner-operator/dashboard")) return OO_DASHBOARD;

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
