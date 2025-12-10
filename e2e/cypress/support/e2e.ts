// ***********************************************************
// This file is processed and loaded automatically before your test files.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands';
import { dismissPrivacyBanners, getCredentials, getDomainCookie } from './utils/helpers';

// Ignore React hydration errors (common in SSR/Next.js apps)
// These errors don't affect test functionality and are expected in Next.js apps
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

  // Let other errors fail the test
  return true;
});

/**
 * Global authentication setup that runs before each test
 * Uses Cypress session management for efficient auth token handling
 * - First test: Creates and caches the session
 * - Subsequent tests: Restores the cached session (fast)
 */
beforeEach(() => {
  const { env, username, password } = getCredentials();

  cy.session(String(username), () => {
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
  });

  const url = Cypress.env('baseUrl');
  cy.log('Visiting URL:', url);
  cy.visit(url);
  dismissPrivacyBanners();
});

