// Smoke spec: proves Cypress + the FE dev server + the persona login
// chain all wire up correctly. Run this first when bringing the suite
// up on a new machine. Other specs depend on these basics holding.

describe('Cypress + LoadLead bring-up smoke', () => {
  it('loads the landing page', () => {
    cy.visit('/');
    cy.get('body').should('be.visible');
  });

  it('logs in via API as shipper1 and persists the token', () => {
    cy.apiLogin('shipper.k6.s1@loadleadapp.com').then((token) => {
      expect(token).to.match(/^eyJ/); // JWT
    });
  });

  it('logs in via UI session helper for each persona', () => {
    (['shipper1', 'driver1', 'receiver1', 'oo1', 'carrier1'] as const).forEach((p) => {
      cy.loginAs(p);
    });
  });
});
