/**
 * Develop Page - Header State E2E Tests
 *
 * Tests the header functionality:
 * - Header visibility and elements
 * - Logo navigation
 * - Publish button display
 * - User menu
 * - Header persistence during interactions
 *
 * Strategy:
 * - Uses a shared app for all tests in this file
 * - Independent of other develop-page test files
 */

const SPEC_PREFIX = '[e2e:develop-header]';
const SHARED_APP_KEY = 'sharedAppId_developHeader';

describe('Develop Page - Header', () => {

  describe('Header State', () => {
    beforeEach(function setupHeaderTests() {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

      cy.getOrCreateSharedApp(SHARED_APP_KEY, SPEC_PREFIX, 'Test app for header').then((id) => {
        cy.openDevelop(id);
        cy.waitForDevelopPage();
      });
    });

    it('should display header with logo, beta tag, publish button, and user menu', () => {
      cy.get('header', { timeout: 30000 }).should('be.visible');

      cy.get('header [data-eid*="header.airo_ai_link"]')
        .should('exist')
        .should('have.attr', 'href', '/');

      cy.get('header').contains('beta', { matchCase: false }).should('be.visible');

      cy.get('header').contains('button', /Publish/i, { timeout: 30000 })
        .should('be.visible');

      cy.openUserMenu();
      cy.contains('button', 'Sign Out').should('exist');
      cy.get('body').type('{esc}');
    });

    it('should navigate back to homepage when logo is clicked', () => {
      cy.get('header [data-eid*="header.airo_ai_link"]')
        .first()
        .click();

      cy.url({ timeout: 15000 }).should('match', /\/$/);
      cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
        .should('be.visible');
    });

    it('should maintain header visibility throughout interactions', () => {
      cy.get('header').first().should('be.visible');

      cy.get('[data-eid*="preview.preview_mobile"]').click();
      cy.get('header').first().should('be.visible');

      cy.get('[data-eid*="preview.preview_desktop"]').click();
      cy.get('header').first().should('be.visible');

      cy.get('[data-eid*="chat_toolbar.history"]').click({ force: true });
      cy.get('header').first().should('be.visible');

      cy.get('[data-eid*="chat_toolbar.chat"]').click({ force: true });
      cy.get('header').first().should('be.visible');
    });
  });
});

export {};

