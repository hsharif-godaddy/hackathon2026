# E2E Tests

Playwright-based end-to-end tests for Airo App Builder.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run E2E critical path test (fast, ~10 min)
pnpm test:e2e --project=e2e

# Run the split + parallel-safe successor (~5–10 min, 4 workers)
pnpm test:e2e --project=e2e-v2

# Run full regression suite (~30+ min)
pnpm test:e2e --project=regression

# Run all tests (E2E + regression)
pnpm test:e2e

# Run specific regression test
pnpm test:e2e --project=regression "authentication.spec.ts"

# Run with browser visible
pnpm test:e2e --project=e2e --headed

# Run against different environments via the --env flag. The pnpm script
# wraps `playwright test` and resolves baseURL + credentials from
# tests/helpers/constants.ts. Every other Playwright flag (--project,
# --headed, --grep, spec paths, ...) is forwarded unchanged.
pnpm test:e2e --env=local --project=e2e --headed   # https://local.gasket.dev-godaddy.com:8443
pnpm test:e2e --env=dev   --project=e2e --headed   # https://airo-builder.dev-godaddy.com
pnpm test:e2e --env=test  --project=e2e --headed   # https://airo-builder.test-godaddy.com
pnpm test:e2e --env=prod  --project=e2e --headed   # https://airo-builder.godaddy.com

# Equivalent direct invocation of the wrapper script (skips the pnpm hop)
./scripts/e2e.sh --env=prod --project=e2e --headed

# Equivalent env-var form, bypassing the wrapper. PLAYWRIGHT_ENV drives
# both URL and which *_USERNAME/*_PASSWORD pair getCredentials() reads.
# PLAYWRIGHT_BASE_URL still wins as an explicit override.
PLAYWRIGHT_ENV=prod pnpm exec playwright test --project=e2e --headed

# Preserve apps after the run instead of cleaning them up (useful when
# iterating locally and inspecting the result in the UI). --no-delete is
# defaulted ON for --env=local and --env=dev; pass --delete to force
# cleanup on a local run.
pnpm test:e2e --env=prod  --project=e2e --no-delete   # debug a prod-only failure without losing the app
pnpm test:e2e --env=local --project=e2e --delete      # force cleanup locally
```

## Environment Setup

Create `tests/.env` with test credentials. For local dev, a single generic
pair works for every `--env` target (the `environments` map in
`tests/helpers/constants.ts` only requires env-specific vars when the generic
fallback isn't set):

```env
E2E_USERNAME=your-username@example.com
E2E_PASSWORD=your-password
```

> **Why `E2E_*` and not `USERNAME`/`PASSWORD`?** `process.env.USERNAME` is set
> by the OS to the current login name on Linux/macOS — including GitHub
> Actions runners, where it's `runner` — and would silently override anything
> you put in `tests/.env`, producing a confusing SSO failure with no obvious
> cause. The `E2E_` prefix is collision-safe.

If you need different credentials per environment (rare locally, standard in
CI), set the env-specific pair instead — they take precedence over the
generic fallback:

```env
LOCAL_USERNAME=...
LOCAL_PASSWORD=...
DEV_USERNAME=...
DEV_PASSWORD=...
TEST_USERNAME=...
TEST_PASSWORD=...
PROD_USERNAME=...
PROD_PASSWORD=...
```

In CI, credentials are fetched from AWS Secrets Manager and injected as the
env-specific vars automatically.

## Directory Structure

```
tests/
  e2e/
    e2e.spec.ts                      # Consolidated single-app critical path (legacy, single worker)
  e2e-v2/                            # Split + parallel-safe successor (see "E2E v2" below)
    create-flow.spec.ts              # Homepage submit → SSO → develop redirect (1 test, serial)
    develop-ui.spec.ts               # Read-only develop-page UI checks (parallel within file)
    chat-send.spec.ts                # Chat send via Enter + send-button (serial within file)
    publish-and-domain.spec.ts       # Auto-publish + custom domain + reload (serial within file)
  regression/
    authentication.spec.ts           # Login/logout, session, protected routes
    apps-page.spec.ts                # Apps listing, navigation, homepage validation
    develop-chat.spec.ts             # Develop page, chat, preview, header
    develop-publish.spec.ts          # AI auto-publish, Pre-Launch SEO
    develop-edit-interactions.spec.ts # Color scheme, edit mode, code search
    develop-media.spec.ts            # Media tab, image grid, Getty alternatives
    develop-brand-book.spec.ts       # Brand Book tab
    develop-archive-restore.spec.ts  # Cold archive restore UX
  fixtures/
    test-fixtures.ts                 # Authenticated/unauthenticated page contexts
  helpers/
    api.ts                           # API utilities (delete sites, poll deployment)
    auth.ts                          # SSO login handling
    constants.ts                     # Timeouts and test prefixes
    ui.ts                            # UI helpers (wait for page, chat input)
  reporters/
    elasticsearch-reporter.ts        # ES indexing for test result tracking
  .env                               # Local test credentials (git-ignored)
  tsconfig.json                      # TypeScript config for tests
  README.md                          # This file
