import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

import { detectSsoType, handleSsoLogin, userMenuTrigger } from './auth';
import {
  CHAT_INPUT_TIMEOUT,
  DEFAULT_TIMEOUT,
  DEPLOYMENT_TIMEOUT_MS,
  GO_LIVE_MODAL_TIMEOUT,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  SHORT_TIMEOUT,
} from './constants';

/**
 * Log page state for post-mortem debugging.
 * Safe to call at any point — catches all internal errors.
 */
export async function logPageState(page: Page, label: string): Promise<void> {
  try {
    console.log(`  [PAGE STATE: ${label}]`);
    console.log(`    url: ${page.url()}`);

    const title = await page.title().catch(() => '<unavailable>');
    console.log(`    title: ${title}`);

    const visibleDialogs = await page.locator('[role="dialog"]:visible').count().catch(() => -1);
    if (visibleDialogs > 0) {
      console.log(`    visible dialogs: ${visibleDialogs}`);
    }

    const menuTrigger = userMenuTrigger(page);
    const menuVisible = await menuTrigger.isVisible().catch(() => false);
    console.log(`    user menu button visible: ${menuVisible}`);

    const signOut = page.locator('[data-testid="user-menu-item-sign-out"]');
    const signOutVisible = await signOut.isVisible().catch(() => false);
    console.log(`    sign_out visible: ${signOutVisible}`);

    const signIn = page.locator('[data-testid*="user-menu-item-sign-in"]');
    const signInVisible = await signIn.isVisible().catch(() => false);
    if (signInVisible) {
      console.log(`    sign_in visible: true (session may have expired)`);
    }

    const authModal = page.getByRole('heading', { name: 'Sign In Required' });
    const authModalVisible = await authModal.isVisible().catch(() => false);
    if (authModalVisible) {
      console.log(`    ⚠ "Sign In Required" modal is showing`);
    }
  } catch {
    console.log(`    [PAGE STATE: failed to collect]`);
  }
}

/**
 * Log test start banner. Use in beforeEach to mark the beginning of each test.
 */
export function logTestStart(testInfo: TestInfo): void {
  const fullTitle = testInfo.titlePath.join(' > ');
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🚀 STARTING TEST`);
  console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
  console.log(`🧪 Test: ${fullTitle}`);
  console.log(`${'='.repeat(70)}`);
}

/**
 * Logs full error context on failure — URL, call log, locator hint, and stack location.
 */
export async function logTestResult(page: Page, testInfo: TestInfo): Promise<void> {
  const fullTitle = testInfo.titlePath.join(' > ');
  const duration = ((testInfo.duration || 0) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🏁 TEST COMPLETED`);
  console.log(`📄 File: ${testInfo.file?.split('/').pop() || 'unknown'}`);
  console.log(`🧪 Test: ${fullTitle}`);
  console.log(`⏱️ Duration: ${duration}s`);

  if (testInfo.status === 'passed') {
    console.log(`✅ Status: PASSED`);
  } else if (testInfo.status === 'failed') {
    console.log(`❌ Status: FAILED`);
    if (testInfo.error) {
      const fullMessage = testInfo.error.message || 'Unknown error';
      const lines = fullMessage.split('\n');
      console.log(`💥 Message: ${lines[0]}`);

      const locatorLine = lines.find(l => /locator|selector|getBy/i.test(l));
      if (locatorLine) console.log(`🎯 Locator: ${locatorLine.trim()}`);

      const callLogStart = lines.findIndex(l => l.includes('Call log:'));
      if (callLogStart !== -1) {
        const callLogLines = lines.slice(callLogStart, callLogStart + 8);
        console.log(`📞 ${callLogLines.join('\n   ')}`);
      }

      const stackMatch = testInfo.error.stack?.match(/at.*\((.*:\d+:\d+)\)/);
      if (stackMatch) console.log(`📍 Location: ${stackMatch[1]}`);
    }
    await logPageState(page, 'at failure');
  } else if (testInfo.status === 'skipped') {
    console.log(`⏭️ Status: SKIPPED`);
  } else {
    console.log(`🟡 Status: ${String(testInfo.status).toUpperCase()}`);
  }
  console.log(`${'='.repeat(70)}\n`);
}

