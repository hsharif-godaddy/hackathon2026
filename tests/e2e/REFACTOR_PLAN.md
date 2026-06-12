# E2E Test Refactor — Phase 1: Split + `quick-create` (parallel directory)

> **Branch**: `refactor/e2e-split-and-quick-create`
> **Strategy**: build new shape in `tests/e2e-v2/` alongside existing `tests/e2e/e2e.spec.ts`. Old monolith stays as the canonical CI signal until the new shape is proven; CI flip and monolith deletion ship as separate follow-up PRs.
> **PR scope**: 1 of 6 planned (subsequent PRs listed under "Future PRs")

## Goal

Build a parallel `tests/e2e-v2/` directory containing 4 parallel-safe spec files that split the monolithic e2e test, replace homepage-UI app creation with the `POST /api/sites/quick-create` API where the homepage flow itself isn't under test, and add a new `e2e-v2` Playwright project that runs them with file-level parallelism. The existing `e2e` project and `tests/e2e/e2e.spec.ts` are **not modified** — CI keeps running the monolith. Once the new shape is validated locally and via manual CI runs, a separate follow-up PR flips the GitHub Actions workflow to `--project=e2e-v2`; a third PR deletes the monolith after a stabilization window.

Wall-clock target for the v2 path: ~15 min → **5–7 min best case, 8–10 min realistic** — the publish-and-domain `beforeAll` can still hit `PUBLISH_TIMEOUT_MS` on slow auto-publish runs, so don't promise sub-7-minute consistency.

## Migration strategy

Three sequential PRs replace today's single PR:

1. **PR 1 (this PR)** — add `tests/e2e-v2/` + helpers + new `e2e-v2` Playwright project. No changes to `tests/e2e/` or to the existing `e2e` Playwright project. CI behavior is unchanged; v2 runs locally via `pnpm test:e2e --project=e2e-v2 --env=dev` and via manual CI dispatch.
2. **PR 1.5 (follow-up, after PR 1 is validated)** — flip the GitHub Actions workflow to `--project=e2e-v2`. Old `e2e` project stays in the repo, runnable on demand. Monolith stays.
3. **PR 1.6 (cleanup, after ~1–2 weeks of green CI on v2)** — delete `tests/e2e/e2e.spec.ts` and the `e2e` Playwright project entry.

**Duplicate-maintenance window**: Between PR 1 and PR 1.6, any UI change with `data-testid` impact needs updates in both `tests/e2e/e2e.spec.ts` and the relevant `tests/e2e-v2/*.spec.ts`. Add a note to the new directory's README and to the project's CLAUDE.md guidance for the duration. Keep the stabilization window short (1–2 weeks of green daily runs) so this burden doesn't drag.

## Background — what's wrong with the current shape

`tests/e2e/e2e.spec.ts` runs 12 sequential `test.step()` blocks against a single app, all wrapped in one Playwright `test()`. Failures attribute by step (good) but workers can't parallelize within a `test()` (bad), so `playwright.config.ts` is pinned to `workers: 1`.

Dominant time costs in the current shape:

| Phase | Wall-clock cost | Where |
|---|---|---|
| Homepage hydration (fixed wait) | 10s | Step 1, line 129 |
| SSO + redirect to develop | ~30s | Step 1 |
| Initial AI generation | ~30–45s | Step 3 prerequisite |
| Auto-publish wait | 2–10 min | Step 3 |
| Two send-message AI roundtrips | ~60s | Steps 5, 6 |
| Custom-domain attach + DNS render | ~60s | Step 11 |
| Custom-domain disconnect | ~30s | Step 11 |
| Per-step setup waits | ~30–60s × 12 | All steps |

Most of those costs are unavoidable per-app — but they're paid **serially**. Splitting + parallel workers + sharing one app across read-only tests collapses the wall clock without losing coverage.

## File-level plan

### Helpers (modified)

#### `tests/helpers/api.ts` — two new exports + one hardened existing helper

```ts
/**
 * Create a site via POST /api/sites/quick-create.
 * Returns the resolved real site ID (handles type:'job' → site polling
 * internally via waitForJobResolution). Does NOT wait for AI generation
 * or preview readiness — the spec is responsible for that via
 * waitForDevelopPage / expectPublishSuccessVisible / etc.
 */
export async function createSiteViaApi(page: Page, prompt: string): Promise<string>

/**
 * Poll GET /api/sites?site_id=<jobId> until the response shows a real
 * site ID (not the job ID). NOT the same shape as pollDeploymentStatus —
 * that helper polls deployment lifecycle status; this one polls the
 * site-creation job→site transition.
 *
 * Phase 0 sub-step verifies the actual API response shape against
 * mgmt-airo before this is relied on.
 */
export async function waitForJobResolution(page: Page, jobId: string): Promise<string>
```

