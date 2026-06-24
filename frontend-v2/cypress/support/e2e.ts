// Cypress E2E support entry — loaded before every spec.
import './commands';
import 'cypress-axe';

// Surface unexpected app errors instead of silently failing the test.
// (Cypress default re-throws these, which is what we want for honest
// findings — fabricated-data audit needs real signal.)
Cypress.on('uncaught:exception', (err) => {
  // ResizeObserver loop warnings are noisy; ignore those only.
  if (/ResizeObserver loop/.test(err.message)) return false;
  return true;
});
