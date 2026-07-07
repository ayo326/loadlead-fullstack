import { test, expect, type Page } from "@playwright/test";
import { installAuthMock, type CrawlRole } from "./support/authMock";

// Command-layout DoD checks for the recomposed Owner-Operator and Fleet Driver
// dashboards. Auth + API are mocked at the network boundary (support/authMock);
// per-test overrides inject offers with coordinates so the map pins render.

const DALLAS = { pickupLat: 32.7767, pickupLng: -96.797, deliveryLat: 29.7604, deliveryLng: -95.3698 };

function offerLoad(id: string, extra: Record<string, unknown> = {}) {
  return {
    load: {
      loadId: id, referenceNumber: id, pickupCity: "Dallas", pickupState: "TX",
      deliveryCity: "Houston", deliveryState: "TX", trailerType: "DRY_VAN",
      equipmentType: "DRY_VAN", totalWeightLbs: 34000, totalMiles: 240,
      rateType: "PER_MILE", rateAmount: 2.5, pickupTime: "08:00",
      pickupAddress: "100 Main St, Dallas, TX", deliveryAddress: "1 Bagby St, Houston, TX",
      ...DALLAS, ...extra,
    },
    offer: { status: "OFFERED", rate: 600, expiresAt: Math.floor(Date.now() / 1000) + 900 },
  };
}

// Register a more specific handler AFTER installAuthMock; Playwright runs the
// most-recently-added matching route first, so this overrides the generic stub.
async function withOffers(page: Page, loadboardPath: string, loads: unknown[], dashboard?: unknown) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(loadboardPath)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ loads }) });
    }
    if (dashboard && path.endsWith("/owner-operator/dashboard")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard) });
    }
    return route.fallback();
  });
}

const SIZES = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1080p", width: 1920, height: 1080 },
];

test.describe("Command layout - Owner Operator", () => {
  for (const s of SIZES) {
    test(`offers block is above the fold @ ${s.name}`, async ({ page }) => {
      await page.setViewportSize({ width: s.width, height: s.height });
      await installAuthMock(page, "OWNER_OPERATOR");
      await withOffers(page, "/owner-operator/loadboard", [offerLoad("OO-1")]);
      await page.goto("/owner-operator");
      const offers = page.getByRole("heading", { name: "Load offers" });
      await expect(offers).toBeVisible();
      await expect(offers).toBeInViewport();
    });
  }

  test("pin-click focuses the matching offer row", async ({ page }) => {
    await installAuthMock(page, "OWNER_OPERATOR");
    await withOffers(page, "/owner-operator/loadboard", [offerLoad("OO-9")]);
    await page.goto("/owner-operator");
    const row = page.getByTestId("offer-OO-9");
    await expect(row).toBeVisible();
    await page.getByTestId("map-pin-OO-9").click();
    await expect(row).toHaveClass(/amber/);
  });

  test("zero offers + zero earnings shows quiet states, no zero-wall", async ({ page }) => {
    await installAuthMock(page, "OWNER_OPERATOR");
    const zeroDash = {
      myHaul: null,
      verification: { authority: { verificationCurrent: true, daysToExpiry: 120 }, identity: { status: "APPROVED", daysToExpiry: 300 } },
      alerts: { activeLoads: { booked: 0, dispatched: 0, inTransit: 0, atPickup: 0, delivered: 0 }, unassigned: [], etaAtRisk: [], hosWarnings: 0, reeferDeviations: 0 },
      fleet: { drivers: [], onboarding: { verified: 0, blocked: 0 } },
      loadboard: { tendered: [] },
      financial: { grossRevenue: { week: 0, month: 0, total: 0 }, rpm: { avg: null, byLoad: [] }, payeeBreakdown: { carrier: 0, factor: 0 }, factoringPipeline: { submitted: 0, approved: 0, funded: 0 } },
      sla: { otp: {}, acceptance: {} },
    };
    await withOffers(page, "/owner-operator/loadboard", [], zeroDash);
    await page.goto("/owner-operator");
    await expect(page.getByText("No live offers right now.")).toBeVisible();
    await expect(page.getByText(/No settled earnings yet/)).toBeVisible();
    // The quiet earnings line replaces the figures, so no "Revenue this week" tile.
    await expect(page.getByText("Revenue this week")).toHaveCount(0);
  });
});

test.describe("Command layout - Fleet Driver", () => {
  for (const s of SIZES) {
    test(`offers block is above the fold @ ${s.name}`, async ({ page }) => {
      await page.setViewportSize({ width: s.width, height: s.height });
      await installAuthMock(page, "DRIVER");
      // Driver needs a populated profile so the affiliation/onboarding gates
      // do not replace the board; and offers with coords.
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/driver/profile")) {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ driver: { driverId: "d1", firstName: "Test", status: "VERIFIED", trailerType: "DRY_VAN", cdlClass: "A", maxCapacityLbs: 45000, safetyBufferPct: 10, currentCity: "Dallas", currentState: "TX" } }) });
        }
        if (path.endsWith("/driver/loadboard")) {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ loads: [offerLoad("DR-1")] }) });
        }
        if (path.endsWith("/driver/affiliation")) {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "AFFILIATED", carrier: { entityType: "OWNER_OPERATOR" } }) });
        }
        return route.fallback();
      });
      await page.goto("/driver");
      const offers = page.getByRole("heading", { name: /live offer/ });
      await expect(offers).toBeVisible();
      await expect(offers).toBeInViewport();
    });
  }
});