**Existing `deleteApp(page, appId)` (api.ts:43-62) is hardened, not replaced**: it currently returns `false` silently on non-200, which is one of the silent-leak paths flagged in cleanup analysis. The hardened version throws on non-200 with the status code + response body in the error message. All new specs call this hardened helper. We deliberately avoid creating a third DELETE path (the existing helper hits `/api/sites/${id}`; the BFF also accepts `?site_id=` query param — using the existing path for consistency).

### Spec files (new — added under `tests/e2e-v2/`, monolith untouched)

All four spec files live in a new `tests/e2e-v2/` directory. The existing `tests/e2e/e2e.spec.ts` is not modified or removed in this PR.

#### `tests/e2e-v2/create-flow.spec.ts` (~90 lines, 1 test)

**Coverage**: today's Step 1 (homepage submit → SSO → develop redirect → app created).

```ts
test('Homepage submit creates app and lands on develop page', async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000); // 3 min — homepage hydration + SSO + redirect

  // Coachmark suppression — same as monolith line 97-99
  await page.addInitScript(() => {
    localStorage.setItem('airo-intro-tour-shown', 'true');
  });

  await page.goto('/');
  // ... fill homepage prompt, click submit, handle SSO, verify /develop/<id>
  // ... assert preview iframe loaded, chat input present
  // appId captured from URL, deleted in afterEach via hardened deleteApp(page, appId)
});
```

- **App strategy**: UI create + capture appId from URL match + `deleteApp(page, appId)` (hardened) in `afterEach`
- **Concurrency**: 1 worker
- **Why separate**: This is the only spec that should exercise the homepage UI flow + SSO redirect end-to-end. All other specs use the API path.
- **Timeout**: 3 min via `testInfo.setTimeout(180_000)`
- **Env conditionals**: none specific to this file
- **Comments to preserve from monolith**: the rationale for the 10s `waitForTimeout` (lines 122-126) — until a `data-hydrated` marker is added in a follow-up PR, this is the lesser-evil wait; document the reasoning in the new file.

#### `tests/e2e-v2/develop-ui.spec.ts` (~320 lines, 8 parallel tests)

**Coverage**: today's Steps 2, 4, 7, 8, 9, 10 + the preview-controls portion of Step 3 (lines 204–232 of current `e2e.spec.ts`: refresh button, device selector, iPhone SE, full size restore). **Step 12 is NOT in this file** — it lives in `publish-and-domain.spec.ts` so the `?tab=settings` URL-normalization branch (lines 614–622 of current code) actually fires after Step 11 leaves the page on `?tab=settings`. Putting Step 12 here on a fresh app would skip that branch and silently regress coverage.

```ts
/**
 * INVARIANT: Tests in this file MUST NOT mutate persistent app state.
 * They share one server-side app across parallel browser contexts.
 *
 * Allowed: navigating, reading, opening modals (Escape-close), clearing
 * the chat input (Step 4 already does this).
 * Forbidden: sending chat messages, publishing, attaching domains,
 * archiving, etc. Move those to a dedicated file with its own app.
 */

test.describe('Develop page UI', () => {
  let appId: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await ensureAuthenticated(page);
    await page.goto('/'); // needed for evictOldestE2eAppsToFitLimit
    await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    appId = await createSiteViaApi(
      page,
      `${getSpecPrefix('develop-ui')} Simple landing page with a hero section`
    );
    await ctx.close();
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await deleteApp(page, appId);  // hardened — throws on non-200
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    // Coachmark suppression — each parallel test gets a fresh context
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });
    await page.goto(`/develop/${appId}`);
    await waitForDevelopPage(page);
  });

  test('Develop page components render correctly', async ({ page }) => { /* Step 2 */ });
  test('Preview refresh and device selector', async ({ page }) => { /* Step 3 lines 204-232 */ });
  test('Chat input states behave correctly', async ({ page }) => { /* Step 4 */ });
  test('Edit mode toggle works', async ({ page }) => { /* Step 7 — env-gated */ });
  test('Code view loads and unified search works', async ({ page }) => { /* Step 8 — env-gated */ });
  test('Publish button is visible and enabled', async ({ page }) => { /* Step 9 */ });
  test('Manual feedback trigger shows category step', async ({ page }) => { /* Step 10 */ });
});
```

