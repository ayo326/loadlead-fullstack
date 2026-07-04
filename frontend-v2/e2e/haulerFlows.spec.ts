import { test, expect, type Page } from "@playwright/test";
import { installNegotiationMock } from "./support/negotiationMock";

/** The hauler's CARRIER_ACCEPT consent is folded inline: one checkbox, then
 *  every bid/accept signs (binding its rate) + submits in a single click. */
async function consent(page: Page) {
  await page.locator("[data-cy=neg-consent]").check();
}

/**
 * HAULER-side negotiation E2E, driven through the REAL Owner-Operator Load
 * Detail page (/owner-operator/loads/:loadId) and the REAL NegotiationPanel.
 * The backend is mocked at the network boundary (see support/negotiationMock).
 */
const LOAD = "SEED-NEGO-DEMO";
const URL = `/owner-operator/loads/${LOAD}`;

test.describe("Negotiation - HAULER (owner-operator)", () => {
  test("H1 engage: hauler holds the load and sees accept/bid/reject", async ({ page }) => {
    await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await expect(page.getByRole("button", { name: /Engage to negotiate/ })).toBeVisible();
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await expect(page.getByText("Engaged - accept load or bid")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("H2 accept-load: take the posted rate → assigned", async ({ page }) => {
    await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await consent(page);
    await page.getByRole("button", { name: "Accept load" }).click();
    await expect(page.getByText(/Assigned at \$2\.50\/mi/)).toBeVisible();
  });

  test("H3 bid: submit a cents-per-mile bid → pending on the shipper", async ({ page }) => {
    await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await consent(page);
    await page.getByRole("button", { name: "Bid" }).click();
    await page.locator("#neg-rate").fill("2.75");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/On the table/)).toBeVisible();
    await expect(page.getByText("$2.75/mi")).toBeVisible();
    await expect(page.getByText(/Waiting on the shipper/)).toBeVisible();
  });

  test("H4 live update: the shipper's counter lands via long-poll", async ({ page }) => {
    const nm = await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await consent(page);
    await page.getByRole("button", { name: "Bid" }).click();
    await page.locator("#neg-rate").fill("2.75");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Waiting on the shipper/)).toBeVisible();
    // Shipper counters at $2.60 - should arrive through the events channel.
    nm.shipperCounter(260);
    await expect(page.getByRole("button", { name: "Accept counter" })).toBeVisible();
    await expect(page.getByText("$2.60/mi")).toBeVisible();
  });

  test("H5 accept-counter: accept the shipper's counter → assigned at that rate", async ({ page }) => {
    const nm = await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await consent(page);
    await page.getByRole("button", { name: "Bid" }).click();
    await page.locator("#neg-rate").fill("2.75");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Waiting on the shipper/)).toBeVisible(); // bid settled
    nm.shipperCounter(260);
    await page.getByRole("button", { name: "Accept counter" }).click(); // consent persists → signs $2.60
    await expect(page.getByText(/Assigned at \$2\.60\/mi/)).toBeVisible();
  });

  test("H6 hauler counter: counter the shipper back → pending on the shipper again", async ({ page }) => {
    const nm = await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await consent(page);
    await page.getByRole("button", { name: "Bid" }).click();
    await page.locator("#neg-rate").fill("2.75");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Waiting on the shipper/)).toBeVisible(); // bid settled
    nm.shipperCounter(260);
    await page.getByRole("button", { name: "Counter offer" }).click();
    await page.locator("#neg-rate").fill("2.70");
    await page.getByRole("button", { name: "Send" }).click(); // signs binding $2.70
    await expect(page.getByText(/Waiting on the shipper/)).toBeVisible();
    await expect(page.getByText("$2.70/mi")).toBeVisible();
  });

  test("H7 reject: walk away → load rebroadcasts", async ({ page }) => {
    await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText(/returned to the board/)).toBeVisible();
  });

  test("H9 window expiry lands via long-poll and the load rebroadcasts", async ({ page }) => {
    const nm = await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();
    await expect(page.getByText("Engaged - accept load or bid")).toBeVisible();
    // The 20-minute window elapses - the sweeper expires it; the panel learns
    // through the events channel and shows the terminal state.
    nm.expire();
    await expect(page.getByText(/window expired/)).toBeVisible();
    await expect(page.getByText(/returned to the board/)).toBeVisible();
  });

  test("H8 e-sign gate: assign requires the inline consent (sign) first", async ({ page }) => {
    await installNegotiationMock(page, "HAULER");
    await page.goto(URL);
    await page.getByRole("button", { name: /Engage to negotiate/ }).click();

    // Accepting without the consent box checked is refused; nothing assigns.
    await page.getByRole("button", { name: "Accept load" }).click();
    await expect(page.getByText(/Check the box/i)).toBeVisible();
    await expect(page.getByText(/Assigned at/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept load" })).toBeVisible();

    // Consent + accept → the load assigns at the posted rate.
    await consent(page);
    await page.getByRole("button", { name: "Accept load" }).click();
    await expect(page.getByText(/Assigned at \$2\.50\/mi/)).toBeVisible();
  });
});
