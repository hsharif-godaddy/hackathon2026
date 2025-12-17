# Airo Builder E2E Tests

End-to-end testing suite for Airo Builder using Cypress and Testla.

## Framework Selection: Cypress vs Playwright

### Default: Use Cypress with Testla

**Always prefer Cypress for new tests** it is the company approved testing frame and it integrates with Testla for scheduled runs, reporting, and CI/CD.

### When to Use Playwright

Use Playwright only when necessary instead of Cypress for tests that require:

| Scenario                     | Why Playwright                                     |
| ---------------------------- | -------------------------------------------------- |
| **WebSocket testing**        | Better support for intercepting/mocking WebSockets |
| **Complex iframe testing**   | Native cross-origin iframe support                 |
| **Multiple browser windows** | Native multi-page/context support                  |
| **Safari/WebKit testing**    | Cypress doesn't support Safari                     |
| **Complex mobile emulation** | More accurate device emulation                     |
| **Chat/real-time features**  | WebSocket-heavy features need Playwright           |

### Adding Playwright Tests

When Cypress cannot support a test case:

1. Create the Playwright test in the project's Playwright test directory
2. **Ensure it's added to the scheduled Playwright runs** (not Testla)
3. Document why Playwright was chosen over Cypress in the test file

```typescript
/**
 * @framework Playwright
 * @reason WebSocket testing for real-time chat features
 */
```

> **Testla v2 Coming Soon:** The Testla team is developing Testla v2 which will support all E2E frameworks. Once released, Playwright tests can also be managed through Testla.

## Testla Infrastructure: Fargate

Tests run on **AWS Fargate** instead of OpenStack. This is required because:

- The develop page preview loads content from `*.preview.c24.airoapp.ai`
- These preview servers are on internal GoDaddy infrastructure
- OpenStack VMs cannot reach these endpoints (network/DNS limitations)
- Fargate has the necessary network access to internal services

## Project Structure

```
e2e/
├── cypress/
│   ├── config/
│   │   └── base.ts           # Shared Cypress configuration
│   ├── support/
│   │   ├── commands.ts       # Custom Cypress commands
│   │   ├── e2e.ts            # Global setup (auth, hooks)
│   │   └── utils/
│   │       └── helpers.ts    # Utility functions
│   ├── tests/                # Test files (*.cy.ts)
│   │   └── core-navigation.cy.ts # Core navigation tests
│   └── tsconfig.json         # TypeScript config for Cypress
├── .env                      # Local credentials (git-ignored)
├── .gitignore
├── cypress.config.ts         # Unified Cypress config (uses CYPRESS_ENV)
├── E2E_TESTING_GUIDELINES.md # Test writing best practices
├── package.json
├── reporter.json             # Multi-reporter configuration
└── testla.json               # Testla CLI configuration
```

## Environment Configuration

The project uses a **single Cypress config file** (`cypress.config.ts`) that reads the `CYPRESS_ENV` environment variable to determine which environment to target.

| CYPRESS_ENV | Base URL                                |
| ----------- | --------------------------------------- |
| `dev`       | `https://airo-builder.dev-godaddy.com`  |
| `test`      | `https://airo-builder.test-godaddy.com` |
| `prod`      | `https://airo-builder.godaddy.com`      |

**Default:** If `CYPRESS_ENV` is not set, it defaults to `prod`.

## Setup

### Install Dependencies

```bash
cd e2e
npm install
```

### Local Development Credentials

Create a `.env` file in the `e2e/` directory:

```env
USERNAME=your_sso_username
PASSWORD=your_sso_password
```

> **Note:** The `.env` file is git-ignored and only used for local development.

## Running Tests

### Local Development

#### Interactive Mode (Cypress UI)

```bash
# Dev environment
npm run cypress:open:dev

# Test environment
npm run cypress:open:test

# Production environment (default)
npm run cypress:open:prod
```

#### Headless Mode

```bash
# Dev environment
npm run cypress:run:dev

# Test environment
npm run cypress:run:test

# Production environment (default)
npm run cypress:run:prod
```

#### Using CYPRESS_ENV directly

You can also set `CYPRESS_ENV` directly:

```bash
CYPRESS_ENV=test cypress run
CYPRESS_ENV=dev cypress open
```

### Running with Testla

```bash
# Dev environment
npm run testla:dev

# Test environment
npm run testla:test

# Production environment
npm run testla:prod
```

### Testla Dashboard