/**
 * Check if SSO login is required and handle it if so
 * Called after clicking submit on homepage prompt
 */
async function handleSsoLoginIfNeeded(page: Page): Promise<void> {
  // Detect SSO type, including check for already authenticated (develop page)
  const result = await detectSsoType(page, true);

  if (result === 'authenticated') {
    console.log('Already authenticated - proceeding to develop page');
    return;
  }

  if (result === 'iframe' || result === 'redirect') {
    console.log(`SSO login required (${result})`);
    await handleSsoLogin(page);
    return;
  }

  throw new Error('Timed out waiting for login or develop page redirect');
}

/**
 * Hide known third-party banners (#gtm_privacy, etc.) when present so they cannot block clicks.
 */
export async function dismissBanners(page: Page): Promise<void> {
  const banners = ['#pcFooter', '#gtm_privacy', '#pw_banner'];

  for (const selector of banners) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    await locator.evaluate((el) => {
      const node = el as HTMLElement;
      node.style.display = 'none';
      node.style.pointerEvents = 'none';
    });
  }
}

/**
 * Dismiss any blocking overlays (cookie consent, coachmark tours, backdrops).
 * Safe to call at any point — no-ops when nothing is blocking.
 * Coachmark tours use UX library shadow DOM so detection is unreliable;
 * we press Escape unconditionally to clear them.
 */
export async function dismissOverlays(page: Page): Promise<void> {
  const cookieAccept = page.locator('#pw_accept');
  if (await cookieAccept.isVisible({ timeout: SHORT_TIMEOUT }).catch(() => false)) {
    await cookieAccept.click({ force: true });
    await expect(cookieAccept).not.toBeVisible({ timeout: SHORT_TIMEOUT }).catch(() => {});
    console.log('  ✓ Dismissed cookie consent banner');
  }

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
  }
}

/**
 * Wait for homepage to fully load
 */
export async function waitForHomepage(page: Page): Promise<void> {
  // Wait for sites API
  const response = page.waitForResponse('**/api/sites');
  await response;

  // Wait for main prompt input
  await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
}

/**
 * Wait for apps page to fully load
 */
export async function waitForAppsPage(page: Page): Promise<void> {
  // Wait for sites API
  await page.waitForResponse('**/api/sites');

  // Wait for page content
  await page.getByTestId('apps-page-title').waitFor({
    state: 'visible',
    timeout: DEFAULT_TIMEOUT,
  });
}

/**
 * Wait for develop page to be fully ready
 */
export async function waitForDevelopPage(page: Page): Promise<void> {
  await waitForChatInput(page);

  await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
  await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);
}

/**
 * Wait for chat input to be ready for interaction
 */
export async function waitForChatInput(page: Page): Promise<void> {
  // Wait for loading spinner to disappear
  await expect(async () => {
    const hasSpinner = await page.locator('[class*="ux-spinner"], [class*="Spinner"]').count() > 0;
    expect(hasSpinner).toBe(false);
  }).toPass({ timeout: PREVIEW_TIMEOUT });

  // Wait for preview iframe to be loaded
  await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
  await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);

  // Wait for chat input to be ready
  const chatInput = page.getByTestId('chat-input-textarea');
  await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });

  await expect(async () => {
    const isDisabled = await chatInput.isDisabled();
    expect(isDisabled).toBe(false);

    const placeholder = await chatInput.getAttribute('placeholder') || '';
    expect(placeholder.toLowerCase()).not.toContain('processing');
  }).toPass({ timeout: CHAT_INPUT_TIMEOUT });
}

/**
 * Navigate to apps page and wait for content
 */
