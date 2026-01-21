// ***********************************************
// Custom commands for Cypress
// https://on.cypress.io/custom-commands
// ***********************************************

/**
 * Dismiss privacy banners if they exist on the page.
 * Uses Cypress retry-ability to wait for banners that load asynchronously.
 * Silently continues if banners don't exist.
 */
Cypress.Commands.add('dismissBanners', () => {
  const banners = ['#pcFooter', '#gtm_privacy', '#pw_banner'];

  banners.forEach(selector => {
    cy.get('body', { timeout: 2000 }).then($body => {
      if ($body.find(selector).length > 0) {
        cy.get(selector).invoke('hide');
      }
    });
  });
});

/**
 * Clear all authentication state to test unauthenticated flows
 * This clears sessions, cookies, and localStorage
 */
Cypress.Commands.add('clearAuthState', () => {
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.clearLocalStorage();
});

/**
 * Ensure authentication is established before making API requests.
 * Uses cy.session() which will restore cached session or create new one.
 * Call this before any command that needs auth cookies.
 */
Cypress.Commands.add('ensureAuth', () => {
  const env = Cypress.env('environment') || 'prod';
  const username = Cypress.env(`${env.toUpperCase()}_USERNAME`);
  const password = Cypress.env(`${env.toUpperCase()}_PASSWORD`);

  if (!username || !password) {
    throw new Error(`${env.toUpperCase()}_USERNAME and ${env.toUpperCase()}_PASSWORD must be set`);
  }

  const domainPrefix = ['dev', 'test', 'prod'].includes(env)
    ? (env === 'prod' ? '' : `${env}-`)
    : '';
  const cookieDomain = `.${domainPrefix}godaddy.com`;

  cy.session(String(username), () => {
    cy.task('auth:getIDPToken', { env, username, password })
      .then((token) => {
        expect(token).to.be.a('string');
        expect(token).not.to.be.empty;

        cy.setCookie('auth_idp', token as string, {
          domain: cookieDomain,
          path: '/',
          expiry: Math.floor(Date.now() / 1000) + 43200,
          httpOnly: true,
          secure: true
        });
        cy.setCookie('market', 'en-US');
      });
  }, {
    cacheAcrossSpecs: true,
    validate: () => {
      // Validate the session is still valid by making a test API call
      cy.request({
        url: '/api/sites',
        failOnStatusCode: false,
      }).then((response) => {
        // If we get 401, the session is invalid
        if (response.status === 401) {
          throw new Error('Session invalid - will recreate');
        }
      });
    },
  });
});

/**
 * Open the user menu in the header
 * Clicks the user icon to reveal the dropdown menu
 * Target the Radix Popover trigger that contains only an SVG icon (no text)
 * This distinguishes UserMenu from AppSelector which also uses Popover
 */
Cypress.Commands.add('openUserMenu', () => {
  // Find the user menu trigger:
  // - It's a button with data-state (Radix Popover trigger)
  // - It only contains an SVG icon (no text content)
  // - UserMenu is positioned before AppSelector in the header
  cy.get('header button[data-state]')
    .filter((index, el) => {
      const text = (el.textContent || '').trim();
      const hasSvg = el.querySelector('svg') !== null;
      // UserMenu trigger has SVG but no text
      return hasSvg && text.length === 0;
    })
    .first()
    .click({ force: true });
});

/**
 * Verify user is authenticated by checking for Sign Out in user menu
 */
Cypress.Commands.add('verifyAuthenticated', () => {
  // Close any open popovers first by pressing Escape
  cy.get('body').type('{esc}');

  // Wait for any open popovers to close before opening user menu
  // Check for Radix popover with data-state="closed" or absence of open popovers
  cy.get('body').should(($body) => {
    const openPopovers = $body.find('[data-state="open"]').length;
    expect(openPopovers, 'all popovers should be closed').to.equal(0);
  });

  cy.openUserMenu();
  // Use exist instead of visible to handle z-index/overlay issues
  cy.contains('button', 'Sign Out').should('exist');
  // Close the menu
  cy.get('body').type('{esc}');
});

/**
 * Verify user is not authenticated by checking for Sign In in user menu
 */
Cypress.Commands.add('verifyUnauthenticated', () => {
  cy.openUserMenu();
  cy.contains('button', 'Sign In').should('be.visible');
  // Close the menu by clicking elsewhere
  cy.get('body').click(0, 0);
});

/**
 * Wait for homepage to fully load
 * Intercepts sites API and waits for the main textarea to be visible
 */
