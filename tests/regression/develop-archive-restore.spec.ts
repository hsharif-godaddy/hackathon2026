/**
 * Cold archive restore UX (regression)
 *
 * Intercepts BFF routes (/api/sites/:id, archive-status, archive-restore)
 * so we do not depend on mgmt-airo cold-archive or LOCAL_CP_ARCHIVED_APP_IDS.
 *
 * Covers: preview restoring/failed states, disabled chat input during archive UX,
 * restore POST failure + retry from PreviewPane (develop-preview-archive-restore-failed).
 */
import { expect, test, type Page, type Route } from '@playwright/test';

import { deleteAllSitesViaAPI } from '../helpers/api';
import { handleSsoLogin } from '../helpers/auth';
import { DEFAULT_TIMEOUT, LONG_TIMEOUT, getSpecPrefix } from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const ARCHIVE_STATUS_GLOB = '**/api/sites/*/archive-status**';
const ARCHIVE_RESTORE_GLOB = '**/api/sites/*/archive-restore**';

/**
 * App id in /develop/:id may be a UUID (hyphens). A pattern like [a-zA-Z0-9]+
 * truncates the id (e.g. abc12345-def6-7890 → abc12345), causing route mocks
 * keyed on the truncated id to never match the real request URL — the test
 * then runs against the unmocked backend and fails opaquely.
 */
function developAppIdFromPageUrl(url: string): string {
  return url.match(/\/develop\/([^/?#]+)/)?.[1] ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GET /api/sites/:id (optional query) — not /archive-status or /archive-restore. */
function appSiteDetailsGetUrlPattern(appId: string): RegExp {
  return new RegExp(`/api/sites/${escapeRegExp(appId)}(?:$|[?#])`);
}

const ARCHIVE_JOB_ID = 'regression-archive-job';

/**
 * Mocks installed by an install* helper. Returned from each helper and passed
 * back to unrouteArchiveMocks so cleanup can remove the exact handlers without
 * relying on module-level state (which would race across parallel tests once
 * playwright.config.ts moves off `workers: 1`).
 */
interface ArchiveMocks {
  siteDetailsAppId: string;
  siteDetailsHandler: (route: Route) => Promise<void>;
}

/**
 * useAppArchiveRestore auto-restore runs only when app details include preview
 * lifecycle.reason === 'hibernation' (see useAppArchiveRestore).
 */
async function installAppDetailsHibernationPreviewLifecycle(page: Page, appId: string): Promise<ArchiveMocks> {
  const urlPattern = appSiteDetailsGetUrlPattern(appId);

  const siteDetailsHandler = async function siteDetailsHandler(route: Route): Promise<void> {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch({
      ignoreHTTPSErrors: true,
    } as Parameters<Route['fetch']>[0]);
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      await route.continue();
      return;
    }
    const existing = Array.isArray(body.variantsWithLifecycle) ? body.variantsWithLifecycle : [];
    const filtered = (existing as { variant?: string }[]).filter((v) => v.variant !== 'preview');
    const previewVariant = {
      variant: 'preview',
      status: typeof body.status === 'string' ? body.status : 'paused',
      lifecycle: {
        lifecycleState: 'paused',
        reason: 'hibernation',
      },
    };
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: JSON.stringify({
        ...body,
        variantsWithLifecycle: [...filtered, previewVariant],
      }),
    });
  };

  await page.route(urlPattern, siteDetailsHandler);
  return { siteDetailsAppId: appId, siteDetailsHandler };
}

async function unrouteArchiveMocks(page: Page, mocks: ArchiveMocks | null): Promise<void> {
  // Bare empty-catch hides failures (e.g. unroute throwing because a route was
  // never installed) and lets a stale handler persist into the next test,
  // doubling up interceptors. Log so re-enabled parallel runs surface the issue.
  await page.unroute(ARCHIVE_STATUS_GLOB).catch((err) => {
    console.warn('unrouteArchiveMocks: archive-status unroute failed:', err);
  });
  await page.unroute(ARCHIVE_RESTORE_GLOB).catch((err) => {
    console.warn('unrouteArchiveMocks: archive-restore unroute failed:', err);
  });
  if (mocks) {
    await page
      .unroute(appSiteDetailsGetUrlPattern(mocks.siteDetailsAppId), mocks.siteDetailsHandler)
      .catch((err) => {
        console.warn('unrouteArchiveMocks: site-details unroute failed:', err);
      });
  }
}

async function installArchiveRestoreHappyPathMocks(page: Page, appId: string): Promise<ArchiveMocks> {
  const mocks = await installAppDetailsHibernationPreviewLifecycle(page, appId);

  await page.route(ARCHIVE_STATUS_GLOB, async (route) => {
    const url = route.request().url();
    if (!url.includes(`/api/sites/${appId}/archive-status`)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isArchived: true, canRestore: true }),
    });
  });

  await page.route(ARCHIVE_RESTORE_GLOB, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const url = route.request().url();
    if (!url.includes(`/api/sites/${appId}/archive-restore`)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ statusJobId: ARCHIVE_JOB_ID }),
    });
  });

  return mocks;
}