- **App strategy**: eviction guard + API-create in `beforeAll`, hardened `deleteApp` by ID in `afterAll`. All 8 tests share one server-side app via the closured `appId`.
- **Concurrency**: parallel within the file (`fullyParallel: true`, with `PLAYWRIGHT_E2E_WORKERS=4` set in CI for `--project=e2e` only). Each test runs in its own browser context = different SSO session, same server-side app.
- **State concern**: invariant comment block at top of file enforces non-mutation. Step 4 clears the input at end (line 263 in current monolith); Step 10 dismisses modal with Escape. New tests added here MUST verify they don't mutate persistent app state, or move out.
- **Env conditionals (preserved from monolith)**:
  - Edit mode toggle (Step 7): `optionalFeaturesAreRequired` (env === 'prod') makes the selector hard-required; soft-skip on non-prod (lines 89, 307–313).
  - Code view (Step 8): same pattern — hard-required on prod, soft-skip otherwise (lines 343–354).
- **Timeout**: 3 min per test via `testInfo.setTimeout(180_000)`; no global config bump.
- **Comments to preserve from monolith**: edit-mode `role=radio` rationale (lines 300–304), code-view auto-expand-search rationale (lines 336–340), iPhone SE / full size restore comments (lines 218–232).

#### `tests/e2e-v2/chat-send.spec.ts` (~110 lines, 2 serial tests)

**Coverage**: today's Step 5 (send via button click) + Step 6 (send via Enter key).

```ts
test.describe.configure({ mode: 'serial' });

test.describe('Chat send', () => {
  let appId: string;

  test.beforeAll(/* create app via API */);
  test.afterAll(/* delete by ID */);
  test.beforeEach(/* navigate to /develop/<id> */);

  test('Send message via Enter key (default user path)', async ({ page }) => {
    // Inline: chatInput.fill(...) + chatInput.press('Enter') + wait for transcript
  });

  test('Send message via send button (regression guard)', async ({ page }) => {
    // Inline: chatInput.fill(...) + chat-send-button.click() + wait for transcript
  });
});
```

- **App strategy**: eviction guard + API-create in `beforeAll`, hardened `deleteApp` in `afterAll`. Own app because chat sends mutate transcript state — don't share with `develop-ui`.
- **Concurrency**: serial within file (`mode: 'serial'`). Each AI roundtrip mutates the app, so order matters.
- **Why two tests, not one**: Enter is the dominant user behavior; if Lexical's `onKeyDown` regresses, every chat test catches it. The button click is rare in practice but worth a dedicated regression guard.
- **Env conditionals**: coachmark `addInitScript` in `beforeEach`. No other env-gated checks.
- **Timeout**: ~4 min per test via `testInfo.setTimeout(240_000)` for AI generation.
- **Comments to preserve from monolith**: Lexical contenteditable `innerText` rationale (lines 256–258).

> **Note for future**: Once the ChatInterface POM lands (PR 5+), `chat.send(message)` defaults to Enter and `chat.sendViaButton(message)` covers the click path. For PR 1, the calls are inline.

#### `tests/e2e-v2/publish-and-domain.spec.ts` (~340 lines, 3 serial tests)

**Coverage**: today's Step 3 auto-publish verification (the verification half — preview controls moved to `develop-ui`) + Step 11 (custom domain attach + disconnect) + **Step 12 page-reload recovery (moved here from `develop-ui` so the `?tab=settings` URL-normalization branch fires)**.

```ts
test.describe.configure({ mode: 'serial' });

test.describe('Publish and custom domain', () => {
  let appId: string;
  const { env } = getEnvConfig();
  const autoPublishSupported = env !== 'local';

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await ensureAuthenticated(page);
    await page.goto('/');
    await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    appId = await createSiteViaApi(
      page,
      `${getSpecPrefix('publish-domain')} Simple landing page - do not ask follow up questions and publish this app`
    );
    if (autoPublishSupported) {
      await page.goto(`/develop/${appId}`);
      await expectPublishSuccessVisible(page, PUBLISH_TIMEOUT_MS);
    }
    await ctx.close();
  });

  test.afterAll(/* hardened deleteApp by ID */);

  test('Auto-publish completed successfully', async ({ page }, testInfo) => {
    testInfo.setTimeout(PUBLISH_TIMEOUT_MS + 60_000);
    if (!autoPublishSupported) {
      console.log('Auto-publish skipped (local env)');
      return;
    }
    /* Step 3 verification — preview controls now in develop-ui */
  });

  test('Custom domain attach + disconnect (e2e.airotesting.shop)', async ({ page }, testInfo) => {
    testInfo.setTimeout(DEPLOYMENT_TIMEOUT_MS + 120_000);
    /* Step 11 — leaves page on ?tab=settings */
  });

  test('Page reload recovers state (handles ?tab=settings normalization)', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);
    /* Step 12 — reload + ensureAuthenticated + URL normalization
     * Runs AFTER custom-domain-disconnect in serial order, so the
     * page genuinely starts on ?tab=settings (line 614-622 of monolith)
     */
  });
});
```