Cypress.Commands.add('waitForHomepage', () => {
  cy.intercept('GET', '**/api/sites').as('getSitesHomepage');
  cy.wait('@getSitesHomepage');
  cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
    .should('be.visible');
});

/**
 * Wait for apps page to fully load
 * Intercepts sites API and waits for the page content
 */
Cypress.Commands.add('waitForAppsPage', () => {
  cy.intercept('GET', '**/api/sites').as('getSitesApps');
  cy.wait('@getSitesApps');
  cy.contains('Manage your AI-powered websites and applications', { timeout: 30000 })
    .should('be.visible');
});

/**
 * Click Sign Out from user menu
 * Opens menu and clicks the sign out button
 */
Cypress.Commands.add('signOut', () => {
  cy.openUserMenu();
  cy.get('[data-eid*="user_menu.sign_out"]')
    .should('be.visible')
    .click();
});

/**
 * Click Sign In from user menu
 * Opens menu and clicks the sign in button
 */
Cypress.Commands.add('signIn', () => {
  cy.openUserMenu();
  cy.get('[data-eid*="user_menu.sign_in"]')
    .should('be.visible')
    .click();
});

/**
 * Wait for develop page to be fully ready
 * Waits for chat input and preview iframe to be interactive
 */
Cypress.Commands.add('waitForDevelopPage', () => {
  cy.waitForChatInput();

  cy.get('#preview-iframe', { timeout: 180000 })
    .should('be.visible')
    .should('have.attr', 'src');
});

/**
 * Get an existing app ID from the API or create one if none exist.
 * Returns the app ID for use with openDevelop.
 */
Cypress.Commands.add('getExistingAppId', () => {
  return cy.request({
    method: 'GET',
    url: '/api/sites',
    failOnStatusCode: false,
  }).then((response): Cypress.Chainable<string> => {
    if (response.status === 200 && response.body?.length > 0) {
      const appId = response.body[0].id as string;
      cy.log(`Using existing app: ${appId}`);
      return cy.wrap(appId);
    }

    cy.log('No existing apps found, creating one');
    return cy.createAppAndGetId('Test app for e2e');
  });
});

/**
 * Navigate to an existing app's develop page.
 * If no apps exist, create one first to avoid empty state failures.
 */
Cypress.Commands.add('navigateToExistingApp', () => {
  cy.getExistingAppId().then((appId) => {
    cy.openDevelop(appId);
  });
});

/**
 * Create a new app and return its ID, then remain on develop page.
 * Waits for the UI to be fully interactive before returning.
 */
Cypress.Commands.add('createAppAndGetId', (prompt: string) => {
  cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

  cy.visit('/');

  cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
    .should('be.visible')
    .type(prompt);

  cy.get('[data-eid*="homepage.prompt.submit"]')
    .should('not.be.disabled')
    .click();

  return cy.wait('@quickCreate', { timeout: 60000 }).then((interception) => {
    const status = interception.response?.statusCode;
    expect(status).to.be.oneOf([200, 201]);
    const appId = interception.response?.body?.id as string;

    cy.url({ timeout: 60000 }).should('include', '/develop/');
    cy.waitForDevelopPage();

    return cy.wrap(appId);
  });
});

/**
 * Open develop page for a specific app id and wait for it to be ready.
 */
Cypress.Commands.add('openDevelop', (appId: string) => {
  cy.visit(`/develop/${appId}`);
  cy.waitForDevelopPage();
});

/**
 * Create a new app from homepage with the given prompt
 * @param prompt - The prompt to use for creating the app
 */
Cypress.Commands.add('createNewApp', (prompt: string) => {
  cy.intercept('POST', '**/api/sites/quick-create').as('quickCreate');

  cy.visit('/');

  // Wait for homepage to be ready
  cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
    .should('be.visible')
    .type(prompt);

  cy.get('[data-eid*="homepage.prompt.submit"]')
    .should('not.be.disabled')
    .click();

  // API returns 201 for created resources
  cy.wait('@quickCreate', { timeout: 60000 }).its('response.statusCode').should('be.oneOf', [200, 201]);
  cy.url({ timeout: 60000 }).should('include', '/develop/');
});

/**
 * Send a chat message on the develop page
 * @param message - The message to send
 */
Cypress.Commands.add('sendChatMessage', (message: string) => {
  cy.get('textarea[placeholder*="Ask Airo"]', { timeout: 120000 })
    .should('be.visible')
    .should('not.be.disabled')
    .type(message);

  cy.get('#chat-send-button')
    .should('not.be.disabled')
    .click();
});

