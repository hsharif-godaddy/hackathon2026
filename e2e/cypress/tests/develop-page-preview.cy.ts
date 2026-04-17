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
      cy.get('[data-testid="header-refresh-button"]', { timeout: 30000 }).should('exist');
      cy.get('[data-testid="preview-device-selector-trigger"]').should('exist');

      // Test refresh button
      cy.get('[data-testid="header-refresh-button"]').click();
      cy.get('#preview-iframe').should('be.visible');

      // Test device selector - switch to mobile view
      cy.get('[data-testid="preview-device-selector-trigger"]').click();
      cy.get('[data-radix-popper-content-wrapper]')
        .contains('iPhone SE')
        .click();
      cy.get('#preview-iframe').should('be.visible');

      // Test device selector - switch back to desktop view
      cy.get('[data-testid="preview-device-selector-trigger"]').click();
      cy.get('[data-radix-popper-content-wrapper]')
        .contains('Full size')
        .click();
      cy.get('#preview-iframe').should('be.visible');
    });
  });
});

export {};

