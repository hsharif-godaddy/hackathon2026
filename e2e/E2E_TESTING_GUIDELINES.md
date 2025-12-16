# E2E Testing Guidelines

> Based on [Cypress Best Practices](https://docs.cypress.io/app/core-concepts/best-practices)

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

---

## Core Cypress Best Practices

### 1. Test Isolation

**Anti-Pattern:** Coupling multiple tests together.

**Best Practice:** Tests should always be able to run independently.

**The test:** Change any test to `it.only` and refresh - if it passes alone, it's well-written.

```typescript
// ❌ Bad - tests depend on each other
describe("my form", () => {
  it("visits the form", () => {
    cy.visit("/users/new");
  });
  it("requires first name", () => {
    cy.get('[data-testid="first-name"]').type("Johnny"); // Fails if run alone!
  });
});

// ✅ Good - each test is independent
describe("my form", () => {
  it("can submit a valid form", () => {
    cy.visit("/users/new");
    cy.get('[data-testid="first-name"]').type("Johnny");
    cy.get('[data-testid="last-name"]').type("Appleseed");
    cy.get("form").submit();
  });
});

// ✅ Also good - use beforeEach for shared setup
describe("my form", () => {
  beforeEach(() => {
    cy.visit("/users/new");
    cy.get('[data-testid="first-name"]').type("Johnny");
  });

  it("validates first name", () => {
    cy.get('[data-testid="first-name"]').clear();
    cy.get("form").submit();
    cy.get('[data-testid="errors"]').should(
      "contain",
      "First name is required",
    );
  });
});
```

### 2. Programmatic Login

**Anti-Pattern:** Using the UI to log in before each test.

**Best Practice:** Log in programmatically via API or `cy.session()`.

```typescript
// ❌ Bad - slow, uses UI
beforeEach(() => {
  cy.visit("/login");
  cy.get("#username").type("user@example.com");
  cy.get("#password").type("password");
  cy.get('button[type="submit"]').click();
});

// ✅ Good - programmatic login with session caching
beforeEach(() => {
  cy.session(
    "user",
    () => {
      cy.task("auth:getIDPToken", { env, username, password }).then((token) => {
        cy.setCookie("auth_idp", token);
      });
    },
    { cacheAcrossSpecs: true },
  );
});
```

### 3. Clean State Before Tests (Not After)

**Anti-Pattern:** Using `after` or `afterEach` hooks to clean up state.

**Best Practice:** Clean up state **before** tests run using `before` or `beforeEach`.

Why? If you refresh Cypress mid-test, `after` hooks won't run, leaving state dirty for the next test.

```typescript
// ❌ Bad - cleanup may not run if test fails or is interrupted
afterEach(() => {
  cy.resetDb();
});

// ✅ Good - cleanup always runs before each test
beforeEach(() => {
  cy.resetDb();
});

// ✅ Also good - in support file for global cleanup
// cypress/support/e2e.ts
beforeEach(() => {
  cy.task("db:seed"); // Reset to known state
});
```

### 4. Don't Use after/afterEach for Logout

```typescript
// ❌ Bad - loses ability to debug app state after test
afterEach(() => {
  cy.logout();
});

// ✅ Good - leave app in final state for debugging
// Cypress automatically clears cookies/localStorage between tests
```

### 5. Avoid Tiny Single-Assertion Tests

**Anti-Pattern:** Writing many small tests with single assertions.

**Best Practice:** Combine related assertions into larger tests.

```typescript
// ❌ Bad - excessive, slow
describe("my form", () => {
  beforeEach(() => {
    cy.visit("/users/new");
    cy.get('[data-testid="first-name"]').type("johnny");
  });

  it("has validation attr", () => {
    cy.get('[data-testid="first-name"]').should(
      "have.attr",
      "data-validation",
      "required",
    );
  });

  it("has active class", () => {
    cy.get('[data-testid="first-name"]').should("have.class", "active");
  });

  it("has formatted first name", () => {
    cy.get('[data-testid="first-name"]').should("have.value", "Johnny");
  });
});

// ✅ Good - combined, faster
describe("my form", () => {
  it("validates and formats first name", () => {
    cy.visit("/users/new");
    cy.get('[data-testid="first-name"]')
      .type("johnny")
      .should("have.attr", "data-validation", "required")
      .and("have.class", "active")
      .and("have.value", "Johnny");
  });
});
```

### 6. Don't Assign Return Values to Variables

**Anti-Pattern:** Trying to assign command results to variables.

**Best Practice:** Use aliases and closures.

```typescript
// ❌ Bad - doesn't work as expected
const button = cy.get("button");
button.click(); // Won't work!

// ✅ Good - use aliases
cy.get("button").as("submitBtn");
cy.get("@submitBtn").click();

// ✅ Good - use .then() for values
cy.get("input")
  .invoke("val")
  .then((value) => {
    // use value here
  });
```

### 7. Don't Visit External Sites

**Anti-Pattern:** Visiting or interacting with sites you don't control.

**Best Practice:** Use `cy.request()` for third-party APIs. Only use `cy.visit()` for your own app.

```typescript
// ❌ Bad - visiting third-party site
cy.visit("https://github.com/login");

// ✅ Good - use API requests for third-party interactions
cy.request({
  method: "POST",
  url: "https://api.github.com/...",
  headers: { Authorization: "Bearer ..." },
});
```

### 8. Set a Global baseUrl

**Anti-Pattern:** Hardcoding URLs in `cy.visit()`.

**Best Practice:** Set `baseUrl` in Cypress config.

```typescript
// cypress.config.ts
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:8080",
  },
});

// Then in tests:
cy.visit("/users/new"); // ✅ Uses baseUrl
// Instead of:
cy.visit("http://localhost:8080/users/new"); // ❌ Hardcoded
```

### 9. Use Test Retries for Flaky Tests

For tests that may fail due to timing (like AI processing), use retries:

```typescript
// cypress.config.ts
export default defineConfig({
  e2e: {
    retries: {
      runMode: 2, // Retry up to 2 times in CI
      openMode: 0, // No retries in interactive mode
    },
  },
});
```

### 10. Don't Start Web Servers from Cypress

**Anti-Pattern:** Starting your server from `cy.exec()` or `cy.task()`.

**Best Practice:** Start the server before running Cypress.

```bash
# Start server first, then run Cypress
npm run start & npx cypress run
```

---

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

### 2. Selecting Elements

**Anti-Pattern:** Using brittle selectors that break with CSS/JS changes.

**Best Practice:** Use `data-*` attributes to isolate selectors from styling.

#### Selector Priority (Best to Worst)

| Selector                         | Recommended  | Notes                            |
| -------------------------------- | ------------ | -------------------------------- |
| `cy.get('[data-cy="submit"]')`   | ✅ Always    | Best - isolated from all changes |
| `cy.get('[data-eid*="submit"]')` | ✅ Always    | Best - instrumentation markers   |
| `cy.contains('Submit')`          | ⚠️ Depends   | Good if text is critical to test |
| `cy.get('[name="submission"]')`  | ⚠️ Sparingly | Coupled to HTML semantics        |
| `cy.get('#main')`                | ⚠️ Sparingly | Coupled to styling/JS            |
| `cy.get('.btn.btn-large')`       | ❌ Never     | Bad - coupled to CSS             |
| `cy.get('button')`               | ❌ Never     | Worst - too generic              |

#### When to Use `cy.contains()` vs `data-*`

Ask yourself: **If the text changed, should the test fail?**

- **Yes** → Use `cy.contains()` (text is critical)
- **No** → Use `data-*` attribute (text can change)

```typescript
// Text is critical - use cy.contains()
cy.contains("button", "Submit Payment").click();

// Text can change - use data attribute
cy.get('[data-eid*="submit_button"]').click();
```

#### Custom Commands for Selectors

```typescript
// cypress/support/commands.ts
Cypress.Commands.add("getBySel", (selector, ...args) => {
  return cy.get(`[data-eid=${selector}]`, ...args);
});

Cypress.Commands.add("getBySelLike", (selector, ...args) => {
  return cy.get(`[data-eid*=${selector}]`, ...args);
});

// Usage:
cy.getBySel("submit-button").click();
cy.getBySelLike("user_menu").click();
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

### ❌ Unnecessary Waiting

```typescript
// ❌ Bad - cy.request() already waits for response
cy.request("http://localhost:8080/db/seed");
cy.wait(5000);

// ❌ Bad - cy.visit() already waits for page load
cy.visit("http://localhost/8080");
cy.wait(5000);

// ❌ Bad - cy.get() already retries until assertion passes
cy.intercept("GET", "/users", [{ name: "Maggy" }]);
cy.get("#fetch").click();
cy.wait(4000);
cy.get("table tr").should("have.length", 1);

// ✅ Good - wait for aliased route explicitly
cy.intercept("GET", "/users", [{ name: "Maggy" }]).as("getUsers");
cy.get('[data-testid="fetch-users"]').click();
cy.wait("@getUsers");
cy.get("table tr").should("have.length", 1);
```

### ❌ Coupling Tests Together

```typescript
// ❌ Bad - tests depend on each other
it("visits page", () => cy.visit("/form"));
it("fills name", () => cy.get("#name").type("John")); // Fails alone!
it("submits", () => cy.get("form").submit()); // Fails alone!

// ✅ Good - each test is independent
it("submits form", () => {
  cy.visit("/form");
  cy.get("#name").type("John");
  cy.get("form").submit();
});
```

### ❌ Using afterEach for Cleanup

```typescript
// ❌ Bad - won't run if test fails or is interrupted
afterEach(() => {
  cy.logout();
  cy.resetDb();
});

// ✅ Good - cleanup before tests
beforeEach(() => {
  cy.resetDb();
});
```

### ❌ Assigning Commands to Variables

```typescript
// ❌ Bad - commands are not synchronous
const button = cy.get("button");
button.click();

// ✅ Good - use aliases
cy.get("button").as("btn");
cy.get("@btn").click();
```

### ❌ Brittle Selectors

```typescript
// ❌ Bad - coupled to CSS
cy.get(".btn-primary-large").click();
cy.get("#submit-btn").click();

// ✅ Good - isolated from styling
cy.get('[data-eid*="submit"]').click();
cy.contains("button", "Submit").click();
```

### ❌ Visiting External Sites

```typescript
// ❌ Bad - don't visit sites you don't control
cy.visit("https://google.com/oauth");

// ✅ Good - use API for third-party interactions
cy.request("POST", "https://api.example.com/oauth/token");
```

### ❌ Many Tiny Tests

```typescript
// ❌ Bad - excessive test overhead
it("has attr", () => cy.get("#el").should("have.attr", "x"));
it("has class", () => cy.get("#el").should("have.class", "y"));
it("has value", () => cy.get("#el").should("have.value", "z"));

// ✅ Good - combine assertions
it("element has correct state", () => {
  cy.get("#el")
    .should("have.attr", "x")
    .and("have.class", "y")
    .and("have.value", "z");
});
```

### Summary Checklist

| Anti-Pattern                | Best Practice                     |
| --------------------------- | --------------------------------- |
| `cy.wait(5000)`             | `cy.wait('@aliasedRoute')`        |
| Dependent tests             | Independent tests with beforeEach |
| `afterEach` cleanup         | `beforeEach` cleanup              |
| `const x = cy.get()`        | `cy.get().as('x')`                |
| `.btn-class` selectors      | `[data-eid="x"]` selectors        |
| `cy.visit('external-site')` | `cy.request('external-api')`      |
| Many single-assertion tests | Combined assertions               |
