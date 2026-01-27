/**
 * Develop Page - App Creation Flow E2E Tests
 *
 * Tests the app creation flow from the homepage:
 * - Creating new apps from homepage
 * - Validation of prompt input
 * - Suggested example buttons
 *
 * Strategy:
 * - Creates apps with a spec-specific prefix for parallel-safe execution
 * - Independent of other develop-page test files
 */

import { getSpecPrefix } from '../support/utils/helpers';

const SPEC_PREFIX = getSpecPrefix();

describe('Develop Page - Creation', () => {
  describe('App Creation Flow', () => {
    it('should create a new app from homepage and redirect to develop page', () => {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

      cy.visit('/');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible')
        .should('not.be.disabled')
        .type(`${SPEC_PREFIX} A simple page that displays hello world`);

      cy.get('[data-eid*="homepage.prompt.submit"]')
        .should('not.be.disabled')
        .click();

      cy.wait('@quickCreate', { timeout: 60000 }).its('response.statusCode').should('be.oneOf', [200, 201]);

      cy.url({ timeout: 60000 }).should('match', /\/develop\//);

      cy.get('[data-eid*="chat_toolbar.chat"]', { timeout: 30000 }).should('exist');
      cy.get('[data-eid*="chat_toolbar.history"]').should('exist');

      cy.contains('button', 'Publish', { timeout: 60000 }).should('be.visible').should('not.be.disabled');

      cy.waitForChatInput();

      // waits for up to 3 minutes for the preview iframe to be ready
      cy.get('#preview-iframe', { timeout: 180000 })
        .should('be.visible')
        .should('have.attr', 'src');
    });

    it('should validate prompt input before allowing submit', () => {
      cy.visit('/');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .as('promptInput')
        .should('be.visible');

      cy.get('@promptInput')
        .clear()
        .should('have.value', '');

      cy.get('[data-eid*="homepage.prompt.submit"]').should('be.disabled');

      const longPrompt = 'a'.repeat(40001);
      cy.get('@promptInput')
        .invoke('val', longPrompt)
        .trigger('input')
        .should('have.value', longPrompt);

      cy.get('[data-eid*="homepage.prompt.submit"]').should('be.disabled');
    });

    it('should populate prompt when clicking suggested example buttons', () => {
      cy.visit('/');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .as('promptInput')
        .should('be.visible');

      cy.get('button.bg-ai-dark-transparent')
        .should('have.length.at.least', 1)
        .first()
        .click();

      cy.get('@promptInput')
        .should('not.have.value', '');

      cy.get('[data-eid*="homepage.prompt.submit"]')
        .should('not.be.disabled');
    });
  });
});

export {};

