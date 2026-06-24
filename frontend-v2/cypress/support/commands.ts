/// <reference types="cypress" />
/// <reference types="cypress-axe" />

// Custom commands for the LoadLead E2E UI suite.
//
// loginAs(persona) authenticates via the REST API and seeds the JWT into
// localStorage (mirroring what the AuthContext does on real login).
// Wrapped in cy.session() so subsequent tests reuse the session and skip
// the login round-trip.
//
// The persona map mirrors tests/load/seed-direct.mjs cast so the API and
// UI suites can target the same accounts.

type Persona =
  | 'shipper1' | 'shipper2'
  | 'carrier1' | 'carrier2'
  | 'oo1' | 'oo2'
  | 'driver1' | 'driver2' | 'driver3' | 'driver5' | 'driver6' | 'driver7'
  | 'receiver1' | 'receiver2';

const PERSONA_EMAIL: Record<Persona, string> = {
  shipper1:  'shipper.k6.s1@loadleadapp.com',
  shipper2:  'shipper.k6.s2@loadleadapp.com',
  carrier1:  'carrier.k6.c1@loadleadapp.com',
  carrier2:  'carrier.k6.c2@loadleadapp.com',
  oo1:       'oo.k6.o1@loadleadapp.com',
  oo2:       'oo.k6.o2@loadleadapp.com',
  driver1:   'driver.k6.d1@loadleadapp.com',
  driver2:   'driver.k6.d2@loadleadapp.com',
  driver3:   'driver.k6.d3@loadleadapp.com',
  driver5:   'driver.k6.d5@loadleadapp.com',
  driver6:   'driver.k6.d6@loadleadapp.com',
  driver7:   'driver.k6.d7@loadleadapp.com',
  receiver1: 'receiver.k6.r1@loadleadapp.com',
  receiver2: 'receiver.k6.r2@loadleadapp.com',
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      loginAs(persona: Persona): Chainable<void>;
      apiLogin(email: string): Chainable<string>;
      dataCy(selector: string): Chainable<JQuery<HTMLElement>>;
      dataTour(selector: string): Chainable<JQuery<HTMLElement>>;
    }
  }
}

Cypress.Commands.add('apiLogin', (email: string) => {
  const apiUrl = Cypress.env('API_URL');
  const password = Cypress.env('TEST_PASSWORD');
  return cy.request({
    method: 'POST',
    url: `${apiUrl}/api/auth/login`,
    body: { email, password },
    failOnStatusCode: false,
  }).then((res) => {
    expect(res.status, `login ${email}`).to.eq(200);
    const token = res.body.token as string;
    expect(token, 'login returned a token').to.be.a('string').and.not.empty;
    return token;
  });
});

Cypress.Commands.add('loginAs', (persona: Persona) => {
  const email = PERSONA_EMAIL[persona];
  const password = Cypress.env('TEST_PASSWORD');
  cy.session(
    persona,
    () => {
      // Auth is httpOnly cookie-based, so we do a real UI login through
      // /login. cy.session() caches the resulting cookie jar so the round
      // trip happens once per persona across the whole suite.
      cy.visit('/login');
      cy.get('#email').clear().type(email);
      cy.get('#pwd').clear().type(password, { log: false });
      cy.get('button[type="submit"]').contains(/sign in|log in/i).click();
      // Wait for the post-login navigation. Routes vary by role, so we
      // just assert we're no longer on /login (and not stuck on an error).
      cy.url({ timeout: 15000 }).should('not.include', '/login');
    },
    {
      validate() {
        cy.request({
          method: 'GET',
          url: `${Cypress.env('API_URL')}/api/auth/me`,
          failOnStatusCode: false,
        }).its('status').should('eq', 200);
      },
      cacheAcrossSpecs: true,
    },
  );
});

// Stable selector helpers — prefer data-cy (test-only) when present,
// fall back to data-tour (which already exists across many screens).
Cypress.Commands.add('dataCy', (sel: string) => cy.get(`[data-cy="${sel}"]`));
Cypress.Commands.add('dataTour', (sel: string) => cy.get(`[data-tour="${sel}"]`));

export {};
