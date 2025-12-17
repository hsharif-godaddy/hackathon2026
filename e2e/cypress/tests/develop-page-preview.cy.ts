/**
 * Develop Page - Preview Pane E2E Tests
 *
 * Tests the preview pane functionality:
 * - Preview iframe display
 * - Refresh control
 * - Desktop/Mobile view switching
 *
 * Strategy:
 * - Uses a shared app for all tests in this file
 * - Independent of other develop-page test files
 */

const SPEC_PREFIX = '[e2e:develop-preview]';
const SHARED_APP_KEY = 'sharedAppId_developPreview';

describe('Develop Page - Preview', () => {

  describe('Preview Pane', () => {
    beforeEach(function setupPreviewTests() {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

      cy.getOrCreateSharedApp(SHARED_APP_KEY, SPEC_PREFIX, 'Test app for preview').then((id) => {
        cy.openDevelop(id);
        cy.waitForDevelopPage();
      });
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
});

export {};

