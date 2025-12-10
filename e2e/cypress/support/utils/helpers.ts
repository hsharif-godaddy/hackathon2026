export function dismissPrivacyBanners() {
    cy.get('body').then(($body) => {
      if ($body.find('#pcFooter').length > 0) {
        cy.get('#pcFooter').invoke('css', 'display', 'none');
      }
      if ($body.find('#gtm_privacy').length > 0) {
        cy.get('#gtm_privacy').invoke('css', 'display', 'none');
      }
    });
}

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