- **App strategy**: eviction guard + API-create + auto-publish wait in `beforeAll` (gated on `autoPublishSupported`), hardened `deleteApp` in `afterAll`.
- **Concurrency**: serial within file. All three tests mutate state in sequence and Step 12's coverage depends on Step 11 having run first.
- **Env conditionals (preserved from monolith)**:
  - Auto-publish (Step 3): only runs when `env !== 'local'` (line 94, 182–200 of monolith). Local skips the publish wait entirely; the test logs and early-returns.
  - Coachmark `addInitScript` in `beforeEach`.
- **Timeout**: per-test via `testInfo.setTimeout`. The `beforeAll` itself can run up to ~10 min on a slow auto-publish — file timeout (set via `testInfo.setTimeout` or in the test() blocks) needs to accommodate this.
- **Comments to preserve from monolith**: TARGET_DOMAIN regex-escape rationale (lines 532–533), VAT bounce explanation for the reload step (lines 605–611), Custom Domain heading anchored regex rationale (lines 487–493).

### Files NOT deleted in this PR

- `tests/e2e/e2e.spec.ts` — stays as-is. Deleted in a follow-up PR (1.6) after CI has run on `--project=e2e-v2` for ~1–2 weeks without new flakes.
- The existing `e2e` Playwright project entry in `playwright.config.ts` — stays as-is, runnable on demand. Deleted alongside the monolith in PR 1.6.

### Config changes

`playwright.config.ts`: **add a new `e2e-v2` project, no changes to existing projects.**

```diff
+ // e2e-v2: split + parallel-safe successor to the `e2e` project. Runs the
+ // 4-file shape under tests/e2e-v2/. Workers default to 1 locally (matches
+ // the existing e2e project ergonomics); CI / scripts/e2e.sh sets
+ // PLAYWRIGHT_E2E_WORKERS=4 only for `--project=e2e-v2` runs.
+ //
+ // The legacy `e2e` project below is unchanged and continues to be the
+ // canonical CI signal until a follow-up PR flips the workflow to e2e-v2
+ // and a third PR removes the legacy project + tests/e2e/e2e.spec.ts.
+ {
+   name: 'e2e-v2',
+   testDir: 'tests/e2e-v2',
+   use: { ...devices['Desktop Chrome'] },
+ },
```

The new project's worker count is governed by an env var, set on the top-level `workers` field (which Playwright applies per project unless overridden). Easiest shape: leave `workers: 1` as today's default, and have `scripts/e2e.sh` export `PLAYWRIGHT_E2E_WORKERS` when `--project=e2e-v2` is passed. The config reads it via:

```diff
- workers: 1,
+ // Default 1 worker preserves today's behavior for `e2e` and `regression`.
+ // scripts/e2e.sh sets PLAYWRIGHT_E2E_WORKERS=4 ONLY for `--project=e2e-v2`,
+ // which is parallel-safe (each spec creates its own app via the API).
+ workers: process.env.PLAYWRIGHT_E2E_WORKERS
+   ? parseInt(process.env.PLAYWRIGHT_E2E_WORKERS, 10)
+   : 1,
```

The existing `e2e` project's `testMatch` (or directory scoping) is left untouched — a manual `--project=e2e` run still picks up only `tests/e2e/e2e.spec.ts`, since `tests/e2e-v2/` is a separate directory. Verify this assumption: if the existing `e2e` project uses `testDir: 'tests/e2e'` without a `testMatch` filter, it will accidentally pick up `tests/e2e-v2/*` only if the directory is nested under `tests/e2e/`. Keeping `tests/e2e-v2/` as a *sibling* to `tests/e2e/` (not nested) avoids that footgun.

**Global `timeout` is NOT bumped** — per-test timeouts via `testInfo.setTimeout(...)` in each spec (180s for create-flow, 180s per develop-ui test, 240s per chat-send test, `PUBLISH_TIMEOUT_MS + 60s` and `DEPLOYMENT_TIMEOUT_MS + 120s` for the long publish-and-domain tests).

**Do NOT drop the comment block at `playwright.config.ts:73–76`** — the parallel-execution TODO is resolved by `e2e-v2`, not by `e2e`. Update the comment to point readers at the new project instead of removing it. Also leave the existing `e2e` file header comment alone.

