import { test, expect } from "@playwright/test";
import { installNegotiationMock } from "./support/negotiationMock";

/**
 * F1 regression: the persona onboarding tour must NOT auto-start on deep-linked
 * load-detail routes (only on the dashboard root). Before the fix, the tour's
 * `onDashboard` check used startsWith("/owner-operator"), so it fired on
 * /owner-operator/loads/:id and its modal overlay intercepted clicks on the
 * negotiation panel. This test arms the tour (suppressTour:false) and proves it
 * stays dormant on the load-detail page, leaving the panel interactive.
 */
const URL = "/owner-operator/loads/SEED-NEGO-DEMO";

test.describe("Onboarding tour scoping", () => {
  test("does not auto-start on a deep-linked load-detail route", async ({ page }) => {
    await installNegotiationMock(page, "HAULER", "SEED-NEGO-DEMO", { suppressTour: false });
    await page.goto(URL);

    // Page rendered.
    await expect(page.getByRole("button", { name: /Engage to negotiate/ })).toBeVisible();
    // Wait well past the tour's ~700ms auto-start timer.
    await page.waitForTimeout(1200);

    // No Shepherd tour surface appeared, and the panel is still clickable
    // (no overlay intercepting) - engaging works.
    await expect(page.locator(".shepherd-element")).toHaveCount(0);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await expect(page.getByText("Engaged - accept load or bid")).toBeVisible();
  });
});
