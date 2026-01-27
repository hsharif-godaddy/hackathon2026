/**
 * Core Navigation Smoke Tests
 *
 * Foundational E2E tests that verify the core user journey:
 * 1. Homepage loads (authentication successful)
 * 2. Can navigate to an app's develop page
 * 3. Key components render and are interactive
 *
 * User is already authenticated via e2e.ts before hook.
 */
const SPEC_PREFIX = '[e2e:core-navigation]';

describe('Core Navigation', () => {
  it('should navigate from homepage to develop page and verify core functionality', () => {
    cy.intercept('GET', '**/api/sites').as('getSites');

    cy.visit('/');
    cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
      .should('be.visible');

    cy.wait('@getSites');

    // Dropdown auto-expands on homepage once sites are loaded
    cy.get('[data-eid="appbuilder.homepage.apps_menu.app.click"]', { timeout: 30000 })
      .first()
      .should('be.visible')
      .click();

    cy.url({ timeout: 15000 }).should('match', /\/develop\/|\/[a-f0-9-]+\/develop/);

    cy.get('header').should('be.visible');

    cy.contains('button', 'Publish', { timeout: 30000 })
      .should('be.visible')
      .and('not.be.disabled');

    cy.get('#preview-iframe', { timeout: 180000 })
      .should('exist')
      .and('have.attr', 'src');

    cy.get('#chat-input-textarea', { timeout: 60000 })
      .should('exist');
  });

  it('should navigate to app via /apps page and verify develop page loads', () => {
    cy.intercept('GET', '**/api/sites').as('getSites');

    cy.visit('/');
    cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
      .should('be.visible');

    cy.wait('@getSites');

    cy.get('[data-eid="appbuilder.homepage.apps_menu.see_all.click"]')
      .should('be.visible')
      .click();

    cy.url({ timeout: 15000 }).should('include', '/apps');
    cy.contains('Create a new app').should('be.visible');
    cy.get('[data-eid="appbuilder.apps.app.edit.click"]').should('have.length.at.least', 1);

    cy.get('[data-eid="appbuilder.apps.app.edit.click"]').first().click();

    cy.url({ timeout: 15000 }).should('include', '/develop/');

    cy.get('header').should('be.visible');
    cy.contains('button', 'Publish', { timeout: 30000 })
      .should('be.visible');

    cy.get('#preview-iframe', { timeout: 120000 }).should('be.visible');

    cy.get('textarea[placeholder*="Ask Airo"]')
      .should('be.visible')
      .and('not.be.disabled');
  });
});
