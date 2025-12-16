/**
 * Develop Page E2E Tests
 *
 * Tests the core develop page functionality:
 * 1. App creation flow - creating new apps from homepage
 * 2. Loading states - page transitions and component readiness
 * 3. Chat functionality - input, send via click/Enter, toolbar
 * 4. Preview pane - iframe, view modes, controls
 * 5. Header state - navigation, publish button, user menu
 *
 * Strategy:
 * - Uses existing apps for most tests (faster, no cleanup needed)
 * - Only creates new apps when testing creation flow
 */

const SHARED_APP_KEY = 'sharedAppId_developPage';

function getSharedAppId(): Cypress.Chainable<string> {
  const existingId = Cypress.env(SHARED_APP_KEY) as string | undefined;
  if (existingId) {
    return cy.wrap(existingId);
  }

  return cy.getExistingAppId().then((id: string) => {
    Cypress.env(SHARED_APP_KEY, id);
    return cy.wrap(id);
  });
}

describe('Develop Page', () => {

  describe('App Creation Flow', () => {
    it('should create a new app from homepage and redirect to develop page', () => {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

      cy.visit('/');

      cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
        .should('be.visible')
        .should('not.be.disabled')
        .type('A simple page that displays hello world');

      cy.get('[data-eid*="homepage.prompt.submit"]')
        .should('not.be.disabled')
        .click();

      // Wait for API to complete - this is the critical path
      cy.wait('@quickCreate', { timeout: 60000 }).its('response.statusCode').should('be.oneOf', [200, 201]);

      // Verify redirect to develop page
      cy.url({ timeout: 60000 }).should('match', /\/develop\//);

      // Wait for core develop page elements (these load quickly)
      cy.get('[data-eid*="chat_toolbar.chat"]', { timeout: 30000 }).should('exist');
      cy.get('[data-eid*="chat_toolbar.history"]').should('exist');

      // Publish button should appear
      cy.contains('button', 'Publish', { timeout: 60000 }).should('be.visible').should('not.be.disabled');

      // Chat input should eventually be ready (may take time if AI is processing)
      cy.get('#chat-input-textarea', { timeout: 120000 }).should('exist');
    });

    it('should validate prompt input before allowing submit', () => {
      cy.visit('/');

      cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
        .should('be.visible');

      // Clear and confirm empty before checking button state
      cy.get('textarea[placeholder*="Describe your app idea"]')
        .clear()
        .should('have.value', '');

      // Now button should be disabled (retries automatically)
      cy.get('[data-eid*="homepage.prompt.submit"]').should('be.disabled');

      // Type long prompt and verify it was typed before checking button
      const longPrompt = 'a'.repeat(5001);
      cy.get('textarea[placeholder*="Describe your app idea"]')
        .type(longPrompt, { delay: 0 })
        .should('have.value', longPrompt);

      cy.get('[data-eid*="homepage.prompt.submit"]').should('be.disabled');
    });

    it('should populate prompt when clicking suggested example buttons', () => {
      cy.visit('/');

      cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
        .should('be.visible');

      // Click first suggested example button and verify it populates prompt
      cy.get('button.bg-ai-dark-transparent')
        .should('have.length.at.least', 1)
        .first()
        .click();

      cy.get('textarea[placeholder*="Describe your app idea"]')
        .should('not.have.value', '');

      cy.get('[data-eid*="homepage.prompt.submit"]')
        .should('not.be.disabled');
    });
  });

  describe('Loading States', () => {
    it('should load develop page with all components ready', () => {
      getSharedAppId().then((id) => cy.openDevelop(id));

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

  describe('Chat Pane', () => {
    beforeEach(function setupChatTests() {
      getSharedAppId().then((id) => cy.openDevelop(id));
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
      getSharedAppId().then((id) => cy.openDevelop(id));
      cy.waitForDevelopPage();
    });

    it('should send message via click button and show in chat', () => {
      // Wait for any previous AI processing to complete
      cy.waitForChatInput();
      cy.wait(2000); // Extra stabilization time

      const testMessage = 'Add a header section to the page';

      // Re-verify chat input is ready before typing
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
  });

  describe('Preview Pane', () => {
    beforeEach(function setupPreviewTests() {
      getSharedAppId().then((id) => cy.openDevelop(id));
      cy.waitForDevelopPage();
    });

    it('should display preview iframe and allow using all controls', () => {
      cy.get('#preview-iframe', { timeout: 180000 })
        .should('be.visible')
        .should('have.attr', 'src');

      cy.get('[data-eid*="preview.refresh"]', { timeout: 30000 }).should('exist');
      cy.get('[data-eid*="preview.preview_desktop"]').should('exist');
      cy.get('[data-eid*="preview.preview_mobile"]').should('exist');

      cy.get('[data-eid*="preview.refresh"]').click();
      cy.get('#preview-iframe').should('be.visible');

      cy.get('[data-eid*="preview.preview_mobile"]').click();
      cy.get('#preview-iframe').should('be.visible');

      cy.get('[data-eid*="preview.preview_desktop"]').click();
      cy.get('#preview-iframe').should('be.visible');
    });
  });

  describe('Header State', () => {
    beforeEach(function setupHeaderTests() {
      getSharedAppId().then((id) => cy.openDevelop(id));
      cy.waitForDevelopPage();
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

  describe('Error Recovery', () => {
    it('should handle page refresh gracefully and maintain URL', () => {
      getSharedAppId().then((id) => cy.openDevelop(id));
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