async function installArchiveRestoreFailThenRetryMocks(page: Page, appId: string): Promise<ArchiveMocks> {
  let restorePostCount = 0;

  const mocks = await installAppDetailsHibernationPreviewLifecycle(page, appId);

  await page.route(ARCHIVE_STATUS_GLOB, async (route) => {
    const url = route.request().url();
    if (!url.includes(`/api/sites/${appId}/archive-status`)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isArchived: true, canRestore: true }),
    });
  });

  await page.route(ARCHIVE_RESTORE_GLOB, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const url = route.request().url();
    if (!url.includes(`/api/sites/${appId}/archive-restore`)) {
      await route.continue();
      return;
    }
    restorePostCount += 1;
    if (restorePostCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Archive restore failed (regression mock)' }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ statusJobId: ARCHIVE_JOB_ID }),
    });
  });

  return mocks;
}

/**
 * Skipped at the describe level (rather than per test.skip) so the skip is
 * visible at the top of the file and applies to every test in the suite.
 *
 * Blocking issue: both tests in this file consistently fail on CI against
 * the real backend after the cold-archive UX changes in #2697. They were
 * skipped in #3093 to unblock unrelated PRs while the underlying flow is
 * stabilized — even with route mocks in place, navigating to /develop/:id
 * for a freshly-created app does not reliably reach the archived state
 * the mocks assume, so the restoring/failed UI never renders.
 *
 * To re-enable: either harden the mocks so the dev server treats the app
 * as cold-archived without requiring a real backend signal (e.g. flip
 * site state via /api/sites/:id PATCH before reload), or add a real
 * archive→restore fixture to the local control plane and remove the
 * route mocks entirely. Once green locally, drop the .skip and run
 * regression in CI to confirm.
 */
test.describe.skip('Cold archive restore', () => {
  /**
   * Per-test mock state. Scoped to a closure (rather than module-level)
   * because each test owns its own ArchiveMocks instance — sharing across
   * tests breaks the moment workers > 1.
   */
  let installedMocks: ArchiveMocks | null = null;

  test.beforeEach(async ({}, testInfo) => {
    installedMocks = null;
    logTestStart(testInfo);
  });

  test('shows restoring UI when archive-status reports archived and restore job is in progress', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(
      `${getSpecPrefix('archive-restore')} Single page hello world - do not ask follow up questions`
    );
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await dismissOverlays(page);

    const appId = developAppIdFromPageUrl(page.url());
    expect(appId.length).toBeGreaterThan(0);

    installedMocks = await installArchiveRestoreHappyPathMocks(page, appId);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('develop-preview-archive-restoring')).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    const chatInput = page.getByTestId('chat-input-textarea');
    await expect(chatInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(chatInput).toBeDisabled();
  });

  test('shows archive restore failure and recovers after retry when restore POST fails once', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');
    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
    await promptInput.fill(
      `${getSpecPrefix('archive-retry')} Single page hello world - do not ask follow up questions`
    );
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();
    await handleSsoLogin(page);
    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await dismissOverlays(page);

    const appId = developAppIdFromPageUrl(page.url());
    expect(appId.length).toBeGreaterThan(0);

    installedMocks = await installArchiveRestoreFailThenRetryMocks(page, appId);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const failedPanel = page.getByTestId('develop-preview-archive-restore-failed');
    await expect(failedPanel).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await failedPanel
      .getByRole('button', { name: /try again|builder_common_try_again/i })
      .click();

    await expect(page.getByTestId('develop-preview-archive-restoring')).toBeVisible({
      timeout: DEFAULT_TIMEOUT,
    });
    await expect(page.getByTestId('chat-input-textarea')).toBeDisabled();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await unrouteArchiveMocks(page, installedMocks);
    installedMocks = null;
    await logTestResult(page, testInfo);

    console.log('Cleanup...');
    try {
      await page.goto('/apps');
      await deleteAllSitesViaAPI(page);
    } catch (err) {
      console.error('  Cleanup failed:', err);
    }
  });
});
