/**
 * Apps Page E2E Tests
 *
 * Tests the /apps page functionality:
 * 1. Page content - header, app count, cards
 * 2. App card actions - Edit, Preview, Delete
 * 3. Navigation - Create new app, Edit to develop page
 * 4. Status display - Running, Stopped, Creating tags
 */

describe('Apps Page', () => {
  beforeEach(function setupAppsPage() {
    cy.intercept('GET', '**/api/sites').as('getSites');
    cy.visit('/apps');
    cy.wait('@getSites');
  });

  it('should display page content and status tags', () => {
    cy.contains('Manage your AI-powered websites and applications')
      .should('be.visible');

    // Match "1 app total" or "N apps total"
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
    cy.createAppAndGetId('Single Page with Hello World as the title');

    // Go back to apps page with fresh intercept
    cy.intercept('GET', '**/api/sites').as('getSitesRefresh');
    cy.visit('/apps');
    cy.wait('@getSitesRefresh');

    // Count apps before delete
    cy.get('[data-eid*="apps.app.delete"]', { timeout: 30000 }).then(($deleteButtons) => {
      const countBefore = $deleteButtons.length;
      cy.log(`Apps before delete: ${countBefore}`);

      // Click delete on the first app
      cy.wrap($deleteButtons.first()).click();

      // Verify confirmation dialog appears
      cy.contains('Are you sure you want to delete').should('be.visible');
      cy.contains('button', 'Delete').should('be.visible');

      // Actually delete the app
      cy.intercept('DELETE', '**/api/sites/*').as('deleteApp');
      cy.contains('button', 'Delete').click();
      cy.wait('@deleteApp', { timeout: 30000 });

      // Verify dialog closes and app count decreased
      cy.contains('Are you sure you want to delete').should('not.exist');
      cy.get('[data-eid*="apps.app.delete"]', { timeout: 30000 })
        .should('have.length', countBefore - 1);

      cy.log(`✓ App deleted - now ${countBefore - 1} apps remain`);
    });
  });

  it('should show Preview button for running apps and open preview in new tab', () => {
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
    cy.contains('Create a new app').click();

    cy.url({ timeout: 15000 }).should('match', /\/$/);
    cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
      .should('be.visible');
  });

  it('should navigate to develop page when clicking Edit on an app card', () => {
    cy.get('[data-eid*="apps.app.edit"]', { timeout: 30000 })
      .first()
      .click();

    cy.url({ timeout: 15000 }).should('include', '/develop/');
    cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 120000 })
      .should('be.visible');
  });
});

export {};
