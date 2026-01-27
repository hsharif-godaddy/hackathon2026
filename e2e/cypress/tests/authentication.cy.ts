/**
 * Authentication E2E Tests
 *
 * Tests the core authentication flows:
 * 1. Homepage authentication - public page that prompts login for protected actions
 * 2. Login flow - SSO sign-in via user menu
 * 3. Logout flow - sign out via user menu
 * 4. Unauthorized page - protected routes showing auth required message
 *
 * User is authenticated via e2e.ts beforeEach hook by default.
 * Tests that need unauthenticated state must clear session first.
 */
describe('Authentication', () => {
  describe('Homepage Authentication Flow', () => {
    it('should display homepage content when authenticated', () => {
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.visit('/');
      cy.wait('@getSites');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      cy.get('header').should('be.visible');

      cy.verifyAuthenticated();
    });

    it('should show apps dropdown when authenticated user has apps', () => {
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.visit('/');
      cy.wait('@getSites');

      cy.get('body').then(($body) => {
        if ($body.find('[data-eid*="apps_menu.app"]').length > 0) {
          cy.get('[data-eid*="apps_menu.app"]').first().should('be.visible');
          cy.get('[data-eid*="apps_menu.see_all"]').should('be.visible');
        }
      });
    });

    it('should navigate to apps page from homepage via See All', () => {
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.visit('/');
      cy.wait('@getSites');

      cy.get('body').then(($body) => {
        if ($body.find('[data-eid*="apps_menu.see_all"]').length > 0) {
          cy.get('[data-eid*="apps_menu.see_all"]')
            .should('be.visible')
            .click();

          cy.url({ timeout: 15000 }).should('include', '/apps');
          cy.contains('Manage your AI-powered websites and applications').should('be.visible');
        }
      });
    });
  });

  describe('Login Flow', () => {
    beforeEach(() => {
      cy.clearAuthState();
    });

    it('should show Sign In option in user menu when not authenticated', () => {
      cy.wait(1000);
      cy.visit('/', { failOnStatusCode: false });

      // Homepage loads normally (no SSO redirect on load)
      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      // SSO modal should NOT be present on initial page load
      cy.get('iframe[src*="sso"]').should('not.exist');

      // Verify Sign In option is available in user menu
      cy.verifyUnauthenticated();
    });

    it('should trigger SSO login when Sign In is clicked', () => {
      const env = Cypress.env('environment') || 'prod';

      // Ensure clean state
      cy.wait(1000);
      cy.visit('/', { failOnStatusCode: false });

      // Both prod and test: Homepage loads normally
      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      // SSO modal should NOT exist before clicking Sign In
      cy.get('iframe[src*="sso"]').should('not.exist');

      cy.signIn();

      if (env === 'prod') {
        // Prod: SSO modal appears after clicking Sign In
        cy.get('iframe[src*="sso"]', { timeout: 30000 })
          .should('exist');
      } else {
        // Test: Redirects to SSO page after clicking Sign In
        cy.url({ timeout: 30000 }).should('include', 'sso');
      }
    });

    it('should prompt for login when trying to create app without authentication', () => {
      const env = Cypress.env('environment') || 'prod';

      // Fresh page visit to ensure clean state
      cy.clearAuthState();
      cy.wait(1000);
      cy.visit('/', { failOnStatusCode: false });

      // Both prod and test: Homepage loads normally (no SSO redirect on load)
      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      // SSO modal should NOT exist before clicking submit
      cy.get('iframe[src*="sso"]').should('not.exist');

      // Type prompt and click submit
      cy.get('[data-testid="homepage-prompt-input"]')
        .type('A simple page that displays hello world');

      cy.get('[data-eid*="homepage.prompt.submit"]').click();

      if (env === 'prod') {
        // Prod: SSO modal iframe appears - verify it shows
        cy.get('#sso-deck-iframe', { timeout: 30000 })
          .should('exist')
          .should('be.visible');
      } else {
        // Test: Redirects to SSO page after clicking submit
        cy.url({ timeout: 30000 }).should('include', 'sso');
      }
    });
  });

  describe('Logout Flow', () => {
    it('should sign out user when Sign Out is clicked', () => {
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.visit('/');
      cy.wait('@getSites');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      cy.get('body').type('{esc}');
      cy.wait(500);

      cy.openUserMenu();
      cy.get('[data-eid*="user_menu.sign_out"]')
        .should('exist');

      cy.get('[data-eid*="user_menu.sign_out"]').click({ force: true });

      cy.wait(2000);

      cy.url({ timeout: 10000 }).then((url) => {
        const logoutInitiated = url.includes('sso') ||
                               url.includes('logout') ||
                               url.includes('godaddy.com');
        expect(logoutInitiated).to.be.true;
      });
    });
  });

  describe('Unauthorized Page Flow', () => {
    beforeEach(() => {
      cy.clearAuthState();
    });

    it('should show unauthorized message on protected route when not authenticated', () => {
      const env = Cypress.env('environment') || 'prod';

      cy.visit('/apps', { failOnStatusCode: false });

      if (env === 'prod') {
        cy.get('body', { timeout: 30000 }).should(($body) => {
          const bodyText = $body.text();
          const hasAuthRequired = bodyText.includes('Authentication Required');
          const hasSignIn = bodyText.includes('Sign In');
          expect(hasAuthRequired || hasSignIn).to.be.true;
        });

        cy.get('iframe[src*="sso"]').should('not.exist');
      } else {
        cy.url({ timeout: 10000 }).then((url) => {
          if (url.includes('sso') || url.includes('login')) {
            cy.log('User redirected to SSO on protected route');
            expect(true).to.be.true;
          } else {
            cy.get('body', { timeout: 30000 }).should(($body) => {
              const bodyText = $body.text();
              expect(bodyText.includes('Authentication Required') || bodyText.includes('Sign In')).to.be.true;
            });
          }
        });
      }
    });

    it('should trigger login from unauthorized page Sign In button', () => {
      const env = Cypress.env('environment') || 'prod';

      cy.clearAuthState();
      cy.wait(1000);
      cy.visit('/apps', { failOnStatusCode: false });

      // Should show unauthorized page with Sign In button
      cy.contains('Sign In to Continue', { timeout: 30000 }).should('be.visible');

      // SSO modal should NOT exist before clicking
      cy.get('iframe[src*="sso"]').should('not.exist');

      // Click Sign In to Continue button
      cy.contains('button', 'Sign In to Continue').click();

      if (env === 'prod') {
        // Prod: SSO modal should appear after clicking
        cy.get('iframe[src*="sso"]', { timeout: 30000 })
          .should('exist');
      } else {
        // Test: Should redirect to SSO page
        cy.url({ timeout: 30000 }).should('include', 'sso');
      }
    });
  });

  describe('Protected Routes Access', () => {
    it('should require authentication for develop page', () => {
      const env = Cypress.env('environment') || 'prod';

      cy.clearAuthState();

      cy.intercept('GET', '**/api/**').as('apiCall');

      cy.visit('/develop/test-123', { failOnStatusCode: false });

      if (env === 'prod') {
        cy.get('body', { timeout: 30000 }).should(($body) => {
          const requiresAuth = $body.text().includes('Authentication Required') ||
                              $body.text().includes('Sign In') ||
                              $body.text().includes('Loading');
          expect(requiresAuth).to.be.true;
        });
      } else {
        cy.url({ timeout: 10000 }).then((url) => {
          if (url.includes('sso') || url.includes('login')) {
            cy.log('Redirected to SSO login - develop page requires auth');
            expect(true).to.be.true;
          } else {
            cy.get('body', { timeout: 30000 }).should(($body) => {
              const requiresAuth = $body.text().includes('Authentication Required') ||
                                  $body.text().includes('Sign In') ||
                                  $body.text().includes('Loading');
              expect(requiresAuth).to.be.true;
            });
          }
        });
      }
    });

    it('should maintain protected content after page refresh', () => {
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.visit('/apps');
      cy.wait('@getSites');

      cy.contains('Manage your AI-powered websites and applications', { timeout: 30000 })
        .should('be.visible');

      cy.reload();
      cy.wait('@getSites');

      cy.contains('Manage your AI-powered websites and applications', { timeout: 30000 })
        .should('be.visible');
    });
  });

  describe('Session Persistence', () => {
    it('should maintain authentication across page navigations', () => {
      cy.intercept('GET', '**/api/sites').as('getSites');

      cy.visit('/');
      cy.wait('@getSites');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      cy.visit('/apps');
      cy.wait('@getSites');

      cy.contains('Manage your AI-powered websites and applications', { timeout: 30000 })
        .should('be.visible');

      cy.visit('/');
      cy.wait('@getSites');

      cy.verifyAuthenticated();
    });
  });

  describe('Header Authentication State', () => {
    it('should not show apps menu items when not authenticated', () => {
      cy.clearAuthState();
      cy.wait(1000);

      cy.visit('/', { failOnStatusCode: false });

      // Homepage should load
      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');

      // Apps menu items should not exist for unauthenticated users
      cy.get('[data-eid*="apps_menu.app"]').should('not.exist');
    });
  });

  describe('Error Handling', () => {
    it('should handle auth API errors gracefully', () => {
      cy.intercept('GET', '**/api/auth/**', {
        statusCode: 500,
        body: { error: 'Internal Server Error' }
      }).as('authError');

      cy.visit('/');

      cy.get('[data-testid="homepage-prompt-input"]', { timeout: 30000 })
        .should('be.visible');
    });
  });
});
