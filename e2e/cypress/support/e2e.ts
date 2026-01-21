// ***********************************************************
// This file is processed and loaded automatically before your test files.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands';
import { getSpecPrefix } from './utils/helpers';

// Ignore React hydration errors (common in SSR/Next.js apps),
// cross-origin errors from SSO redirects, and transient server errors
Cypress.on('uncaught:exception', (err) => {
  const message = err.message.toLowerCase();

  // Catch ALL hydration-related errors (covers "hydration", "hydrating", etc.)
  if (message.includes('hydrat')) {
    return false;
  }

  // React minified errors #418, #423, #425 are hydration-related
  if (/minified react error #(418|423|425)/.test(message)) {
    return false;
  }

  // Cross-origin errors from SSO redirects
  // These occur when Cypress tries to access cookie properties after redirect
  if (message.includes('cannot delete property') && message.includes('cookie')) {
    return false;
  }

  // Cross-origin page errors
  if (message.includes('cross origin')) {
    return false;
  }

  // Transient server errors (502, 503, etc.) - don't fail tests for backend issues
  if (message.includes('status code 502') || message.includes('status code 503')) {
    cy.log('Suppressed transient server error:', message);
    return false;
  }

  // Axios errors from transient backend issues
  if (err.name === 'AxiosError' && message.includes('request failed')) {
    return false;
  }

  // Agent not ready during app deployment - transient state during creation
  if (message.includes('agent is not ready yet') || message.includes('please wait for deployment')) {
    return false;
  }

  // Let other errors fail the test
  return true;
});


/**
 * Clean up apps created by this spec (identified by prompt prefix).
 * This is parallel-safe: only deletes apps matching this spec's prefix.
 */
function cleanupSpecApps(context: string) {
  const baseUrl = Cypress.env('baseUrl');
  const specPrefix = getSpecPrefix();

  cy.request({
    method: 'GET',
    url: `${baseUrl}/api/sites`,
    failOnStatusCode: false,
  }).then((response) => {
    if (response.status !== 200 || !response.body?.length) {
      cy.log(`${context}: No apps found or API error - skipping cleanup`);
      return;
    }

    const apps = response.body as Array<{ id: string; name?: string; initial_prompt?: string }>;

    // Only delete apps created by THIS spec (matching prefix in name or initial_prompt)
    const myApps = apps.filter((app) => 
      app.initial_prompt?.startsWith(specPrefix) || app.name?.includes(specPrefix)
    );

    if (myApps.length === 0) {
      cy.log(`${context}: No apps from ${specPrefix} to clean up`);
      return;
    }

    cy.log(`${context}: Cleaning up ${myApps.length} app(s) from ${specPrefix}`);

    myApps.forEach((app) => {
      cy.request({
        method: 'DELETE',
        url: `${baseUrl}/api/sites/${app.id}`,
        failOnStatusCode: false,
      }).then((deleteResponse) => {
        if (deleteResponse.status === 200 && deleteResponse.body?.success) {
          cy.log(`✓ Deleted: ${app.name || app.id}`);
        } else if (deleteResponse.status === 204) {
          cy.log(`✓ Deleted: ${app.name || app.id}`);
        } else {
          cy.log(`⚠ Failed to delete ${app.id}: ${deleteResponse.status}`);
        }
      });
    });
  });
}

/**
 * Pre-test cleanup - runs once before all tests in each spec file
 * Cleans up apps from PREVIOUS runs of this spec
 * This is parallel-safe: specs don't interfere with each other's apps
 */
before(() => {
  cy.ensureAuth();
});

/**
 * Global authentication setup that runs before each test
 * Uses cached session from before() hook
 * Dismisses privacy banners after page load
 */
beforeEach(() => {
  cy.ensureAuth();

  const url = Cypress.env('baseUrl');
  cy.log('Visiting URL:', url);
  cy.visit(url);
  cy.dismissBanners();
});