/**
 * Wait for chat input to be ready for interaction.
 * Ensures:
 * 1. Loading spinner is gone (chat history loaded)
 * 2. Preview iframe is loaded
 * 3. Textarea is visible, enabled, and not showing "Processing" placeholder
 */
Cypress.Commands.add('waitForChatInput', () => {
  // Wait for loading spinner to disappear and chat to be ready
  // The spinner appears during page/history loading
  cy.get('body', { timeout: 180000 }).should(($body) => {
    // Check spinner is gone (uses ux-spinner class from @ux/spinner)
    const hasSpinner = $body.find('[class*="ux-spinner"], [class*="Spinner"]').length > 0;
    expect(hasSpinner, 'loading spinner should be gone').to.be.false;

    // Check either messages exist or empty state is shown
    const hasMessages = $body.find('[class*="StreamingMessage"]').length > 0;
    const hasEmptyState = $body.text().includes('No messages yet') || $body.text().includes('Start a conversation');
    expect(hasMessages || hasEmptyState, 'chat history should be loaded').to.be.true;
  });

  // Wait for preview iframe to be loaded
  cy.get('#preview-iframe', { timeout: 180000 })
    .should('be.visible')
    .should('have.attr', 'src');

  // Then wait for chat input to be ready - not disabled and not showing "Processing..."
  // Use should() with custom assertion for proper retry behavior
  cy.get('#chat-input-textarea', { timeout: 180000 })
    .should(($el) => {
      const isDisabled = $el.prop('disabled');
      const placeholder = ($el.attr('placeholder') || '').toLowerCase();
      const isProcessing = placeholder.includes('processing');

      // These will cause Cypress to retry until conditions are met
      expect(isDisabled, 'chat input should not be disabled').to.be.false;
      expect(isProcessing, 'chat input should not be processing').to.be.false;
      expect(placeholder, 'chat input should have ask airo placeholder').to.include('ask airo');
    });
});

/**
 * Delete an app by ID via the API
 * Used for cleanup after tests that create new apps
 * Silently fails if app doesn't exist or delete fails (best effort cleanup)
 */
Cypress.Commands.add('deleteApp', (appId: string) => {
  if (!appId) return;

  cy.request({
    method: 'DELETE',
    url: `/api/sites/${appId}`,
    failOnStatusCode: false,
  }).then((response) => {
    if (response.status === 200 && response.body?.success) {
      cy.log(`✓ Deleted app: ${appId}`);
    } else {
      cy.log(`⚠ Could not delete app ${appId}: ${response.status}`);
    }
  });
});

/**
 * Delete all apps whose name or description contains the given prefix.
 * Used for cleanup before test runs to ensure isolation.
 */
Cypress.Commands.add('deleteAppsWithPrefix', (prefix: string) => {
  cy.request({
    method: 'GET',
    url: '/api/sites',
    failOnStatusCode: false,
  }).then((response) => {
    if (response.status !== 200 || !response.body?.length) {
      cy.log('No apps found to clean up');
      return;
    }

    interface AppData {
      id: string;
      name?: string;
      initial_prompt?: string;
    }

    const apps = response.body as AppData[];
    const toDelete = apps.filter((app) => {
      const searchFields = [app.name, app.initial_prompt].filter(Boolean).join(' ');
      return searchFields.includes(prefix);
    });

    if (toDelete.length === 0) {
      cy.log(`No apps found with prefix: ${prefix}`);
      return;
    }

    cy.log(`Cleaning up ${toDelete.length} app(s) with prefix: ${prefix}`);

    toDelete.forEach((app) => {
      cy.request({
        method: 'DELETE',
        url: `/api/sites/${app.id}`,
        failOnStatusCode: false,
      }).then((deleteResponse) => {
        if (
          (deleteResponse.status === 200 && deleteResponse.body?.success) ||
          deleteResponse.status === 204
        ) {
          cy.log(`✓ Cleaned up: ${app.name || app.initial_prompt} (${app.id})`);
        } else {
          cy.log(`⚠ Failed to delete ${app.id}: ${deleteResponse.status}`);
        }
      });
    });
  });
});

/**
 * Clean up ALL e2e test apps (any app with [e2e: in name/description).
 * Useful for one-time cleanup of accumulated test apps.
 */
Cypress.Commands.add('cleanupAllE2eApps', () => {
  cy.deleteAppsWithPrefix('[e2e:');
});

/**
 * Set up an isolated app for a test spec file.
 * Cleans up any existing apps with the prefix, then creates a fresh one.
 * Call this in a `before` hook to create one app per spec file.
 */
