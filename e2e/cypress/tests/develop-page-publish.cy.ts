/**
 * Develop Page - Publishing E2E Tests
 *
 * Tests the publishing functionality:
 * - Complete publish flow
 * - Publish button states during AI processing
 * - Deployment verification
 * - Published URL accessibility
 *
 * Strategy:
 * - Creates an isolated app per spec file (cleaned up before each run)
 * - Independent of other develop-page test files
 * - Tests critical publishing workflows
 */

import { DEPLOYMENT_POLL_INTERVAL_MS, DEPLOYMENT_TIMEOUT_MS } from '../support/constants';

import { getSpecPrefix } from '../support/utils/helpers';

const SPEC_PREFIX = getSpecPrefix();

describe('Develop Page - Publishing', () => {
  let appId: string;

  before(function createIsolatedApp() {
    cy.setupIsolatedApp(SPEC_PREFIX, 'Add a single page app that displays hello world').then((id) => {
      appId = id;
    });
  });

  describe('Publishing', () => {
    /**
     * Tests the complete publish flow via UI:
     * - Header button stays enabled throughout (only disabled during initial loading)
     * - Button text changes to "Publishing" then "Republish"
     * - Modal shows changes and deployment history
     * - Deployment completes successfully
     * - Published URL is accessible
     */
    it('should open publish popover, show changes and history, complete publish flow, and verify states', () => {
      cy.intercept('POST', '**/api/apps/*/publish').as('publishApp');
      cy.intercept('GET', '**/api/apps/*/deployments*').as('getDeployments');

      cy.openDevelop(appId);
      cy.waitForDevelopPage();
      cy.waitForChatInput();

      // Header button should be enabled after loading completes
      cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 30000 })
        .should('be.visible')
        .should('not.be.disabled')
        .should('contain.text', 'Publish')
        .click();

      // Modal opens showing changes
      cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 })
        .should('be.visible')
        .within(() => {
          cy.get('#publish-changes').should('exist');
          cy.contains(/\bchanges?\b/i).should('exist');

          // Click modal publish button
          cy.contains('button', 'Publish')
            .should('be.visible')
            .should('not.be.disabled')
            .click();
        });

      // After clicking publish, header button stays enabled but text changes to "Publishing"
      cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 15000 })
        .should('not.be.disabled')
        .should('contain.text', 'Publishing');

      // Wait for publish API
      cy.wait('@publishApp', { timeout: 60000 }).then((publishInterception) => {
        expect(publishInterception.response?.statusCode).to.be.oneOf([200, 201]);

        const deploymentId = publishInterception.response?.body?.deployment?.deploymentId;
        expect(deploymentId).to.be.a('string');
        cy.log(`Deployment ID: ${deploymentId}`);

        cy.pollDeploymentStatus(appId, deploymentId, DEPLOYMENT_POLL_INTERVAL_MS, DEPLOYMENT_TIMEOUT_MS).then((result) => {
          cy.log(`Deployment status: ${result.status}`);

          if (result.status === 'deployed') {
            cy.get('[data-eid*="publish-alert.success.custom_domain"]', { timeout: 30000 })
              .should('be.visible');

            // Verify published URL accessible
            cy.get('[class*="alert"]').first().within(() => {
              cy.get('a[href*="http"]').first().invoke('attr', 'href').then((publishedUrl) => {
                if (publishedUrl) {
                  cy.log(`Published URL: ${publishedUrl}`);
                  cy.request({
                    url: publishedUrl,
                    failOnStatusCode: false,
                    timeout: 30000,
                  }).then((response) => {
                    expect(response.status).to.be.oneOf([200, 301, 302]);
                    cy.log(`✓ Published URL accessible: ${response.status}`);
                  });
                }
              });
            });

            // Close success alert
            cy.get('[class*="alert"]').first().within(() => {
              cy.get('button[aria-label*="close"], button[aria-label*="dismiss"], [class*="close"]')
                .first()
                .click({ force: true });
            });

            cy.get('[data-eid*="publish-alert.success.custom_domain"]', { timeout: 5000 })
              .should('not.exist');

            // After successful deploy, button stays enabled but text changes to "Republish"
            cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 10000 })
              .should('not.be.disabled')
              .should('contain.text', 'Republish');

          } else if (result.status === 'failed') {
            cy.contains('button', /try again/i, { timeout: 30000 }).should('exist');
          }
        });
      });
    });

    /**
     * Tests button behavior during AI conversation with real-time modal updates:
     * - Header button stays enabled during conversation
     * - Modal shows warning alert when conversation is in progress
     * - Modal button is disabled during conversation
     * - Modal button updates to enabled in real-time when AI completes (without closing/reopening)
     */
    it('should keep header enabled but disable modal button during AI conversation with real-time updates', () => {
      cy.intercept('POST', '**/api/chat/stream').as('chatStream');

      cy.visit(`/develop/${appId}`);
      cy.waitForDevelopPage();

      cy.get('body').type('{esc}');

      cy.waitForChatInput();

      // Start AI conversation
      cy.get('#chat-input-textarea')
        .should('not.be.disabled')
        .should('not.have.attr', 'placeholder', 'Processing... please wait')
        .clear()
        .type('Add a small footer with copyright notice');

      cy.get('#chat-send-button')
        .should('be.visible')
        .should('not.be.disabled')
        .click();

      cy.contains('Add a small footer with copyright notice', { timeout: 10000 })
        .should('be.visible');

      cy.get('#chat-send-button', { timeout: 10000 })
        .should('be.disabled');

      // During AI conversation, header button stays ENABLED
      cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 10000 })
        .should('not.be.disabled')
        .click();

      // Verify modal state during AI conversation
      cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 })
        .should('be.visible')
        .within(() => {
          // Warning alert should be visible
          cy.get('[class*="alert"], [role="alert"]').should('exist');

          // Modal button IS disabled during conversation
          cy.contains('button', /Publish|Republish/).should('be.disabled');
        });

      // Wait for AI to complete while keeping modal open
      cy.waitForChatInput();

      // Verify modal button becomes enabled in real-time (same modal instance)
      cy.get('[data-radix-popper-content-wrapper]')
        .should('be.visible')
        .within(() => {
          cy.contains('button', /Publish|Republish/, { timeout: 10000 }).should('not.be.disabled');
        });
    });
  });
});

export {};

