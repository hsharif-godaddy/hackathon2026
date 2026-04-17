/**
 * Develop Page - Loading States and Error Recovery E2E Tests
 *
 * Tests page loading behavior:
 * - Initial page load with all components ready
 * - Page refresh gracefully handling
 * - State persistence after reload
 *
 * Strategy:
 * - Creates an isolated app per spec file (cleaned up before each run)
 * - Independent of other develop-page test files
 */

import { getSpecPrefix } from '../support/utils/helpers';

const SPEC_PREFIX = getSpecPrefix();

describe('Develop Page - Loading', () => {
  let appId: string;

  before(function createIsolatedApp() {
    cy.setupIsolatedApp(SPEC_PREFIX, 'Single page app that displays hello world').then((id) => {
      appId = id;
    });
  });

  describe('Loading States', () => {
    it('should load develop page with all components ready', () => {
      cy.openDevelop(appId);

      cy.get('header').first().should('be.visible');
      cy.get('header a[href="/"]').first().should('exist');
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
      cy.openDevelop(appId);
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

export {};