`scripts/e2e.sh`: gain a new branch — when invoked with `--project=e2e-v2`, set `PLAYWRIGHT_E2E_WORKERS=4` before delegating to playwright. The existing `--project=e2e` and `--project=regression` paths are unchanged.

`tests/README.md`: add a new section describing the `tests/e2e-v2/` split, the migration sequence (PRs 1 / 1.5 / 1.6), and the duplicate-maintenance reminder. Existing `tests/e2e/` documentation stays.

`tests/e2e-v2/README.md` (new): short file documenting the 4-file shape, the no-mutation invariant on `develop-ui.spec.ts`, and how to run individual files / individual tests.

## What's NOT in this PR (future PRs)

| PR | Change | Estimated effort | Wall-clock improvement |
|---|---|---|---|
| **1.5** | Flip GitHub Actions workflow from `--project=e2e` to `--project=e2e-v2`. Old `e2e` project + monolith stay in repo, runnable on demand. | ~30 min | Realizes the v2 wall-clock improvement in CI. Gated on local + manual-CI validation of v2. |
| **1.6** | Delete `tests/e2e/e2e.spec.ts` and the legacy `e2e` Playwright project entry. Closes the duplicate-maintenance window. | ~30 min | None directly — cleanup. Gated on ~1–2 weeks of green daily CI on v2 with no new flakes. |
| **2** | (removed) ~~`storageState` global setup — single SSO login per CI run~~ | — | We tried this in PR 1 (`tests/e2e-v2/auth.setup.ts`) and it failed: the saved JWT was syntactically valid but Gasket's `pluginAuth` rejected it on `/develop/<id>` navigations because the un-exercised JWT lacks live VAT / customer-context grants that only get minted by an interactive login flow. The e2e-v2 suite now does live SSO per-test (matching the proven venture-agent pattern in `airohq/airo-ai-automation`). Revisiting is possible but would need a deeper audit of which session-bound cookies are required by gd-auth — not a 2-hour change. |
| **3** | Cleanup correctness — drop `afterEach` `page.goto('/apps')`, surface non-200 DELETE responses | ~1 hr | Closes silent leak paths #2, #3, #4. No direct wall-clock impact; converts invisible orphans into debuggable ones. |
| **4** | **Pool of pre-built apps + Playwright tags** — see "PR 4 design" below | ~6–8 hrs | Targets <10 min total wall-clock by removing the auto-publish-wait bottleneck in `publish-and-domain.spec.ts`'s `beforeAll`. Tags unblock a future PR-gate split. Reduces per-run fresh AI generations from 4 → 2 (chat-send + create-flow only). |
| **5** | `ChatInterface` POM + `startMonitoring` (console+network) helpers | ~6–8 hrs | Quality/maintainability win, modest wall-clock gain via network-level assertions replacing polling |
| **6** | Workflow split: PR-gate runs `--grep @pr-fast` (~3–5 min); scheduled / label-triggered runs full `@thorough` suite | ~1 hr | Makes e2e-v2 a viable PR check without blocking developer flow. Gated on PR 4's tags landing. |

Each of these is independently shippable on top of this PR. PRs 1.5 and 1.6 must ship in order; PRs 2–6 can ship in any order, but PR 6 needs PR 4's tags.

### PR 4 design — pool apps + tags

**Wall-clock bottleneck (current at workers=4): `publish-and-domain` ~10 min**, dominated by `beforeAll`'s auto-publish wait (~5–7 min). `develop-ui` ~7 min (homepage submit + AI gen). Sharding doesn't help — `e2e-v2` is already 4 specs in parallel-in-process via `workers=4`, and 4 separate runners each pay ~5 min CI setup overhead.

**Pool apps** target `beforeAll` cost directly. Two pools per env:

| Pool | Prefix | Used by | What it skips |
|---|---|---|---|
| `[e2e-pool:develop-ui]` | read-only landing page | `develop-ui.spec.ts` | Homepage submit + initial AI gen (~2 min) |
| `[e2e-pool:publish-domain]` | pre-published landing page | `publish-and-domain.spec.ts` | Homepage submit + AI gen + auto-publish wait (~5–7 min) |

`chat-send` and `create-flow` keep using fresh apps because they mutate transcript / test cold-start SSO respectively.

**Eviction guards already exclude pool apps for free.** `evictOldestE2eAppsToFitLimit` filters by substring `[e2e:`, and `[e2e-pool:` does not contain `[e2e:` (the colon is the disambiguator). No code change needed in eviction logic.

