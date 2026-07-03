import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the negotiation flows. The suite drives the REAL React bundle
 * (vite dev server, port 3001 per vite.config) with the backend contract mocked
 * at the network boundary — hermetic, and it never touches prod or its data.
 * Reports land in the overnight deliverables folder.
 */
const REPORTS = "/Users/ayodejiejidiran/loadlead-fullstack/docs/overnight-2026-07-03/e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // The negotiation panel runs a ~25s long-poll concurrently with user actions;
  // that timing jitter (not logic) can miss an 8s assertion window, so allow a
  // couple of retries — standard practice for long-poll/realtime E2E.
  retries: 2,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: `${REPORTS}/playwright-report`, open: "never" }],
    ["json", { outputFile: `${REPORTS}/results.json` }],
  ],
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // External assets (Google Maps, fonts, analytics) are irrelevant to these
    // flows; the specs block non-localhost requests so the run is hermetic.
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
