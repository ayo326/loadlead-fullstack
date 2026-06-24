import { defineConfig } from 'cypress';

// Prod guard: hard-abort if baseUrl resolves to production. The k6 harness
// has the same guard; this is the browser-side equivalent. Set
// CYPRESS_BASE_URL env to override default.
const baseUrl = process.env.CYPRESS_BASE_URL ?? 'http://localhost:3002';
if (/loadleadapp\.com/.test(baseUrl) && !process.env.I_REALLY_MEAN_PROD) {
  throw new Error(`PROD GUARD: refusing to point Cypress at ${baseUrl}. Use staging or local.`);
}

export default defineConfig({
  e2e: {
    baseUrl,
    specPattern: 'cypress/e2e/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    video: false,                    // enable in CI with --record
    screenshotOnRunFailure: true,
    viewportWidth: 1366,
    viewportHeight: 800,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    retries: { runMode: 1, openMode: 0 },
    env: {
      API_URL: process.env.CYPRESS_API_URL ?? 'http://localhost:4000',
      TEST_PASSWORD: 'TestPassword123!',
    },
    setupNodeEvents(on, config) {
      on('task', {
        // Console-relay task so cy.task('log', ...) prints to terminal,
        // useful for debugging headless runs.
        log(message) { console.log(message); return null; },
      });
      return config;
    },
  },
});