Cypress.Commands.add('setupIsolatedApp', (specPrefix: string, appDescription?: string) => {
  cy.ensureAuth();

  const appName = appDescription
    ? `${specPrefix} ${appDescription}`
    : `${specPrefix} Test app`;

  cy.intercept('POST', '**/api/sites/quick-create').as('setupQuickCreate');

  cy.visit('/');

  cy.get('textarea[placeholder*="Describe your app idea"]', { timeout: 30000 })
    .should('be.visible')
    .type(appName);

  cy.get('[data-eid*="homepage.prompt.submit"]')
    .should('not.be.disabled')
    .click();

  return cy.wait('@setupQuickCreate', { timeout: 60000 }).then((interception) => {
    const status = interception.response?.statusCode;
    expect(status).to.be.oneOf([200, 201]);
    const initialId = interception.response?.body?.id as string;
    const idType = interception.response?.body?.type as string;

    // If this is a job ID (V2), the URL may have ?type=job query param
    // In test/local environments, job might not convert to full app ID
    // Extract whatever ID is in the URL after waiting for page to settle
    if (idType === 'job' || initialId.length <= 8) {
      // Wait for URL to stabilize on the develop page (redirect completes)
      cy.url({ timeout: 30000 }).should('match', /\/develop\/[a-zA-Z0-9]+/);

      return cy.url().then((url) => {
        const match = url.match(/\/develop\/([a-zA-Z0-9]+)/);
        const appId = match ? match[1] : initialId;
        cy.log(`Using app ID: ${appId} (from ${idType || 'response'})`);
        return cy.wrap(appId);
      });
    }

    return cy.wrap(initialId);
  });
});


interface DeploymentPollResult {
  success: boolean;
  deploymentId: string;
  status: string;
}

/**
 * Poll deployment status until complete or timeout
 * Used to wait for deployment after clicking publish button
 */
Cypress.Commands.add('pollDeploymentStatus', (
  appId: string,
  deploymentId: string,
  pollInterval: number,
  maxWaitTime: number
) => {
  const startTime = Date.now();

  function checkStatus(): void {
    const elapsed = Date.now() - startTime;

    if (elapsed >= maxWaitTime) {
      cy.log(`⚠ Deployment timeout after ${Math.round(elapsed / 1000)}s`);
      const result: DeploymentPollResult = {
        success: false,
        deploymentId,
        status: 'timeout',
      };
      cy.wrap(result).as('deploymentPollResult');
      return;
    }

    cy.request({
      method: 'GET',
      url: `/api/apps/${appId}/deployments?limit=10&includeJobData=true`,
      failOnStatusCode: false,
    }).then((response) => {
      if (response.status !== 200) {
        cy.log(`Deployments API error: ${response.status}`);
        // Continue polling on API errors
        cy.wait(pollInterval).then(() => checkStatus());
        return;
      }

      const deployments = response.body?.deployments || response.body || [];
      const deployment = deployments.find((d: { id: string }) => d.id === deploymentId);

      if (!deployment) {
        cy.log(`Deployment ${deploymentId} not found yet, continuing to poll...`);
        cy.wait(pollInterval).then(() => checkStatus());
        return;
      }

      const status = deployment.status?.toLowerCase();
      cy.log(`Deployment status: ${status} (elapsed: ${Math.round(elapsed / 1000)}s)`);

      if (status === 'deployed') {
        cy.log(`✓ Deployment successful after ${Math.round(elapsed / 1000)}s`);
        const result: DeploymentPollResult = {
          success: true,
          deploymentId,
          status: 'deployed',
        };
        cy.wrap(result).as('deploymentPollResult');
        return;
      }

      if (status === 'failed') {
        cy.log(`✗ Deployment failed after ${Math.round(elapsed / 1000)}s`);
        const result: DeploymentPollResult = {
          success: false,
          deploymentId,
          status: 'failed',
        };
        cy.wrap(result).as('deploymentPollResult');
        return;
      }

      // Status is pending or deploying, continue polling
      cy.wait(pollInterval).then(() => checkStatus());
    });
  }

  checkStatus();
  return cy.get<DeploymentPollResult>('@deploymentPollResult');
});

