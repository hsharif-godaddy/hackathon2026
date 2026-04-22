/**
 * Cold archive restore UX (smoke)
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

/** App id in /develop/:id may be a UUID (hyphens). A pattern like [a-zA-Z0-9]+ breaks route mocks. */
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

const SMOKE_JOB_ID = 'e2e-smoke-archive-job';

let lastSiteDetailsAppId: string | null = null;
let lastSiteDetailsHandler: ((route: Route) => Promise<void>) | null = null;

/**
 * useAppArchiveRestore auto-restore runs only when app details include preview
 * lifecycle.reason === 'hibernation' (see useAppArchiveRestore).
 */
async function installAppDetailsHibernationPreviewLifecycle(page: Page, appId: string): Promise<void> {
  lastSiteDetailsAppId = appId;
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

  lastSiteDetailsHandler = siteDetailsHandler;
  await page.route(urlPattern, siteDetailsHandler);
}

async function unrouteArchiveMocks(page: Page): Promise<void> {
  await page.unroute(ARCHIVE_STATUS_GLOB).catch(() => {});
  await page.unroute(ARCHIVE_RESTORE_GLOB).catch(() => {});
  if (lastSiteDetailsAppId && lastSiteDetailsHandler) {
    await page
      .unroute(appSiteDetailsGetUrlPattern(lastSiteDetailsAppId), lastSiteDetailsHandler)
      .catch(() => {});
    lastSiteDetailsAppId = null;
    lastSiteDetailsHandler = null;
  }
}

async function installArchiveRestoreHappyPathMocks(page: Page, appId: string): Promise<void> {
  await installAppDetailsHibernationPreviewLifecycle(page, appId);

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
      body: JSON.stringify({ statusJobId: SMOKE_JOB_ID }),
    });
  });
}

async function installArchiveRestoreFailThenRetryMocks(page: Page, appId: string): Promise<void> {
  let restorePostCount = 0;

  await installAppDetailsHibernationPreviewLifecycle(page, appId);

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
        body: JSON.stringify({ error: 'Archive restore failed (smoke mock)' }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ statusJobId: SMOKE_JOB_ID }),
    });
  });
}

test.describe('Cold archive restore (smoke)', () => {
  test.beforeEach(async ({}, testInfo) => {
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

    await installArchiveRestoreHappyPathMocks(page, appId);
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

    await installArchiveRestoreFailThenRetryMocks(page, appId);
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
    await unrouteArchiveMocks(page);
    await logTestResult(page, testInfo);

    console.log('🧹 Cleanup...');
    try {
      await page.goto('/apps');
      await deleteAllSitesViaAPI(page);
    } catch {
      console.log('  ⚠ Cleanup skipped');
    }
  });
});
