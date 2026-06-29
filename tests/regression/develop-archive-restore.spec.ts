/**
 * Cold archive restore UX (regression)
 *
 * Intercepts BFF routes (/api/sites/:id, archive-status, archive-restore)
 * so we do not depend on mgmt-airo cold-archive or LOCAL_CP_ARCHIVED_APP_IDS.
 *
 * Covers: preview restoring/failed states, disabled chat input during archive UX,
 * restore POST failure + retry from PreviewPane (develop-preview-archive-restore-failed).
 */
import { type Page } from '@playwright/test';

import { test, expect } from '../helpers/test-fixtures';
import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, ensureAuthenticated, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
import { AI_RESPONSE_TIMEOUT_MS, DEFAULT_TIMEOUT, E2E_NO_DELETE, LONG_TIMEOUT, getSpecPrefix } from '../helpers/constants';
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

const ARCHIVE_JOB_ID = 'regression-archive-job';

async function unrouteArchiveMocks(page: Page): Promise<void> {
  // Bare empty-catch hides failures (e.g. unroute throwing because a route was
  // never installed) and lets a stale handler persist into the next test,
  // doubling up interceptors. Log so re-enabled parallel runs surface the issue.
  await page.unroute(ARCHIVE_STATUS_GLOB).catch((err) => {
    console.warn('unrouteArchiveMocks: archive-status unroute failed:', err);
  });
  await page.unroute(ARCHIVE_RESTORE_GLOB).catch((err) => {
    console.warn('unrouteArchiveMocks: archive-restore unroute failed:', err);
  });
}

async function installArchiveRestoreHappyPathMocks(page: Page, appId: string): Promise<void> {
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
}

async function installArchiveRestoreFailThenRetryMocks(page: Page, appId: string): Promise<void> {
  let restorePostCount = 0;

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
}

/**
 * Re-enabled (VNEXT-80878). Previously skipped (#3093) on the theory that the
 * route mocks never reached the archived state after the cold-archive UX change
 * (#2697). The real failure was the same one that skipped the sibling analytics
 * spec (VNEXT-80877): CI failed before any archive assertion because the in-body
 * homepage sign-in iframe's credential fill timed out on prod. Fixed by
 * authenticating once in beforeEach via the fast standalone-SSO login
 * (loginViaSsoDirect); the in-body handleSsoLogin is now a conditional re-auth
 * guard. The archive-status / archive-restore route mocks are unchanged — they
 * drive the restoring/failed UI deterministically once the develop page loads.
 */
/** Spec prefixes used by `getSpecPrefix(...)` calls in this describe block. */
const SPEC_PREFIXES = ['archive-restore', 'archive-retry'] as const;

test.describe('Cold archive restore', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    // Authenticate once via the fast standalone-SSO login (e2e-v2 style) so the
    // homepage submit redirects straight to /develop/ instead of routing through
    // the in-body cross-origin sign-in iframe whose credential fill was timing
    // out on prod (the reason this spec was skipped). The eviction's internal
    // loginIfNeeded then becomes a fast no-op.
    await loginViaSsoDirect(page);
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch((err) => {
        console.error('App eviction failed:', err);
      });
    }
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
    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach, so the submit normally redirects
    // straight to /develop/. Only drive the in-body SSO flow if the session
    // refreshed mid-test and the sign-in UI actually reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await ensureAuthenticated(page);
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
    await dismissOverlays(page);
    await page.locator('[data-eid*="homepage.prompt.submit"]').click();

    // Already authenticated in beforeEach, so the submit normally redirects
    // straight to /develop/. Only drive the in-body SSO flow if the session
    // refreshed mid-test and the sign-in UI actually reappeared.
    const ssoResult = await detectSsoType(page, true);
    if (isSignInUIResult(ssoResult)) {
      await handleSsoLogin(page);
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);
    await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: AI_RESPONSE_TIMEOUT_MS });
    await ensureAuthenticated(page);
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

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    console.log('Cleanup...');
    for (const name of SPEC_PREFIXES) {
      try {
        await deleteAppsWithPrefix(page, getSpecPrefix(name));
      } catch (err) {
        console.error(`  Cleanup of prefix '${name}' failed:`, err);
      }
    }
  });
});
