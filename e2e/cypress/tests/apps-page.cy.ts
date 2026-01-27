/**
 * Apps Page E2E Tests
 *
 * Tests the /apps page functionality:
 * 1. Page content - header, app count, cards
 * 2. App card actions - Edit, Preview, Delete
 * 3. Navigation - Create new app, Edit to develop page
 * 4. Status display - Running, Stopped, Creating tags
 *
 * Strategy:
 * - Uses spec prefix for parallel-safe app creation
 * - Apps created by this spec are cleaned up automatically
 */

/** Prefix used to identify apps created by this spec file */
const SPEC_PREFIX = '[e2e:apps-page]';

let appId: string;

/**
 * Navigate to /apps and wait for page to be ready by checking DOM elements.
 * More reliable than waiting for XHR requests which can race with intercept setup.
 */
function visitAppsPage(): void {
  cy.visit('/apps');
  cy.get('[data-eid*="apps.app.edit"]', { timeout: 30000 }).should('exist');
}

describe('Apps Page', () => {
  before(function createIsolatedApp() {
    cy.setupIsolatedApp(SPEC_PREFIX, 'Single page app that displays hello world').then((id) => {
      appId = id;
    });
  });
  it('should display page content and status tags', () => {
    visitAppsPage();

    cy.contains('Manage your AI-powered websites and applications')
      .should('be.visible');

    cy.get('body').should(($body) => {
      expect($body.text()).to.match(/\d+ apps? total/);
    });

    cy.contains('Create a new app').should('be.visible').should('not.be.disabled');

    cy.get('[data-eid*="apps.app.edit"]', { timeout: 30000 })
      .should('have.length.at.least', 1);

    cy.get('body').should(($body) => {
      expect($body.text()).to.match(/Running|Stopped|Creating/);
    });
  });

  it('should delete an app via confirmation dialog', () => {
    cy.createAppAndGetId(`${SPEC_PREFIX} Single Page with Hello World as the title`);

    // Navigate to apps page and wait for content to load
    visitAppsPage();

    cy.get('[data-eid*="apps.app.delete"]', { timeout: 30000 }).then(($deleteButtons) => {
      const countBefore = $deleteButtons.length;
      cy.log(`Apps before delete: ${countBefore}`);

      cy.wrap($deleteButtons.first()).click();

      cy.contains('Are you sure you want to delete').should('be.visible');
      cy.contains('button', 'Delete').should('be.visible');

      cy.intercept('DELETE', '**/api/sites/*').as('deleteApp');
      cy.contains('button', 'Delete').click();
      cy.wait('@deleteApp', { timeout: 30000 });

      cy.contains('Are you sure you want to delete').should('not.exist');
      cy.get('[data-eid*="apps.app.delete"]', { timeout: 30000 })
        .should('have.length', countBefore - 1);

      cy.log(`✓ App deleted - now ${countBefore - 1} apps remain`);
    });
  });

  it('should show Preview button for running apps and open preview in new tab', () => {
    visitAppsPage();

    cy.get('[data-eid*="apps.app.view"]', { timeout: 30000 }).then(($previewButtons) => {
      if ($previewButtons.length > 0) {
        cy.wrap($previewButtons.first())
          .should('be.visible')
          .should('have.attr', 'href')
          .and('not.be.empty');

        cy.wrap($previewButtons.first())
          .should('have.attr', 'target', '_blank');

        cy.log('✓ Preview button found and configured correctly');
      } else {
        cy.log('⚠ No apps with Preview button found (requires running app with preview_url)');
      }
    });
  });

  it('should navigate to homepage when clicking Create a new app', () => {
    visitAppsPage();

    cy.contains('Create a new app').click();

    cy.url({ timeout: 15000 }).should('match', /\/$/);
    cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
      .should('be.visible');
  });

  it('should navigate to develop page when clicking Edit on an app card', () => {
    visitAppsPage();

    cy.get('[data-eid*="apps.app.edit"]', { timeout: 30000 })
      .first()
      .click();

    cy.url({ timeout: 15000 }).should('include', '/develop/');
    cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 120000 })
      .should('be.visible');
  });
});

export {};
