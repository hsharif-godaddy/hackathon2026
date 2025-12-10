/**
 * Develop Page Smoke Tests
 *
 * Foundational E2E tests that verify the core user journey:
 * 1. Homepage loads (authentication successful)
 * 2. Can navigate to an app's develop page
 * 3. Key components render and are interactive
 *
 * User is already authenticated via e2e.ts before hook.
 */
describe('Develop Page', () => {
  it('should navigate from homepage to develop page and verify core functionality', () => {
    // Intercept APIs to wait for data to load
    cy.intercept('GET', '**/api/sites').as('getSites');

    // 1. HOMEPAGE: Verify authentication and page load
    cy.visit('/');
    cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
      .should('be.visible');

    // Wait for sites API to complete before interacting with dropdown
    cy.wait('@getSites');

    // 2. NAVIGATION: Wait for dropdown to auto-open when apps load, then select an app
    // The dropdown auto-expands on homepage once sites are loaded
    cy.get('[data-eid="appbuilder.homepage.apps_menu.app.click"]', { timeout: 30000 })
      .first()
      .should('be.visible')
      .click();

    // 3. DEVELOP PAGE: Verify URL and core components
    cy.url({ timeout: 15000 }).should('match', /\/develop\/|\/[a-f0-9-]+\/develop/);

    // Header is present
    cy.get('header').should('be.visible');

    // Publish button is present and clickable
    cy.contains('button', 'Publish', { timeout: 30000 })
      .should('be.visible')
      .and('not.be.disabled');

    // Preview iframe appears when server is ready
    cy.get('#preview-iframe', { timeout: 120000 })
      .should('be.visible')
      .and('have.attr', 'src');

    // Chat input is visible and interactive
    cy.get('textarea[placeholder*="Ask Airo"]')
      .should('be.visible');
  });

  it('should navigate to app via /apps page and verify develop page loads', () => {
    // Intercept the sites API call to wait for apps to load
    cy.intercept('GET', '**/api/sites').as('getSites');

    // 1. HOMEPAGE: Start from homepage
    cy.visit('/');
    cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
      .should('be.visible');

    // Wait for sites API to complete before interacting with dropdown
    cy.wait('@getSites');

    // 2. NAVIGATION: My Apps dropdown is open on load and click "See all"
    cy.get('[data-eid="appbuilder.homepage.apps_menu.see_all.click"]')
      .should('be.visible')
      .click();

    // Wait for apps page to load
    cy.url({ timeout: 15000 }).should('include', '/apps');
    cy.contains('Create a new app').should('be.visible');
    cy.get('[data-eid="appbuilder.apps.app.edit.click"]').should('have.length.at.least', 1);

    // 3. NAVIGATION: Click "Edit" button on an app card to go to develop page
    cy.get('[data-eid="appbuilder.apps.app.edit.click"]').first().click();

    // 3. DEVELOP PAGE: Verify loads correctly
    cy.url({ timeout: 15000 }).should('include', '/develop/');

    // Core elements present
    cy.get('header').should('be.visible');
    cy.contains('button', 'Publish', { timeout: 30000 })
      .should('be.visible');

    // Preview iframe appears when server is ready
    cy.get('#preview-iframe', { timeout: 120000 }).should('be.visible');

    cy.get('textarea[placeholder*="Ask Airo"]')
      .should('be.visible')
      .and('not.be.disabled');
  });
});
