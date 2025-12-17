/**
 * Develop Page - Loading States and Error Recovery E2E Tests
 *
 * Tests page loading behavior:
 * - Initial page load with all components ready
 * - Page refresh gracefully handling
 * - State persistence after reload
 *
 * Strategy:
 * - Uses a shared app for all tests in this file
 * - Independent of other develop-page test files
 */

const SPEC_PREFIX = '[e2e:develop-loading]';
const SHARED_APP_KEY = 'sharedAppId_developLoading';

describe('Develop Page - Loading', () => {

  describe('Loading States', () => {
    it('should load develop page with all components ready', () => {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

      cy.getOrCreateSharedApp(SHARED_APP_KEY, SPEC_PREFIX, 'Test app for loading').then((id) => cy.openDevelop(id));

      cy.get('header').first().should('be.visible');
      cy.get('header [data-eid*="header.airo_ai_link"]').first().should('exist');
      cy.get('header').contains('beta', { matchCase: false }).should('be.visible');

      cy.contains('button', 'Publish', { timeout: 60000 })
        .should('be.visible')
        .should('not.be.disabled');

      cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 120000 })
        .should('be.visible')
        .should('not.be.disabled');

      cy.get('#preview-iframe', { timeout: 180000 })
        .should('be.visible')
        .should('have.attr', 'src')
        .and('not.be.empty');
    });
  });

  describe('Error Recovery', () => {
    it('should handle page refresh gracefully and maintain URL', () => {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

      cy.getOrCreateSharedApp(SHARED_APP_KEY, SPEC_PREFIX, 'Test app for loading').then((id) => {
        cy.openDevelop(id);
        cy.waitForDevelopPage();

        cy.reload();

        cy.url().should('include', '/develop/');

        cy.get('header').should('be.visible');
        cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 120000 })
          .should('be.visible')
          .should('not.be.disabled');
        cy.get('#preview-iframe', { timeout: 180000 }).should('be.visible');
      });
    });
  });
});

export {};

