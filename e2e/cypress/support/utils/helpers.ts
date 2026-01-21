export function getPrefix(env: string) {
    env = ['dev', 'test', 'prod'].indexOf(env) === -1 ? 'dev' : env;
    return env === 'prod' ? '' : `${env}-`;
}

export function getDomainCookie(env: string) {
  return `.${getPrefix(env)}godaddy.com`;
}

/**
 * Get credentials for the current environment
 *
 * @returns Object containing env, username, and password
 * @throws Error if credentials are not configured
 */
export function getCredentials() {
  const env = Cypress.env('environment') || 'prod';
  const username = Cypress.env(`${env.toUpperCase()}_USERNAME`);
  const password = Cypress.env(`${env.toUpperCase()}_PASSWORD`);

  if (!username || !password) {
    throw new Error(`${env.toUpperCase()}_USERNAME and ${env.toUpperCase()}_PASSWORD environment variables must be set`);
  }

  return { env, username, password };
}

/**
 * Get SSO URL for the current environment
 * @param env - Environment name (dev, test, prod)
 * @returns SSO URL for the environment
 */
export function getSsoUrl(env: string) {
  const prefix = getPrefix(env);
  return `https://sso.${prefix}godaddy.com`;
}

/**
 * Get App URL for the current environment
 * @param env - Environment name (dev, test, prod)
 * @returns App URL for the environment
 */
export function getAppUrl(env: string) {
  const prefix = getPrefix(env);
  return `https://airo-builder.${prefix}godaddy.com`;
}

/**
 * Get the spec prefix for the current spec file.
 * Used to identify apps created by this spec for cleanup.
 * Must match the cleanup logic in e2e.ts and cypress.config.ts
 */
export function getSpecPrefix(): string {
  const specName = Cypress.spec.name.replace('.cy.ts', '').replace('.cy.js', '');
  return `[e2e:${specName}]`;
}

/**
 * Complete SSO login flow
 * Use this when SSO modal appears or user is redirected to SSO page.
 * Navigates directly to SSO page, logs in, and redirects back to app.
 *
 * @param returnPath - Path to return to after login (default: '/')
 */
export function completeSsoLogin(returnPath: string = '/') {
  const { env, username, password } = getCredentials();
  const ssoUrl = getSsoUrl(env);
  const appUrl = getAppUrl(env);

  // Navigate directly to SSO login page
  cy.visit(ssoUrl, { failOnStatusCode: false });

  // Wait for SSO page to load and fill in credentials
  cy.get('input[name="username"], input[placeholder*="Username"], input[placeholder*="Customer"]', { timeout: 30000 })
    .should('be.visible')
    .clear()
    .type(username);

  cy.get('input[name="password"], input[type="password"]', { timeout: 10000 })
    .should('be.visible')
    .clear()
    .type(password);

  // Submit login form
  cy.get('button[type="submit"], button:contains("Sign In")', { timeout: 10000 })
    .should('be.visible')
    .click();

  // After login, navigate back to the app
  cy.visit(`${appUrl}${returnPath}`, { timeout: 60000 });

  // Verify we're on the app
  cy.url().should('include', 'airo-builder');
}
