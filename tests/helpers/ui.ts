import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { handleSsoLogin, detectSsoType } from './auth';
import { LONG_TIMEOUT, PREVIEW_TIMEOUT, CHAT_INPUT_TIMEOUT, DEFAULT_TIMEOUT, SHORT_TIMEOUT, GO_LIVE_MODAL_TIMEOUT } from './constants';

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
 * Dismiss privacy banners if they exist on the page
 */
export async function dismissBanners(page: Page): Promise<void> {
  const banners = ['#pcFooter', '#gtm_privacy', '#pw_banner'];

  for (const selector of banners) {
    const banner = page.locator(selector);
    if (await banner.isVisible({ timeout: SHORT_TIMEOUT }).catch(() => false)) {
      await banner.evaluate((el) => (el as HTMLElement).style.display = 'none');
    }
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
