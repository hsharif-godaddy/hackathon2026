# E2E Testing Guidelines

## Framework Selection: Cypress vs Playwright

### Default: Use Cypress with Testla

**Always try Cypress first** for new E2E tests. Cypress and Testla are the company's approved framework for frontend e2e testing. Cypress integrates with Testla for:

- Scheduled test runs
- Test reporting and analytics
- CI/CD pipeline integration
- Secret management

### When to Use Playwright

If Cypress **cannot support** the test requirements, use Playwright for:

| Scenario                     | Why Playwright                                  |
| ---------------------------- | ----------------------------------------------- |
| **WebSocket/chat testing**   | Better WebSocket interception and mocking       |
| **Complex iframe testing**   | Native cross-origin iframe support              |
| **Multiple browser windows** | Native multi-page/context support               |
| **Safari/WebKit testing**    | Cypress doesn't support Safari                  |
| **Complex mobile emulation** | More accurate device emulation and touch events |
| **Real-time features**       | WebSocket-heavy features (chat, live updates)   |

### Playwright Test Requirements

When creating a Playwright test:

1. **Document the reason** - Add a comment explaining why Playwright is needed:

   ```typescript
   /**
    * @framework Playwright
    * @reason WebSocket testing for real-time chat - Cypress cannot intercept WS
    */
   ```

2. **Add to scheduled runs** - Ensure the test is included in the scheduled Playwright runs (separate from Testla)

3. **Follow same patterns** - Use the same testing patterns (wait for APIs, meaningful selectors, etc.)

## General Principles

### 1. Test Content, Not Routes

Always verify actual page content rather than just URL patterns:

```typescript
// ❌ Bad - only checks route
cy.url().should("include", "/apps");

// ✅ Good - verifies page content loaded
cy.contains("Manage your AI-powered websites and applications").should(
  "be.visible",
);
cy.url().should("include", "/apps");
```

### 2. Use Meaningful Selectors

Prefer selectors in this order of priority:

1. **Content/text** - Most stable, user-facing
2. **data-eid attributes** - Instrumentation markers
3. **aria-labels/roles** - Accessibility attributes
4. **data-testid** - Test-specific attributes
5. **CSS selectors** - Last resort

```typescript
// ✅ Preferred
cy.contains("button", "Start building").click();
cy.get('[data-eid*="user_menu"]').click();

// ⚠️ Acceptable
cy.get('textarea[placeholder*="Describe your app idea"]');

// ❌ Avoid when possible
cy.get(".btn-primary-lg").click();
```

### 3. Handle Async Operations Properly

**Prefer intercepting API requests** over long timeouts. This is more deterministic and faster:

```typescript
// ❌ Bad - arbitrary wait
cy.wait(5000);
cy.get(".content");

// ❌ Avoid - long timeout without knowing what we're waiting for
cy.get(".content", { timeout: 60000 }).should("be.visible");

// ✅ Best - intercept API and wait for response
cy.intercept("GET", "**/api/sites").as("getSites");
cy.visit("/");
cy.wait("@getSites"); // Wait for API to complete
cy.get(".content").should("be.visible"); // Then check UI

// ✅ Good - let Cypress retry with reasonable timeout
cy.get(".content", { timeout: 30000 }).should("be.visible");

// ✅ Good - wait for specific condition
cy.url({ timeout: 30000 }).should("include", "/apps");
```

**When to use `cy.intercept()` + `cy.wait()`:**

- Before interacting with UI that depends on loaded data
- When waiting for server state changes (e.g., server starting)
- To verify API responses as part of the test
- To avoid flaky tests caused by race conditions

**When to use element assertions with timeout:**

- For UI transitions and animations
- When the element appearance is the only indicator
- For simple page loads without complex data dependencies

### 4. Timeouts

Use appropriate timeouts based on operation type:

| Operation          | Timeout |
| ------------------ | ------- |
| Element visibility | 10-30s  |
| Page navigation    | 30s     |
| SSO redirects      | 30-60s  |
| API operations     | 30s     |

```typescript
cy.get("button", { timeout: 10000 }); // Standard element
cy.url({ timeout: 30000 }).should("include", "/apps"); // Navigation
cy.contains("Success", { timeout: 60000 }); // After SSO
```

### 5. Authentication

Authentication is handled globally in `e2e.ts`:

- `before()` hook authenticates via `@gd-cypress/auth`
- `beforeEach()` visits the base URL
- Tests start in an authenticated state

To test unauthenticated flows:

```typescript
beforeEach(() => {
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.clearLocalStorage();
});
```

