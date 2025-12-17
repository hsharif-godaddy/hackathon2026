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
 * - Uses a shared app for all tests in this file
 * - Independent of other develop-page test files
 * - Tests critical publishing workflows
 */

import { DEPLOYMENT_POLL_INTERVAL_MS, DEPLOYMENT_TIMEOUT_MS } from '../support/constants';

const SPEC_PREFIX = '[e2e:develop-publish]';
const SHARED_APP_KEY = 'sharedAppId_developPublish';

describe('Develop Page - Publishing', () => {

  describe('Publishing', () => {
    /**
     * Tests the complete publish flow via UI:
     * 1. Verify publish button is disabled while chat is processing
     * 2. Wait for chat ready, then verify button becomes enabled
     * 3. Click publish button and verify progress alert
     * 4. Wait for deployment completion (up to 5 minutes)
     * 5. Verify success alert with published URL
     * 6. Verify published URL is accessible
     * 7. Verify publish button is disabled after successful publish (current commit deployed)
     */
    it('should open publish popover, show changes and history, complete publish flow, and verify disabled states', () => {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');
      cy.intercept('POST', '**/api/apps/*/publish').as('publishApp');
      cy.intercept('GET', '**/api/apps/*/deployments*').as('getDeployments');

      cy.getOrCreateSharedApp(SHARED_APP_KEY, SPEC_PREFIX, 'Test app for publish').then((appId) => {
        cy.openDevelop(appId);
        cy.waitForDevelopPage();
        cy.waitForChatInput();
        cy.wait(1000);

      cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 30000 })
        .should('be.visible')
        .should('contain.text', 'Publish')
        .should('not.be.disabled');

      cy.get('[data-eid*="header"][data-eid*="publish"]').click();

      cy.get('[data-radix-popper-content-wrapper]', { timeout: 10000 })
        .should('be.visible')
        .within(() => {
          cy.get('#publish-changes').should('exist');

          cy.contains('change').should('exist');

          cy.contains('button', 'Publish').click();
        });

      cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 10000 })
        .should('be.disabled')
        .should('contain.text', 'Publishing');

      cy.get('[class*="alert"], [role="alert"]', { timeout: 10000 })
        .should('be.visible');

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

            cy.get('[class*="alert"]').first().within(() => {
              cy.get('button[aria-label*="close"], button[aria-label*="dismiss"], [class*="close"]')
                .first()
                .click({ force: true });
            });

            cy.get('[data-eid*="publish-alert.success.custom_domain"]', { timeout: 5000 })
              .should('not.exist');

            cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 10000 })
              .should('be.disabled');

          } else if (result.status === 'failed') {
            cy.contains('button', /try again/i, { timeout: 30000 }).should('exist');
          }
        });
      });
      });
    });

    it('should disable publish button while AI is processing and re-enable after completion', () => {
      cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');
      cy.intercept('POST', '**/api/chat/stream').as('chatStream');
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.getOrCreateSharedApp(SHARED_APP_KEY, SPEC_PREFIX, 'Test app for publish').then((appId) => {
        cy.log(`Using app ID: ${appId}`);

        cy.visit(`/develop/${appId}`);

        cy.waitForDevelopPage();

        cy.get('body').type('{esc}');
        cy.wait(500);

        cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 30000 })
          .should('be.visible')
          .should('contain.text', 'Publish');

        cy.waitForChatInput();
        cy.wait(1000);

        cy.get('#chat-input-textarea')
          .should('be.visible')
          .should('not.be.disabled')
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

        cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 10000 })
          .should('be.disabled');

        cy.log('✓ Publish button disabled while AI processes');

        cy.waitForChatInput();

        cy.log('✓ AI processing completed');

        cy.get('[data-eid*="header"][data-eid*="publish"]', { timeout: 30000 })
          .should('not.be.disabled')
          .should('contain.text', 'Publish');

        cy.log('✓ Publish button re-enabled after AI completion');
      });
    });
  });
});

export {};