**Bootstrap** (`tests/pool-setup/build-pool-apps.spec.ts`, run via the `bootstrap-pool` Playwright project — implemented as a spec, not a standalone `.mjs` script, so it reuses the specs' SSO/auth helpers): idempotent. Run once per env to create missing pool apps via real homepage submit (so the pool app's state matches what specs would observe). For the `publish-domain` pool, the prompt includes the auto-publish instruction so the app is in a published state; if a pool app exists but its publish never landed, bootstrap auto-deletes and re-seeds it. At runtime the `pool-resolve` setup project resolves the pool ids once and caches them (`tests/.pool-cache.json`) for specs to read — eliminating the per-spec `GET /api/sites` lookups. CI runs `bootstrap-pool` before `e2e-v2`.

**Concurrency**: the workflow's existing `concurrency: e2e-v2-${env}` group serializes CI runs per environment, so two PRs can't race over the same pool app. For mutating specs (publish-domain attach/disconnect), tests already restore state at end of mutation.

**Tags** (Playwright `tag:` option) label tests for the future PR 6 split:

| Tag | Tests | Wall-clock target |
|---|---|---|
| `@pr-fast` | `create-flow` + 7× `develop-ui` | ~3–5 min |
| `@thorough` | 2× `chat-send` + 3× `publish-and-domain` | full coverage, ~10 min |
| `@create` / `@develop` / `@chat` / `@publish` | functional grouping for local subset runs | n/a |

PR 4 only adds the tags as metadata; PR 6 adds the workflow filter (`--grep @pr-fast` for PR-gate, no filter for scheduled).

**Risks**:
- *Pool app drift* — failed test mutations could leave residue. Mitigations: (a) the custom-domain test pre-cleans any leftover attachment at its start (`disconnectDomainIfPresent`) so a prior mid-test failure can't poison the next run; (b) it also disconnects what it attaches on the happy path; (c) ?tab=settings is transient; (d) re-running `bootstrap-pool` recreates a deleted pool app.
- *Coverage shift* — `publish-and-domain` test 11 changes from "verify auto-publish flow completed" to "verify app is in published state." The full auto-publish-via-AI-prompt flow stays covered by legacy `e2e` until PR 1.6 (delete-legacy) and by the `bootstrap-pool` project's pool creation itself.
- *AI-cost reduction is conditional* — pool apps are reused, but bootstrap creates them once per pool refresh. Net win is large IF pool apps are long-lived; if pool apps get deleted often (eviction bug, manual cleanup), the cost regresses to today's baseline.

**Scalability — how this pattern grows (validated against the "more AAB validation coverage" direction):**

The pool pattern scales along two axes, both clean for the read-only-heavy growth this suite is headed toward:

1. **More tests per fixture (the common case).** Read-only validation tests (does the AI build X correctly, does develop-page control Y work) cost ~0 marginal setup — they all share one pool app in parallel contexts. This is the sweet spot; add freely.
2. **More fixture *types*.** Coverage of different generated-app shapes (multi-page site, forms, blog, e-commerce) = new pool *purposes*. `getPoolAppId(page, purpose)` + one `bootstrap-pool` entry per type. Linear, no per-test coupling.

