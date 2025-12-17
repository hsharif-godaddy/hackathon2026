// ***********************************************************
// This file is processed and loaded automatically before your test files.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands';
import { dismissPrivacyBanners, getCredentials, getDomainCookie } from './utils/helpers';

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
 * Helper to set up authentication cookies
 */
function setupAuth() {
  const { env, username, password } = getCredentials();

  return cy.session(String(username), () => {
    cy.task('auth:getIDPToken', { env, username, password })
      .then((token) => {
        expect(token).to.be.a('string');
        expect(token).not.to.be.empty;

        cy.setCookie('auth_idp', token as string, {
          domain: getDomainCookie(env),
          path: '/',
          expiry: Math.floor(Date.now() / 1000) + 43200,
          httpOnly: true,
          secure: true
        });
        cy.setCookie('market', 'en-US');
      });
  }, { cacheAcrossSpecs: true });
}

/**
 * Get the spec prefix for the current spec file.
 * Used to identify apps created by this spec for cleanup.
 */
function getSpecPrefix(): string {
  const specName = Cypress.spec.name.replace('.cy.ts', '').replace('.cy.js', '');
  return `[e2e:${specName}]`;
}

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

    const apps = response.body as Array<{ id: string; name?: string; prompt?: string }>;

    // Only delete apps created by THIS spec (matching prefix in prompt)
    const myApps = apps.filter((app) => app.prompt?.startsWith(specPrefix));

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
        if (deleteResponse.status === 200 || deleteResponse.status === 204) {
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
  setupAuth();
  cleanupSpecApps('Pre-test');
});

/**
 * Global authentication setup that runs before each test
 * Uses cached session from before() hook
 */
beforeEach(() => {
  setupAuth();

  const url = Cypress.env('baseUrl');
  cy.log('Visiting URL:', url);
  cy.visit(url);
  dismissPrivacyBanners();
});

