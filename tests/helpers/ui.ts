import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

import { detectSsoType, handleSsoLogin, isSignInUIResult, userMenuTrigger } from './auth';
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

  if (isSignInUIResult(result)) {
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
  const candidates = [
    // Legacy GoDaddy privacy banner
    page.locator('#pw_accept'),
    // Post-29-Apr-2026 GoDaddy universal cookie banner: surfaced as
    // `alert "privacyAlert"` with a named "Accept" button. Scope the role
    // lookup to the alert so we don't click an unrelated "Accept" elsewhere.
    page.getByRole('alert', { name: /privacyAlert/i }).getByRole('button', { name: /^accept$/i }),
    // Fallback: cookie consent banner with Manage/Decline/Accept buttons
    // where the buttons live in a sibling container rather than inside the
    // alert element. Scoped to a parent that also contains "Decline" to
    // avoid false-positive clicks on unrelated "Accept" buttons.
    page.locator(':has(> button:text("Decline")) > button:text("Accept")'),
  ];

  for (const btn of candidates) {
    if (await btn.isVisible({ timeout: SHORT_TIMEOUT }).catch(() => false)) {
      await btn.click({ force: true });
      await expect(btn).not.toBeVisible({ timeout: SHORT_TIMEOUT }).catch(() => {});
      console.log('  ✓ Dismissed cookie consent banner');
      break;
    }
  }

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
  }

  // "Projects" popover auto-opens on the authenticated homepage when the
  // user has existing apps. It overlays the prompt area and blocks
  // submission. The same chrome (with the same Projects trigger) renders
  // on the develop page too, and the popover state survives a homepage →
  // /develop/<id> navigation when the spec went through `loginIfNeeded` on
  // the homepage first — so develop tests find the popover overlaying the
  // chat-send-button and gating waits time out against a hidden element.
  // Skip the SHORT_TIMEOUT cost on routes that definitely don't render the
  // button (e.g. `/apps`); run it on `/` and `/develop/<id>`.
  const pathname = new URL(page.url()).pathname;
  if (pathname === '/' || pathname === '' || pathname.startsWith('/develop/')) {
    const projectsBtn = page.getByRole('button', { name: 'Projects' });
    const projectsVisible = await projectsBtn
      .waitFor({ state: 'visible', timeout: SHORT_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (projectsVisible && (await projectsBtn.getAttribute('aria-expanded').catch(() => null)) === 'true') {
      await projectsBtn.click();
      console.log('  ✓ Collapsed Projects popover');
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
}

export type WaitForChatInputOptions = {
  /** When false, only waits for the textarea (skip develop shell + preview iframe gates). Use mid-flow on develop after the page was already ready. */
  requirePreview?: boolean;
};

/**
 * Wait for chat input to be ready for interaction
 */
export async function waitForChatInput(page: Page, options?: WaitForChatInputOptions): Promise<void> {
  const requirePreview = options?.requirePreview !== false;

  if (requirePreview) {
    await expect(page.getByTestId('develop-skeleton')).not.toBeVisible({ timeout: PREVIEW_TIMEOUT });
    await expect(page.getByTestId('develop-chat-pane-loader')).not.toBeVisible({ timeout: PREVIEW_TIMEOUT });

    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);
  }

  // A MULTI-STEP clarifying-question card ("...1/3", "...2/3", "...3/3") can
  // take over the chat pane and collapse the chat input — while it's shown,
  // chat-input-textarea never becomes visible and the wait below times out.
  // Each Skip advances to the NEXT question (confirmed via failure screenshot:
  // one skip went 1/3 -> 2/3), so skip through all of them until the card is
  // gone. Best-effort: the card only appears on some loads, so absence is the
  // common (no-op) case. Bounded loop (cap > question count) so a stuck card
  // can't spin forever.
  const askSkip = page.getByTestId('ask-question-skip');
  let skipped = false;
  for (let i = 0; i < 5; i++) {
    if (!(await askSkip.isVisible({ timeout: SHORT_TIMEOUT }).catch(() => false))) break;
    await askSkip.click({ force: true }).catch(() => {});
    skipped = true;
    // Let the next question render or the card dismiss before re-checking.
    await page.waitForTimeout(500);
  }
  if (skipped) console.log('  ✓ Skipped clarifying-question card');

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
 * After deploy completes, success may appear as any of:
 * - `#first-publish-congrats-modal` (first publish; popover closes, no in-popover alert — AppPublish.tsx)
 * - `publish-success-alert` (republish with publish popover still open)
 * - `#app-publish-success` growl (republish when popover was closed)
 */
export async function expectPublishSuccessVisible(
  page: Page,
  timeout = DEPLOYMENT_TIMEOUT_MS,
): Promise<void> {
  const congratsModal = page.locator('#first-publish-congrats-modal');
  const popoverSuccess = page.getByTestId('publish-success-alert');
  const successGrowl = page.locator('#app-publish-success');
  await expect(congratsModal.or(popoverSuccess).or(successGrowl)).toBeVisible({ timeout });
}

/**
 * Approve the agent-publish human-in-the-loop confirmation modal.
 *
 * Agent-initiated publishes (driven by a "publish this app" creation prompt) pause on
 * AgentPublishConfirmationModal — rendered while `agentPublishConfirmation === 'pending'`
 * (see publishAction.ts `awaitAgentPublishApproval`). The agent's publish work does not
 * start until the user approves, so any spec that drives the agent to publish MUST call
 * this before asserting publish success — otherwise the publish hangs until the
 * confirmation times out (~5 min), resolves as cancelled, and the success assertion fails.
 *
 * The UI Publish button does NOT route through the agent action and is never gated, so
 * specs that publish via the popover button do not call this.
 */
export async function approveAgentPublish(page: Page, timeout = DEPLOYMENT_TIMEOUT_MS): Promise<void> {
  const confirmButton = page.getByTestId('agent-publish-confirm-button');
  await confirmButton.waitFor({ state: 'visible', timeout });
  await confirmButton.click();
  await expect(page.getByTestId('agent-publish-confirm-modal')).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
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

const SSE_TRANSPORT_FLAG = 'app-builder-sse-transport';

/**
 * Force WebSocket chat transport for the browser context. Call before the first
 * navigation — useChatTransport locks onto the switchboard flag at develop mount.
 */
export async function forceWebSocketTransport(page: Page): Promise<void> {
  await page.addInitScript((flagKey: string) => {
    function patchSwitchboard(value: unknown): unknown {
      if (value && typeof value === 'object') {
        const record = value as { switchboard?: Record<string, unknown> };
        if (record.switchboard) {
          record.switchboard[flagKey] = false;
        }
      }
      return value;
    }

    let stored: unknown;
    Object.defineProperty(window, 'gasketData', {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(value: unknown) {
        stored = patchSwitchboard(value);
      },
    });
  }, SSE_TRANSPORT_FLAG);
}

/** Assert the SSE transport switchboard flag is off (default WS cohort). */
export async function expectWebSocketTransport(page: Page): Promise<void> {
  const sseEnabled = await page.evaluate(
    (flagKey: string) =>
      (window as unknown as { gasketData?: { switchboard?: Record<string, unknown> } }).gasketData
        ?.switchboard?.[flagKey] === true,
    SSE_TRANSPORT_FLAG,
  );
  expect(sseEnabled, 'Chat transport must be WebSocket (app-builder-sse-transport off)').toBe(false);
}