export async function visitAppsPage(page: Page): Promise<void> {
  await page.goto('/apps');
  await page.getByTestId('app-card-edit-button').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Open develop page for a specific app ID and wait for it to be ready
 */
export async function openDevelop(page: Page, appId: string): Promise<void> {
  await page.goto(`/develop/${appId}`);
  await waitForDevelopPage(page);
}

/**
 * Send a chat message on the develop page
 */
export async function sendChatMessage(page: Page, message: string): Promise<void> {
  const chatInput = page.getByTestId('chat-input-textarea');
  await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
  await expect(chatInput).not.toBeDisabled();

  await chatInput.fill(message);

  const sendButton = page.getByTestId('chat-send-button');
  await expect(sendButton).not.toBeDisabled();
  await sendButton.click();
}

/**
 * Create a new app from homepage with the given prompt
 * Handles SSO login if user is not authenticated
 */
export async function createNewApp(page: Page, prompt: string): Promise<void> {
  await page.goto('/');

  // Wait for homepage to be ready
  const promptInput = page.getByTestId('homepage-prompt-input');
  await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
  await promptInput.fill(prompt);

  const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
  await expect(submitButton).not.toBeDisabled();
  await submitButton.click();

  // Check if SSO login is required (unauthenticated user)
  await handleSsoLoginIfNeeded(page);

  // Wait for redirect to develop page
  await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
}

/**
 * Create a new app and return its ID
 * Handles SSO login if user is not authenticated
 */
export async function createAppAndGetId(page: Page, prompt: string): Promise<string> {
  await page.goto('/');

  const promptInput = page.getByTestId('homepage-prompt-input');
  await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
  await promptInput.fill(prompt);

  const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
  await expect(submitButton).not.toBeDisabled();
  await submitButton.click();

  // Check if SSO login is required (unauthenticated user)
  await handleSsoLoginIfNeeded(page);

  // Wait for redirect to develop page and extract app ID from URL
  await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
  await waitForDevelopPage(page);

  // Extract app ID from URL
  const url = page.url();
  const match = url.match(/\/develop\/([a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}

/**
 * Set up an isolated app for a test spec file
 * Handles SSO login if user is not authenticated
 */
export async function setupIsolatedApp(page: Page, specPrefix: string, appDescription?: string): Promise<string> {
  const appName = appDescription ? `${specPrefix} ${appDescription}` : `${specPrefix} Test app`;

  await page.goto('/');

  const promptInput = page.getByTestId('homepage-prompt-input');
  await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
  await promptInput.fill(appName);

  const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
  await expect(submitButton).not.toBeDisabled();
  await submitButton.click();

  // Check if SSO login is required (unauthenticated user)
  await handleSsoLoginIfNeeded(page);

  // Wait for redirect to develop page
  await page.waitForURL(/\/develop\/[a-zA-Z0-9]+/, { timeout: LONG_TIMEOUT });

  // Wait for develop page to be ready
  await waitForDevelopPage(page);

  // Extract app ID from URL
  const url = page.url();
  const match = url.match(/\/develop\/([a-zA-Z0-9]+)/);
  const appId = match ? match[1] : '';

  console.log(`App created: ${appId}`);
  return appId;
}

/**
 * After deploy completes, first publish shows the congrats modal (`#first-publish-congrats-modal`);
 * republish (or legacy paths) may show the success growl (`#app-publish-success`) instead.
 */
export async function expectPublishSuccessVisible(
  page: Page,
  timeout = DEPLOYMENT_TIMEOUT_MS,
): Promise<void> {
  const congratsModal = page.locator('#first-publish-congrats-modal');
  const successGrowl = page.locator('#app-publish-success');
  await expect(congratsModal.or(successGrowl)).toBeVisible({ timeout });
}

/**
 * Dismiss the "Ready to Go Live?" modal if it appears after first publish
 */
export async function dismissGoLiveModalIfPresent(page: Page, waitTime = GO_LIVE_MODAL_TIMEOUT): Promise<boolean> {
  await page.waitForTimeout(waitTime);

  const laterButton = page.getByTestId('go-live-modal-later');
  if (await laterButton.isVisible({ timeout: SHORT_TIMEOUT }).catch(() => false)) {
    await laterButton.click();
    await expect(laterButton).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('Dismissed Go Live modal (first publish)');
    return true;
  }

  console.log('No Go Live modal appeared (republish or already gone live)');
  return false;
}
