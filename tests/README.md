# E2E Tests

Playwright-based end-to-end tests for Airo App Builder.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all tests (headless) - defaults to test environment
npx playwright test

# Run tests with browser visible
npx playwright test --headed

# Run specific test file
npx playwright test develop-publish.spec.ts --headed

# Run against different environments
PLAYWRIGHT_BASE_URL=https://airo-builder.test-godaddy.com npx playwright test --headed  # test
PLAYWRIGHT_BASE_URL=https://airo-builder.dev-godaddy.com npx playwright test --headed   # dev
PLAYWRIGHT_BASE_URL=https://airo-builder.godaddy.com npx playwright test --headed       # prod
```

## Environment Setup

Create `tests/.env` with test credentials:

```env
TEST_USERNAME=your-test-username@example.com
TEST_PASSWORD=your-test-password
```

In CI, credentials are fetched from AWS Secrets Manager automatically.

## Test Files

| File                      | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `apps-page.spec.ts`       | Apps page, navigation, homepage input validation          |
| `authentication.spec.ts`  | Login/logout flows, session persistence, protected routes |
| `develop-chat.spec.ts`    | Develop page components, chat, preview, header elements   |
| `develop-publish.spec.ts` | AI agent auto-publish flow, Go Live modal verification    |

## Test Strategy

### Single-Flow Pattern

Tests are structured as single flows to minimize:

- Redundant logins
- Redundant app creations
- Browser context switches

Each test file creates one app and runs all assertions sequentially.

### AI Agent Auto-Actions

Some tests leverage AI agent capabilities:

- `develop-publish.spec.ts` - Instructs AI to auto-publish via prompt
- No manual button clicks needed for publish flow

### Handling UX Core Components

Tests handle common UX Core overlays that can block interactions:

- **Coachmark tours** (`.ux-coachmark`) - Dismissed via Escape key
- **Backdrop overlays** (`.ux-disrupt-backdrop`) - Dismissed via Escape key
- **Go Live modal** (`[data-testid="go-live-modal-skip"]`) - Success indicator after publish

## Directory Structure

```
tests/
├── fixtures/
│   └── test-fixtures.ts    # Authenticated/unauthenticated page contexts
├── helpers/
│   ├── api.ts              # API utilities (delete sites, poll deployment)
│   ├── auth.ts             # SSO login handling
│   ├── constants.ts        # Timeouts and test prefixes
│   └── ui.ts               # UI helpers (wait for page, chat input)
├── smoke/
│   └── *.spec.ts           # Test specifications
├── .env                    # Local test credentials (git-ignored)
├── tsconfig.json           # TypeScript config for tests
└── README.md               # This file
```

## Helpers

### Auth (`helpers/auth.ts`)

```typescript
import { handleSsoLogin } from "../helpers/auth";

// Handles SSO login (iframe modal or redirect)
await handleSsoLogin(page);
```

### API (`helpers/api.ts`)

```typescript
import { deleteAllSitesViaAPI } from "../helpers/api";

// Cleanup test sites
await deleteAllSitesViaAPI(page);
```

### UI (`helpers/ui.ts`)

```typescript
import { waitForDevelopPage, waitForChatInput } from "../helpers/ui";

// Wait for develop page to fully load
await waitForDevelopPage(page);

// Wait for chat input to be available (AI finished)
await waitForChatInput(page);
```

### Constants (`helpers/constants.ts`)

```typescript
import {
  LONG_TIMEOUT,
  DEFAULT_TIMEOUT,
  CHAT_INPUT_TIMEOUT,
} from "../helpers/constants";

// LONG_TIMEOUT = 120000ms (2 min) - App creation
// DEFAULT_TIMEOUT = 30000ms (30s) - Standard operations
// CHAT_INPUT_TIMEOUT = 60000ms (1 min) - AI responses
```

## Running in CI

Tests run via GitHub Actions workflow (`.github/workflows/playwright-e2e.yml`):

```bash
# Triggered manually or after promotion
# Environments: test, dev, prod
```

Artifacts uploaded on failure:

- Screenshots
- Videos
- HAR files (network traces)

## Debugging

### View test report

```bash
npx playwright show-report
```

### Debug mode

```bash
npx playwright test --debug
```

### Trace viewer

```bash
npx playwright test --trace on
npx playwright show-trace test-results/*/trace.zip
```

## Writing New Tests

1. Use single-flow pattern (one test, multiple assertions)
2. Leverage AI agent for complex actions when possible
3. Handle coachmark/overlay dismissal
4. Clean up created apps in `afterEach`
5. Use helpers for common operations

### Example

```typescript
import { test, expect } from "@playwright/test";
import { handleSsoLogin } from "../helpers/auth";
import { deleteAllSitesViaAPI } from "../helpers/api";
import { waitForDevelopPage, waitForChatInput } from "../helpers/ui";
import { LONG_TIMEOUT } from "../helpers/constants";

test.describe("My Feature", () => {
  test("complete flow", async ({ page }) => {
    // Step 1: Create app
    await page.goto("/");
    await page.getByTestId("homepage-prompt-input").fill("Create a simple app");
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);

    // Step 2: Wait for develop page
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await waitForChatInput(page);

    // Step 3: Verify something
    await expect(page.locator("#preview-iframe")).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    await page.goto("/apps");
    await deleteAllSitesViaAPI(page);
  });
});
```