// Extend Cypress namespace for TypeScript support
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Dismiss privacy banners if they exist on the page
       * @example cy.dismissBanners()
       */
      dismissBanners(): Chainable<void>;

      /**
       * Clear all authentication state (sessions, cookies, localStorage)
       * @example cy.clearAuthState()
       */
      clearAuthState(): Chainable<void>;

      /**
       * Ensure authentication is established before making API requests
       * Uses cy.session() which will restore cached session or create new one
       * @example cy.ensureAuth()
       */
      ensureAuth(): Chainable<void>;

      /**
       * Open the user menu dropdown in the header
       * @example cy.openUserMenu()
       */
      openUserMenu(): Chainable<void>;

      /**
       * Verify user is authenticated by checking user menu
       * @example cy.verifyAuthenticated()
       */
      verifyAuthenticated(): Chainable<void>;

      /**
       * Verify user is not authenticated by checking user menu
       * @example cy.verifyUnauthenticated()
       */
      verifyUnauthenticated(): Chainable<void>;

      /**
       * Wait for homepage to fully load
       * @example cy.waitForHomepage()
       */
      waitForHomepage(): Chainable<void>;

      /**
       * Wait for apps page to fully load
       * @example cy.waitForAppsPage()
       */
      waitForAppsPage(): Chainable<void>;

      /**
       * Sign out via user menu
       * @example cy.signOut()
       */
      signOut(): Chainable<void>;

      /**
       * Click Sign In from user menu
       * @example cy.signIn()
       */
      signIn(): Chainable<void>;

      /**
       * Wait for develop page to be fully ready
       * @example cy.waitForDevelopPage()
       */
      waitForDevelopPage(): Chainable<void>;

      /**
       * Get an existing app ID or create one if none exist
       * @example cy.getExistingAppId().then(id => ...)
       */
      getExistingAppId(): Chainable<string>;

      /**
       * Navigate to an existing app's develop page
       * @example cy.navigateToExistingApp()
       */
      navigateToExistingApp(): Chainable<void>;

      /**
       * Create a new app from homepage with the given prompt
       * @param prompt - The prompt to use for creating the app
       * @example cy.createNewApp('Create a todo list app')
       */
      createNewApp(prompt: string): Chainable<void>;

      /**
       * Send a chat message on the develop page
       * @param message - The message to send
       * @example cy.sendChatMessage('Add a header')
       */
      sendChatMessage(message: string): Chainable<void>;

      /**
       * Wait for chat input to be ready for interaction
       * @example cy.waitForChatInput()
       */
      waitForChatInput(): Chainable<void>;

      /**
       * Create a new app and get its id, stays on develop page
       * @example cy.createAppAndGetId('My app')
       */
      createAppAndGetId(prompt: string): Chainable<string>;

      /**
       * Open develop page for an app id and wait for ready
       * @example cy.openDevelop(appId)
       */
      openDevelop(appId: string): Chainable<void>;

      /**
       * Delete an app by ID via the API (cleanup helper)
       * @param appId - The ID of the app to delete
       * @example cy.deleteApp('abc-123')
       */
      deleteApp(appId: string): Chainable<void>;

      /**
       * Delete all apps whose name contains the given prefix
       * Used for cleanup before test runs to ensure isolation
       * @param prefix - The prefix to match in app names
       * @example cy.deleteAppsWithPrefix('[e2e:develop-chat]')
       */
      deleteAppsWithPrefix(prefix: string): Chainable<void>;

      /**
       * Clean up ALL e2e test apps (any app with [e2e: in name/description)
       * Useful for one-time cleanup of accumulated test apps
       * @example cy.cleanupAllE2eApps()
       */
      cleanupAllE2eApps(): Chainable<void>;

      /**
       * Set up an isolated app for a test spec file
       * Cleans up existing apps with the prefix, then creates a fresh one
       * Call this in a `before` hook to create one app per spec file
       * @param specPrefix - The prefix to use for cleanup and app naming
       * @param appDescription - Optional description to append to the app name
       * @example cy.setupIsolatedApp('[e2e:develop-chat]', 'Test app for chat')
       */
      setupIsolatedApp(specPrefix: string, appDescription?: string): Chainable<string>;

      /**
       * Poll deployment status until complete or timeout
       * Used after clicking publish to wait for deployment completion
       * @param appId - The ID of the app
       * @param deploymentId - The deployment ID to poll
       * @param pollInterval - Time between polls in ms
       * @param maxWaitTime - Maximum wait time in ms
       * @example cy.pollDeploymentStatus('app-123', 'deploy-456', 5000, 300000)
       */
      pollDeploymentStatus(
        appId: string,
        deploymentId: string,
        pollInterval: number,
        maxWaitTime: number
      ): Chainable<{ success: boolean; deploymentId: string; status: string }>;
    }
  }
}

export {};
