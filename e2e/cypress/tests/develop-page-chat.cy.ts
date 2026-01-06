/**
 * Develop Page - Chat Functionality E2E Tests
 *
 * Tests the chat pane and message sending:
 * - Chat toolbar navigation
 * - Input and send button states
 * - Sending messages via click and keyboard
 * - Multiline input handling
 *
 * Strategy:
 * - Creates an isolated app per spec file (cleaned up before each run)
 * - Independent of other develop-page test files
 */

import { AI_RESPONSE_TIMEOUT_MS } from '../support/constants';
import { getSpecPrefix } from '../support/utils/helpers';

const SPEC_PREFIX = getSpecPrefix();

describe('Develop Page - Chat', () => {
  let appId: string;

  before(function createIsolatedApp() {
    cy.setupIsolatedApp(SPEC_PREFIX, 'Hello world app').then((id) => {
      appId = id;
    });
  });

  describe('Chat Pane', () => {
    beforeEach(function setupChatTests() {
      cy.openDevelop(appId);
      cy.waitForChatInput();
    });

    it('should display toolbar and allow navigating between views', () => {
      cy.get('textarea[placeholder*="Ask Airo"]')
        .should('be.visible')
        .should('not.be.disabled');

      cy.get('[data-eid*="chat_toolbar.chat"]').should('exist');
      cy.get('[data-eid*="chat_toolbar.medias"]').should('exist');
      cy.get('[data-eid*="chat_toolbar.history"]').should('exist');
      cy.get('[data-eid*="chat_toolbar.settings"]').should('exist');

      cy.get('[data-eid*="chat_toolbar.medias"]').click({ force: true });
      cy.get('[data-eid*="chat_toolbar.medias"]').should('exist');
      cy.get('[data-eid*="chat_toolbar.chat"]').click({ force: true });
      cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 30000 }).should('be.visible');

      cy.get('[data-eid*="chat_toolbar.history"]').click({ force: true });
      cy.get('[data-eid*="chat_toolbar.history"]').should('exist');
      cy.get('[data-eid*="chat_toolbar.chat"]').click({ force: true });
      cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 30000 }).should('be.visible');

      cy.get('[data-eid*="chat_toolbar.settings"]').then(($btn) => {
        if (!$btn.prop('disabled')) {
          cy.wrap($btn).click({ force: true });
          cy.get('[data-eid*="chat_toolbar.settings"]').should('exist');
          cy.get('[data-eid*="chat_toolbar.chat"]').click({ force: true });
        }
      });
    });

    it('should handle chat input and send button state', () => {
      cy.waitForChatInput();

      cy.get('#chat-send-button').should('be.disabled');

      cy.get('#chat-input-textarea')
        .type('Add a header to the page', { force: true });

      cy.get('#chat-send-button').should('not.be.disabled');
    });
  });

  describe('Send Message', () => {
    beforeEach(function setupSendTests() {
      cy.openDevelop(appId);
      cy.waitForDevelopPage();
    });

    it('should send message via click button and show in chat', () => {
      cy.waitForChatInput();
      cy.wait(2000);

      const testMessage = 'Add a header section to the page';

      cy.get('#chat-input-textarea')
        .should('not.be.disabled')
        .should('not.have.attr', 'placeholder', 'Processing... please wait')
        .clear()
        .type(testMessage);

      cy.get('#chat-send-button')
        .should('not.be.disabled')
        .click();

      cy.contains(testMessage, { timeout: 10000 }).should('be.visible');

      cy.contains('Airo Developer is thinking', { timeout: 10000 })
        .should('be.visible');

      cy.get('#chat-send-button').should('be.disabled');
    });

    it('should send message via Enter key and show in chat', () => {
      cy.waitForChatInput();

      const testMessage = 'Add a footer with copyright';

      cy.get('#chat-input-textarea')
        .should('not.be.disabled')
        .clear()
        .type(testMessage + '{enter}', { force: true });

      cy.contains(testMessage, { timeout: 30000 }).should('be.visible');

      cy.contains('Airo Developer is thinking', { timeout: 30000 })
        .should('be.visible');
    });

    it('should handle Shift+Enter for multiline without sending', () => {
      cy.waitForChatInput();

      cy.get('#chat-input-textarea')
        .should('not.be.disabled')
        .clear()
        .type('First line{shift+enter}Second line{shift+enter}Third line', { force: true });

      cy.get('#chat-input-textarea')
        .should('contain.value', 'First line')
        .should('contain.value', 'Second line')
        .should('contain.value', 'Third line');

      cy.get('#chat-send-button').should('not.be.disabled');

      cy.contains('Airo Developer is thinking').should('not.exist');
    });

    it('should complete AI response within 5 minutes and re-enable input', () => {
      cy.waitForChatInput();

      const testMessage = 'Add a hero section with a title, description, and a button for hello world';

      cy.get('#chat-input-textarea')
        .should('not.be.disabled')
        .clear()
        .type(testMessage);

      cy.get('#chat-send-button')
        .should('not.be.disabled')
        .click();

      cy.contains(testMessage, { timeout: 10000 }).should('be.visible');

      cy.contains('Airo Developer is thinking', { timeout: 10000 })
        .should('be.visible');

      cy.contains('Airo Developer is thinking', { timeout: AI_RESPONSE_TIMEOUT_MS })
        .should('not.exist');

      cy.log('✓ AI response completed within timeout');

      cy.get('#chat-input-textarea', { timeout: 10000 })
        .should('not.be.disabled')
        .should('have.attr', 'placeholder')
        .and('match', /ask airo/i);

      cy.log('✓ Chat input ready for next message');

      cy.get('#chat-send-button').should('be.disabled');

      cy.get('#chat-input-textarea')
        .type('Thank you');
      cy.get('#chat-send-button')
        .should('not.be.disabled');
    });
  });
});

export {};