View test results, manage test runs, and monitor test health on the [Airo Builder Testla Dashboard](https://testla.int.gdcorp.tools/project-details?orgId=1&productId=75&projectId=26202).

### Updating Cached Tests in Testla

The tests that are cached in Testla can be updated by running the following command locally from the `e2e/` directory:

```bash
npm run testla:upload
```

Or using the testla CLI directly:

```bash
npx testla cache-and-import-local-files --config-file ./testla.json --cypress-config ./cypress.config.ts
```

> **Note:** This command will open a verification page in your browser with the URL `https://ssojwt.gdcorp.tools/authorize/callback`. Follow the steps in your terminal to complete the verification process.

Once the command is completed, the tests will be updated in the Testla UI.

## Adding New Tests

### 1. Create a Test File

Create a new file in `cypress/tests/` with the `.cy.ts` extension:

```typescript
// cypress/tests/my-feature.cy.ts

describe("My Feature", () => {
  it("should do something", () => {
    // Test is already authenticated via global before() hook
    // and visits the baseUrl via beforeEach() hook

    cy.get('[data-testid="my-element"]').should("be.visible");
    cy.get("button").click();
    cy.url().should("include", "/expected-path");
  });

  it("should handle another scenario", () => {
    // Each test starts fresh on the baseUrl
    cy.contains("Expected Text").should("exist");
  });
});
```

### 2. Test File Naming Convention

- Use descriptive names: `user-authentication.cy.ts`, `project-creation.cy.ts`
- Group related tests in the same file using `describe` blocks
- Use `data-testid` attributes for reliable element selection

### 3. Authentication

Authentication is handled automatically in `cypress/support/e2e.ts`:

- **`before()`**: Logs in once per test run using `cy.session()`
- **`beforeEach()`**: Visits the `baseUrl` before each test

You don't need to handle login in individual tests.

## Allowlisting New Test Accounts

This project uses `@gd-cypress/auth` which authenticates via the `/v1/api/token` endpoint (not certificate-based auth). This means:

- ✅ No client certificate maintenance required
- ⚠️ Test shoppers must be allowlisted by the SSO team

### How to Allowlist a New Shopper

To use a new shopper account for E2E testing in Testla, you must request the SSO team to allowlist it for heartbeat authentication:

1. **Contact the SSO team** via the [#sso Slack channel](https://godaddy.slack.com/archives/C04BJ6SJA)

2. **Request allowlisting** for:
   - The shopper account (shopperId)
   - Heartbeat authentication access

3. **Example request format:**

   ```
   Hi SSO team,

   We need to allowlist a shopper account for E2E testing with heartbeat auth.

   - Shopper username: [username]
   - Purpose: Automated E2E testing for Airo Builder
   - Auth method: /v1/api/token (via @gd-cypress/auth package)

   Thank you!
   ```

4. **Wait for confirmation** before using the account in tests

> **Note:** Each test environment (test, prod) may require separate allowlisting if using different shopper accounts.

### 4. Custom Commands

Add reusable commands in `cypress/support/commands.ts`:

```typescript
Cypress.Commands.add("myCustomCommand", (arg1: string) => {
  // Custom logic here
});
```

Then use in tests:

```typescript
cy.myCustomCommand("value");
```

### Testla Environment Variables

Each environment config expects credentials in the format:

- `{ENV}_USERNAME` (e.g., `TEST_USERNAME`, `PROD_USERNAME`)
- `{ENV}_PASSWORD` (e.g., `TEST_PASSWORD`, `PROD_PASSWORD`)

For local development, you can use generic `USERNAME`/`PASSWORD` in `.env`.

## Testla Secrets Management

### Updating Secrets

To update test credentials in Testla:

1. Go to the [Testla Secrets Manager](https://testla.int.gdcorp.tools/secrets-manager?orgId=1&productId=75&projectId=26202)

2. For each environment, add key-value pairs in the respective testCredentials or prodCredentials secrets object:

   | Environment | Key             | Value        |
   | ----------- | --------------- | ------------ |
   | Test        | `TEST_USERNAME` | SSO username |
   | Test        | `TEST_PASSWORD` | SSO password |
   | Prod        | `PROD_USERNAME` | SSO username |
   | Prod        | `PROD_PASSWORD` | SSO password |

> **Important:** Testla does not display saved secrets. To update a secret, you must re-add it with the new value. There is no "edit" functionality.

### Secret Naming Convention

```
{ENVIRONMENT}_USERNAME
{ENVIRONMENT}_PASSWORD
```

Where `{ENVIRONMENT}` is uppercase: `TEST`, or `PROD`.

## Test Reports

Test reports are generated in `test-results/`:

- **Mochawesome**: HTML/JSON reports in `test-results/mochawesome/`
- **JUnit**: XML reports in `test-results/junit/`
- **Screenshots**: Failure screenshots in `test-results/screenshots/`
- **Videos**: Test run videos in `test-results/videos/`

## Troubleshooting

### React Hydration Errors

React hydration errors (#418, #423, #425) are automatically ignored in `cypress/support/e2e.ts`. These are common in SSR/Next.js apps and don't affect test functionality.

### Cannot Find Module Errors

If Testla reports "Cannot find module" errors, ensure the module's directory is included in `testla.json` `paths` array.

### Authentication Failures

1. Verify credentials are correct in `.env` (local) or Testla secrets (CI)
2. Check the environment variable names match the expected format
3. Ensure `@gd-cypress/auth` tasks are registered in `setupNodeEvents`

### Tests Not Found

Ensure test files:

- Are in `cypress/tests/` directory
- Have `.cy.ts` extension
- Match the glob pattern in `testla.json`: `^.*\\.cy\\.ts$`

## Dependencies

| Package                   | Purpose                     |
| ------------------------- | --------------------------- |
| `cypress`                 | E2E testing framework       |
| `@testla/testla-cli`      | Testla integration          |
| `@gd-cypress/auth`        | SSO authentication tasks    |
| `dotenv`                  | Local environment variables |
| `cypress-multi-reporters` | Multiple report formats     |
| `mochawesome`             | HTML test reports           |
| `mocha-junit-reporter`    | JUnit XML reports           |
| `typescript`              | TypeScript support          |
