import { test, expect } from "@playwright/test";
import { installNegotiationMock } from "./support/negotiationMock";

/**
 * SHIPPER-side negotiation E2E, driven through the REAL Shipper Load Detail
 * page (/shipper/loads/:loadId) and the REAL NegotiationPanel (party=SHIPPER).
 * The shipper only sees the panel once a hauler has bid, so most specs preset a
 * bid (models "the shipper opens a load that already has an offer"); S5 proves
 * the bid arriving live through the long-poll while the shipper watches.
 */
const LOAD = "SEED-NEGO-DEMO";
const URL = `/shipper/loads/${LOAD}`;

test.describe("Negotiation — SHIPPER", () => {
  test("S1 sees the hauler's bid with accept / counter / reject", async ({ page }) => {
    const nm = await installNegotiationMock(page, "SHIPPER");
    nm.haulerBid(275); // a hauler has already bid $2.75/mi
    await page.goto(URL);
    await expect(page.getByText("Negotiation")).toBeVisible();
    await expect(page.getByText("$2.75/mi")).toBeVisible();
    await expect(page.getByText(/\(hauler\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept bid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Counter offer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject bid" })).toBeVisible();
  });

  test("S2 accept bid → load assigned at the hauler's rate", async ({ page }) => {
    const nm = await installNegotiationMock(page, "SHIPPER");
    nm.haulerBid(275);
    await page.goto(URL);
    await page.getByRole("button", { name: "Accept bid" }).click();
    await expect(page.getByText(/Assigned at \$2\.75\/mi/)).toBeVisible();
  });

  test("S3 counter the hauler → pending on the hauler", async ({ page }) => {
    const nm = await installNegotiationMock(page, "SHIPPER");
    nm.haulerBid(275);
    await page.goto(URL);
    await page.getByRole("button", { name: "Counter offer" }).click();
    await page.locator("#neg-rate").fill("2.65");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Waiting on the hauler/)).toBeVisible();
    await expect(page.getByText("$2.65/mi")).toBeVisible();
  });

  test("S4 reject the bid → load rebroadcasts", async ({ page }) => {
    const nm = await installNegotiationMock(page, "SHIPPER");
    nm.haulerBid(275);
    await page.goto(URL);
    await page.getByRole("button", { name: "Reject bid" }).click();
    await expect(page.getByText(/returned to the board/)).toBeVisible();
  });

  test("S5 live update: a hauler's bid appears while the shipper watches", async ({ page }) => {
    const nm = await installNegotiationMock(page, "SHIPPER");
    await page.goto(URL);
    // No offer yet → the shipper sees no negotiation panel content.
    await expect(page.getByRole("button", { name: "Accept bid" })).toHaveCount(0);
    // The hauler bids — it should arrive through the events channel.
    nm.haulerBid(280);
    await expect(page.getByRole("button", { name: "Accept bid" })).toBeVisible();
    await expect(page.getByText("$2.80/mi")).toBeVisible();
  });
});