**What does NOT scale: mutating tests against a shared app.** Each one needs restore-discipline + idempotent pre-cleanup + serial ordering (see `publish-and-domain`'s `disconnectDomainIfPresent`). Three is fine; keep them rare. If mutating coverage ever grows, move those specs to fresh-app-per-test (`createSiteViaApi`) or a per-worker pool — don't pile more mutation onto a shared fixture. Read-only coverage has no such ceiling.

## Risks and mitigations

1. **`quick-create` returns `type: 'job'` with a job ID, not the real site ID.**
   - Mitigation: `createSiteViaApi` calls `waitForJobResolution` internally when `type === 'job'` and returns the resolved real appId. If polling fails, it throws with a clear error rather than letting downstream tests run against an invalid ID.

2. **Parallel workers compete for shopper app quota (100-app cap).**
   - Steady-state in-flight: 4 workers × ~1 app each + cleanup lag = peak ~5–6 apps in flight. Well under 100.
   - Mitigation: `evictOldestE2eAppsToFitLimit` (existing) is called explicitly in each spec's `beforeAll` before `createSiteViaApi`; the hardened `deleteApp` makes per-test cleanup more reliable by surfacing failures.

3. **File B's parallel tests share one app via different browser contexts.**
   - Each test is a different SSO session on the same server-side app — closer to real concurrent-user load than today's single-session flow.
   - Mitigation: invariant comment block at the top of `develop-ui.spec.ts` explicitly states the no-mutation rule. None of the 8 tests mutate persistent state today. New tests added to file B must verify this property or move out.

4. **File D's `beforeAll` runs the auto-publish wait (~3–10 min).**
   - If `beforeAll` fails, all three file D tests fail. Same risk as today's Step 3, just concentrated in one place.
   - Mitigation: `expectPublishSuccessVisible` already logs visibly; failures surface clearly. The retry config (1 retry on CI) gives one chance to recover from transient publish issues. On `local` env, `autoPublishSupported` is false and the publish wait is skipped entirely.

5. **`waitForJobResolution` polling contract is unverified until Phase 0.**
   - The plan assumes `GET /api/sites?site_id=<jobId>` returns a response whose `id` field transitions from job-shaped to site-shaped once mgmt-airo resolves the job. The actual API behavior must be confirmed before specs depend on it.
   - Mitigation: dedicated Phase 0 task (#10) verifies the response shape against `dev` mgmt-airo before the helpers are wired into specs. If the polling shape is different than assumed, the helper is updated in isolation; specs aren't touched.

6. **Wall-clock estimate range, not single number.**
   - Best case: ~5–7 min when auto-publish is fast and AI generation is responsive.
   - Realistic ceiling: ~8–10 min when auto-publish hits `PUBLISH_TIMEOUT_MS` or when DNS deployment polling extends.
   - Validation should confirm the *distribution* of wall-clock times across 5 runs, not a single fast pass.

7. **Duplicate-maintenance window (PR 1 → PR 1.6).**
   - Until the monolith is deleted, any UI change with `data-testid` impact needs updates in both `tests/e2e/e2e.spec.ts` and the relevant `tests/e2e-v2/*.spec.ts`. Easy to forget.
   - Mitigation: keep the stabilization window short (target 1–2 weeks of green daily CI). Add a note to `tests/e2e-v2/README.md` and to the project CLAUDE.md E2E maintenance section pointing at both directories. PR 1.6 closes the window.

8. **Existing `e2e` project picking up `tests/e2e-v2/` files accidentally.**
   - If the existing `e2e` project's `testDir` is `tests/e2e` without a `testMatch` filter, nesting `tests/e2e-v2/` under `tests/e2e/` would cause it to scoop up the new specs and run them with `workers: 1`, defeating the parallelism.
   - Mitigation: keep `tests/e2e-v2/` as a *sibling* to `tests/e2e/`, not nested. Verify the existing `e2e` project's `testDir` / `testMatch` config before adding the new project — adjust if needed (add an explicit `testMatch: 'e2e.spec.ts'` to the legacy project to be safe).

## AI credit consumption

Not a blocker for this PR — the shopper can be topped up — but worth tracking, since the new shape roughly doubles per-run cost and that compounds as e2e coverage grows.

| | Initial generations | Chat roundtrips | Total AI calls per run |
|---|---|---|---|
| Today (1 app) | 1 | 2 | ~3 |
| After PR 1 (4 apps) | 4 | 2 | ~6 |

Each spec file's `beforeAll` calls `createSiteViaApi`, which triggers initial AI generation. The 5-run validation pass is ~30 calls; ongoing CI is ~6 per triggered run.

**Practices to keep cost from drifting upward over time:**

1. **Minimal prompts.** Keep `beforeAll` prompts short. Reuse the `"...do not ask follow up questions and publish this app"` pattern from `publish-and-domain` where it fits — discourages multi-turn back-and-forth that compounds cost. Don't let prompts grow over time.
2. **Don't merge `develop-ui` + `chat-send` to save an app.** Tempting for credit savings (1 fewer fresh generation) but breaks the no-mutation invariant — chat sends mutate transcript state and would make develop-ui tests order-dependent.
3. **PR 4 (pre-built app pool) is the lever to pull when this matters.** Drops per-run cost from 4 → 3 fresh generations by replacing `develop-ui`'s API-create + AI gen with navigation against pre-built apps. Worth keeping in mind as new specs land and per-run cost climbs again.

**Top up the shopper before kicking off the 5-run validation pass.** Size for the validation runs plus ~2 weeks of post-merge CI headroom; revisit when more spec files land.

## Validation checklist

Phase 0 — before specs are written:

- [ ] Verify `quick-create` job→site polling contract against dev mgmt-airo. Document actual response shape in code comment on `waitForJobResolution`.

Before merging PR 1 (this PR — adds `tests/e2e-v2/` in parallel, does NOT flip CI):

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test:e2e --project=e2e-v2 --env=dev` passes locally, **5 consecutive runs** (wall-clock distribution check, not single fast pass)
- [ ] `pnpm test:e2e --project=e2e-v2 --env=test` passes locally (auto-publish behavior verification)
- [ ] Wall-clock distribution for `e2e-v2`: median 5–7 min, P95 ≤ 10 min — confirm via Playwright HTML report timing
- [ ] `pnpm test:e2e --project=e2e --env=dev` still passes locally (legacy monolith unaffected by this PR)
- [ ] `pnpm test:e2e --project=regression` still passes locally (regression project untouched, `workers: 1` preserved)
- [ ] Confirm legacy `e2e` project does NOT pick up `tests/e2e-v2/*.spec.ts` (run `--project=e2e` and verify only `e2e.spec.ts` ran)

Before merging PR 1.5 (CI flip):

- [ ] Manual GitHub Actions dispatch run of `--project=e2e-v2` against `dev` env, **5 consecutive runs**, no new flakes
- [ ] Eviction guard fire rate is ≤ baseline (Elasticsearch reporter dashboard)
- [ ] Shopper credit headroom confirmed for the doubled per-run cost during the overlap

Before merging PR 1.6 (delete monolith):

- [ ] At least 1–2 weeks of green daily CI runs on `--project=e2e-v2` with no new flakes attributable to the v2 shape
- [ ] Confirm shopper app count isn't drifting upward (eviction guard logs)
- [ ] No outstanding UI changes that landed only on the monolith

## Operational notes

### Running individual files locally

```bash
# All e2e-v2 tests in parallel (new shape — what this PR adds)
pnpm test:e2e --project=e2e-v2 --env=dev

# Legacy monolith (still the canonical CI signal until PR 1.5)
pnpm test:e2e --project=e2e --env=dev

# One file in e2e-v2 (useful when debugging)
pnpm test:e2e --project=e2e-v2 --env=dev tests/e2e-v2/develop-ui.spec.ts

# One test inside a file
pnpm test:e2e --project=e2e-v2 --env=dev -g "Edit mode toggle"

# With UI mode for stepwise debugging
pnpm test:e2e --project=e2e-v2 --env=dev --ui tests/e2e-v2/publish-and-domain.spec.ts
```

### Debugging a failing parallel test

1. The HTML report shows per-spec timing. Identify which file is failing.
2. Re-run that file locally with `--workers=1` (override `PLAYWRIGHT_E2E_WORKERS`) to remove parallelism as a confounder.
3. If it passes serially but fails in parallel, the bug is interaction-related (state leak, race, etc.) — most likely candidate is a test in `develop-ui.spec.ts` that's secretly mutating state.

### Adding a new e2e test (during the v2/monolith overlap)

**During the overlap (PR 1 → PR 1.6): if the change touches a `data-testid` or user flow exercised by both the monolith and v2, update both.** The CLAUDE.md E2E maintenance note covers this for the duration.

For brand-new tests, add to v2 only — the monolith is on its way out. Decision tree for which v2 file:

- Tests the homepage UI flow itself? → extend `tests/e2e-v2/create-flow.spec.ts`
- Read-only verification of develop-page UI, no app state changes? → add to `tests/e2e-v2/develop-ui.spec.ts`
- Sends chat messages or otherwise mutates transcript? → add to `tests/e2e-v2/chat-send.spec.ts`
- Touches publish, deploy, or domain state? → add to `tests/e2e-v2/publish-and-domain.spec.ts`
- None of the above (e.g. archive/restore lifecycle)? → new file in `tests/e2e-v2/`, follow the same beforeAll/afterAll pattern with API-create

## Changelog (PR 1 commits, in implementation order)

1. `feat(test/helpers): add createSiteViaApi, waitForJobResolution, hardened deleteApp`
2. `feat(test/e2e-v2): add create-flow.spec.ts (Step 1 → standalone)`
3. `feat(test/e2e-v2): add develop-ui.spec.ts (Steps 2/4/7/8/9/10 + preview controls → 8 parallel tests)`
4. `feat(test/e2e-v2): add chat-send.spec.ts (Steps 5/6 → 2 serial tests)`
5. `feat(test/e2e-v2): add publish-and-domain.spec.ts (Steps 3/11/12 → 3 serial tests)`
6. `chore(test): add e2e-v2 playwright project + scripts/e2e.sh path, update READMEs`

PR 1.5 (separate, after PR 1 lands and is validated):

7. `chore(ci): flip e2e workflow to --project=e2e-v2`

PR 1.6 (separate, after ~1–2 weeks of green CI on v2):

8. `chore(test): remove legacy e2e project and tests/e2e/e2e.spec.ts`