### 6. Test Structure

```typescript
describe("Feature Name", () => {
  describe("Sub-feature or Flow", () => {
    it("should do specific action with expected outcome", () => {
      // Arrange - setup if needed
      cy.visit("/page");

      // Act - perform actions
      cy.get("button").click();

      // Assert - verify outcomes
      cy.contains("Expected content").should("be.visible");
    });
  });
});
```

## Common Patterns

### Waiting for API Requests (Preferred)

**Always intercept APIs before the action that triggers them:**

```typescript
// Setup intercepts BEFORE visiting the page
cy.intercept("GET", "**/api/sites").as("getSites");
cy.intercept("GET", "**/api/servers/*").as("getServer");

cy.visit("/");

// Wait for data to load before interacting
cy.wait("@getSites");
cy.contains("My Apps").click();
```

**Common API endpoints to intercept:**

| Endpoint         | Purpose                 |
| ---------------- | ----------------------- |
| `/api/sites`     | List of user's apps     |
| `/api/servers/*` | Server status (polling) |
| `/api/auth/*`    | Authentication state    |

**Waiting for multiple API calls:**

```typescript
cy.intercept("GET", "**/api/sites").as("getSites");
cy.intercept("GET", "**/api/user").as("getUser");

cy.visit("/");

// Wait for both APIs
cy.wait(["@getSites", "@getUser"]);
```

**Verifying API response data:**

```typescript
cy.intercept("GET", "**/api/sites").as("getSites");
cy.visit("/");

cy.wait("@getSites").then((interception) => {
  expect(interception.response?.statusCode).to.equal(200);
  expect(interception.response?.body).to.have.length.greaterThan(0);
});
```

### Verifying Page Content

```typescript
// Text content
cy.contains("Expected text").should("be.visible");

// Form elements
cy.get('textarea[placeholder*="placeholder text"]').should("be.visible");

// Buttons by text
cy.contains("button", "Button Text").should("be.visible");
```

### User Menu Interactions

```typescript
// Open user menu
cy.get('[data-eid*="user_menu"], button:has(svg)')
  .filter(":visible")
  .first()
  .click({ force: true });

// Click menu option
cy.contains("button", "Sign Out").should("be.visible").click();
```

### Handling SSO Redirects

```typescript
// Allow time for SSO redirect
cy.wait(3000);

// Verify return from SSO
cy.url({ timeout: 60000 }).should("not.include", "login");
```

### Conditional Elements

```typescript
cy.get("body").then(($body) => {
  if ($body.find(".optional-element").length > 0) {
    cy.get(".optional-element").click();
  }
});
```

## Environment Configuration

Credentials are loaded from environment variables:

- `PROD_USERNAME` / `PROD_PASSWORD` for production
- `TEST_USERNAME` / `TEST_PASSWORD` for test
- `DEV_USERNAME` / `DEV_PASSWORD` for dev

Use the `getCredentials()` helper from `support/utils/helpers.ts`:

```typescript
import { getCredentials } from "../support/utils/helpers";

const { env, username, password } = getCredentials();
```

## Running Tests

```bash
# Production
npm run test:prod

# Test environment
npm run test:test

# Development
npm run test:dev

# With Cypress UI
npm run cypress:open -- --config-file cypress/config/cypress-prod.ts
```

## Debugging

### Enable Verbose Logging

```typescript
cy.log("✅ Step completed");
cy.log("Current URL:", cy.url());
```

### Take Screenshots

```typescript
cy.screenshot("step-name");
```

### Pause Execution

```typescript
cy.pause(); // Opens Cypress debugger
```

## Anti-Patterns to Avoid

1. **Testing implementation details** - Test user-visible behavior
2. **Hardcoded waits** - Use API intercepts or Cypress retries instead of `cy.wait(5000)`
3. **Long timeouts without intercepts** - Prefer `cy.intercept()` + `cy.wait('@alias')` over `{ timeout: 120000 }`
4. **Flaky selectors** - Use stable, content-based selectors
5. **Testing third-party services** - Mock external dependencies
6. **Long test files** - Split into logical test files by feature
7. **Dependent tests** - Each test should be independent
8. **Interacting before data loads** - Always wait for relevant APIs before clicking

```typescript
// ❌ Bad - hoping data loaded in time
cy.visit("/");
cy.wait(3000); // Arbitrary wait
cy.contains("My Apps").click();

// ✅ Good - wait for data explicitly
cy.intercept("GET", "**/api/sites").as("getSites");
cy.visit("/");
cy.wait("@getSites");
cy.contains("My Apps").click();
```