```

## Test Suites

### E2E (Critical Path)

A single test that creates ONE app and exercises all critical features sequentially:

1. Homepage + SSO Login + App Creation
2. Verify develop page components (header, preview, chat)
3. Preview controls (refresh, device selector) + auto-publish verification
4. Chat input states (disabled/enabled, multi-line)
5. Send message via send button click
6. Send message via Enter key
7. Color scheme preview
8. Edit mode toggle
9. Code view + unified search
10. Publish button verification
11. Page refresh recovery

Use this for: post-deploy validation, CI, quick smoke checks. Brand Book lives
in the regression suite (`develop-brand-book.spec.ts`) because it's gated by
the `appbuilder-brandbook` switchboard flag and isn't enabled for every prod
account.

### E2E v2 (Split + Parallel)

Same coverage as the legacy E2E suite, split into 4 spec files under
`tests/e2e-v2/` that run with file-level parallelism (4 workers).

App strategy: the read-only and publish specs share **long-lived pool apps**
(`[e2e-pool:<purpose>]`) instead of creating an app per run. The pool ids are
resolved **once per run** by the `pool-resolve` setup project (an `e2e-v2`
dependency) and read from an on-disk cache (`tests/.pool-cache.json`) in each
spec's `beforeAll` — no per-spec `GET /api/sites`. Pool apps are created by the
`bootstrap-pool` project (idempotent). `create-flow` and `chat-send` still
drive a real homepage submit (cold-start coverage / transcript mutation).

| File | Coverage | Concurrency | App strategy |
| --- | --- | --- | --- |
| `create-flow.spec.ts` | Homepage submit → SSO → develop redirect | serial, 1 worker | UI-create per test, deleted by ID |
| `develop-ui.spec.ts` | Read-only develop-page UI (header, preview controls, chat input states, edit mode, code view, publish-button state, manual feedback) | parallel within file | shared `[e2e-pool:develop-ui]` pool app, cached id in `beforeAll` |
| `chat-send.spec.ts` | Chat send via Enter + send-button | serial within file | own homepage submit in `beforeAll` |
| `publish-and-domain.spec.ts` | Default `*.ai` publish verification, custom-domain attach/disconnect, page-reload recovery | serial within file | shared pre-published `[e2e-pool:publish-domain]` pool app, cached id in `beforeAll` |

**First-time setup (per env / new shopper):** the pool apps must exist before
running e2e-v2. Bootstrap is idempotent (cheap when they already exist; pays a
one-time create + auto-publish on a fresh shopper):

```bash
pnpm exec playwright test --project=bootstrap-pool --env=test
pnpm exec playwright test --project=e2e-v2 --env=test
```

CI runs `bootstrap-pool` automatically before `e2e-v2` (see
`.github/workflows/playwright-e2e-v2.yml`), so a fresh CI shopper self-seeds.

> **INVARIANT — `develop-ui.spec.ts` is read-only.** Tests in that file
> share one server-side app across parallel browser contexts (different
> SSO sessions, same app row). Allowed: navigating, reading, opening
> modals (Escape-close), clearing the chat input. Forbidden: sending
> chat messages, publishing, attaching domains, archiving. New tests
> added there must verify they don't mutate persistent state, or move to
> a file that owns its own app.

`scripts/e2e.sh` exports `PLAYWRIGHT_E2E_WORKERS=4` automatically when
`--project=e2e-v2` is passed. Override with
`PLAYWRIGHT_E2E_WORKERS=N pnpm test:e2e --project=e2e-v2 --env=...` (or
the `./scripts/e2e.sh` form) to force a different worker count — useful
for reproducing parallel-only flakes serially.

```bash
# All four files in parallel (4 workers)
pnpm test:e2e --project=e2e-v2 --env=dev

# One file
pnpm test:e2e --project=e2e-v2 --env=dev tests/e2e-v2/develop-ui.spec.ts

# One test inside a file
pnpm test:e2e --project=e2e-v2 --env=dev -g "Edit mode toggle"

