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
 * - Creates an isolated app per spec file (cleaned up before each run)
 * - Independent of other develop-page test files
 */

import { getSpecPrefix } from '../support/utils/helpers';

const SPEC_PREFIX = getSpecPrefix();

describe('Develop Page - Header', () => {
  let appId: string;

  before(function createIsolatedApp() {
    cy.setupIsolatedApp(SPEC_PREFIX, 'Add a single page app that displays hello world').then((id) => {
      appId = id;
    });
  });

  describe('Header State', () => {
    beforeEach(function setupHeaderTests() {
      cy.openDevelop(appId);
      cy.waitForDevelopPage();
    });

    it('should display header with logo, beta tag, publish button, and user menu', () => {
      cy.get('header', { timeout: 30000 }).should('be.visible');

      cy.get('header a[href="/"]')
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
      cy.get('header a[href="/"]')
        .first()
        .click();

      cy.url({ timeout: 15000 }).should('match', /\/$/);
      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');
    });

    it('should maintain header visibility throughout interactions', () => {
      cy.get('header').first().should('be.visible');

      // Switch to mobile view via device selector
      cy.get('[data-testid="preview-device-selector-trigger"]').click();
      cy.get('[data-radix-popper-content-wrapper]')
        .contains('iPhone SE')
        .click();
      cy.get('header').first().should('be.visible');

      // Switch back to desktop view
      cy.get('[data-testid="preview-device-selector-trigger"]').click();
      cy.get('[data-radix-popper-content-wrapper]')
        .contains('Full size')
        .click();
      cy.get('header').first().should('be.visible');

      cy.get('button[aria-label*="builder_chat_toolbar_button_history"]').click({ force: true });
      cy.get('header').first().should('be.visible');

      cy.get('button[aria-label*="builder_chat_toolbar_button_chat"]').click({ force: true });
      cy.get('header').first().should('be.visible');
    });
  });
});

export {};

