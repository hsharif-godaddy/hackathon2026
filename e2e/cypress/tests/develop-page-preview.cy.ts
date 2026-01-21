/**
 * Develop Page - Preview Pane E2E Tests
 *
 * Tests the preview pane functionality:
 * - Preview iframe display
 * - Refresh control
 * - Device selector (desktop/mobile view switching)
 *
 * Strategy:
 * - Creates an isolated app per spec file (cleaned up before each run)
 * - Independent of other develop-page test files
 */

import { getSpecPrefix } from '../support/utils/helpers';

const SPEC_PREFIX = getSpecPrefix();

describe('Develop Page - Preview', () => {
  let appId: string;

  before(function createIsolatedApp() {
    cy.setupIsolatedApp(SPEC_PREFIX, 'Add a single page app that displays hello world').then((id) => {
      appId = id;
    });
  });

  describe('Preview Pane', () => {
    beforeEach(function setupPreviewTests() {
      cy.openDevelop(appId);
      cy.waitForDevelopPage();
    });

    it('should display preview iframe and allow using all controls', () => {
      cy.get('#preview-iframe', { timeout: 180000 })
        .should('be.visible')
        .should('have.attr', 'src');

      // Verify refresh button and device selector exist
      cy.get('[data-eid*="preview.refresh"]', { timeout: 30000 }).should('exist');
      cy.get('[data-eid*="preview.device_selector"]').should('exist');

      // Test refresh button
      cy.get('[data-eid*="preview.refresh"]').click();
      cy.get('#preview-iframe').should('be.visible');

      // Test device selector - switch to mobile view
      cy.get('[data-eid*="preview.device_selector"]').click();
      cy.get('[data-radix-popper-content-wrapper]')
        .find('[data-eid*="preview.device_select_iphone-se"]')
        .click();
      cy.get('#preview-iframe').should('be.visible');

      // Test device selector - switch back to desktop view
      cy.get('[data-eid*="preview.device_selector"]').click();
      cy.get('[data-radix-popper-content-wrapper]')
        .find('[data-eid*="preview.device_select_full"]')
        .click();
      cy.get('#preview-iframe').should('be.visible');
    });
  });
});

export {};