# Force serial for debugging
PLAYWRIGHT_E2E_WORKERS=1 pnpm test:e2e --project=e2e-v2 --env=dev
```

> **Migration overlap.** `tests/e2e-v2/` ships **alongside** the legacy
> `tests/e2e/e2e.spec.ts`. CI still runs the legacy `e2e` project as the
> canonical signal until a follow-up PR flips it to `e2e-v2`; the legacy
> file is removed in a third PR after the new shape stabilizes (~1–2
> weeks of green CI). **During this overlap, any UI change with
> `data-testid` impact must be reflected in BOTH `tests/e2e/e2e.spec.ts`
> AND the relevant `tests/e2e-v2/*.spec.ts`.**

### Regression (Full Suite)

Individual spec files covering each feature area in depth. Includes skipped tests for features under development or with known CI issues (media tab, archive restore, etc.).

Use this for: nightly runs, thorough pre-release validation, debugging specific features.

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
- `e2e.spec.ts` - Same auto-publish approach
- No manual button clicks needed for publish flow

### Handling UX Core Components

Tests handle common UX Core overlays that can block interactions:

- **Coachmark tours** (`.ux-coachmark`) - Dismissed via Escape key
- **Backdrop overlays** (`.ux-disrupt-backdrop`) - Dismissed via Escape key
- **Go Live modal** - Success indicator after publish

## Helpers

### Auth (`helpers/auth.ts`)

```typescript
import { handleSsoLogin } from "../helpers/auth";

// Handles SSO login (iframe modal or redirect)
await handleSsoLogin(page);
```

### API (`helpers/api.ts`)

```typescript
import {
  deleteAppsWithPrefix,
  evictOldestE2eAppsToFitLimit,
} from "../helpers/api";
import { getSpecPrefix } from "../helpers/constants";

// Per-spec cleanup: only delete apps THIS spec created.
await deleteAppsWithPrefix(page, getSpecPrefix("my-spec"));

// Pre-flight guard: evict oldest e2e-tagged apps if the account is near
// the mgmt-airo "Maximum N apps per system" cap (no-op below threshold).
await evictOldestE2eAppsToFitLimit(page);
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

- **Every 2 hours (prod):** Runs E2E critical path test
- **Post-deploy (test):** Runs E2E critical path test
- **Manual dispatch:** Choose e2e, regression, all, or individual spec

Artifacts uploaded on failure:

- Screenshots
- Videos
- HAR files (network traces)

## Elasticsearch Reporting

Test results are automatically indexed to Elasticsearch when `ES_URL` is configured.

### Configuration

Set these environment variables (in `tests/.env` for local, or as CI secrets):

```env
ES_URL=https://your-elasticsearch-instance:9200
ES_API_KEY=your-api-key          # Option 1: API key auth
ES_USERNAME=your-username         # Option 2: Basic auth
ES_PASSWORD=your-password
```

### Index

A single consolidated document is indexed to `playwright-e2e-results` per run:

- `success` (boolean), `status` - overall run outcome
- `totalTests`, `passed`, `failed`, `skipped` - test counts
- `duration`, `durationSeconds`, `durationMinutes` - timing metrics
- `environment`, `baseUrl`, `projectName` - target environment
- CI/CD context (`gitSha`, `gitBranch`, `runId`, `runUrl`, `actor`, etc.)

## Debugging

### View test report

```bash
pnpm exec playwright show-report
```

### Debug mode

```bash
pnpm test:e2e --project=e2e --debug
```

### Trace viewer

```bash
pnpm test:e2e --project=e2e --trace on
pnpm exec playwright show-trace test-results/*/trace.zip
```

## Writing New Tests

1. Add new feature tests to `tests/regression/` as individual spec files
2. Use single-flow pattern (one test, multiple assertions)
3. Leverage AI agent for complex actions when possible
4. Handle coachmark/overlay dismissal
5. Clean up created apps in `afterEach`
6. Use helpers for common operations
7. If the feature is critical, add it to **both** `tests/e2e/e2e.spec.ts` (as a step) **and** the relevant `tests/e2e-v2/*.spec.ts` while the migration overlap is in effect. Decision tree for which v2 file:
   - Tests the homepage UI flow itself? → extend `tests/e2e-v2/create-flow.spec.ts`
   - Read-only verification of develop-page UI, no app state changes? → add to `tests/e2e-v2/develop-ui.spec.ts` (must satisfy the no-mutation invariant)
   - Sends chat messages or otherwise mutates transcript? → add to `tests/e2e-v2/chat-send.spec.ts`
   - Touches publish, deploy, or domain state? → add to `tests/e2e-v2/publish-and-domain.spec.ts`
   - None of the above? → new file in `tests/e2e-v2/`, follow the same `beforeAll` API-create + `afterAll` ID-delete pattern

### Example

```typescript
import { test, expect } from "@playwright/test";
import { handleSsoLogin } from "../helpers/auth";
import {
  deleteAppsWithPrefix,
  evictOldestE2eAppsToFitLimit,
} from "../helpers/api";
import { waitForDevelopPage, waitForChatInput } from "../helpers/ui";
import { LONG_TIMEOUT, getSpecPrefix } from "../helpers/constants";

/** Spec prefixes used by `getSpecPrefix(...)` calls below. Keep in sync with
 *  every prompt that tags an app, otherwise per-spec cleanup will leak it. */
const SPEC_PREFIXES = ["my-spec"] as const;

test.describe("My Feature", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-flight guard: evict oldest e2e-tagged orphans if account is near cap.
    await page.goto("/");
    await evictOldestE2eAppsToFitLimit(page).catch(() => {});
  });

  test("complete flow", async ({ page }) => {
    // Step 1: Create app — tag the prompt so cleanup can find it later.
    await page.goto("/");
    await page
      .getByTestId("homepage-prompt-input")
      .fill(`${getSpecPrefix("my-spec")} Create a simple app`);
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
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });
});
```
