import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

import { detectSsoType, handleSsoLogin, isSignInUIResult, userMenuTrigger } from './auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
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
  const response = page.waitForResponse('**/api/sites', { timeout: DEFAULT_TIMEOUT });
  await response;

  // Wait for main prompt input
  await page.getByTestId('homepage-prompt-input').waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
}

/**
 * Submit the homepage prompt, retrying the click until it demonstrably registers.
 *
 * The submit button's disabled→enabled flip is server-rendered, so the button
 * can look ready before React hydrates and attaches its click handler — a click
 * then silently no-ops. Instead of a fixed hydration sleep, retry the click
 * until it takes effect. A registered click either flips the button into its
 * loading (disabled) state — authenticated submits keep `isLoading` true across
 * the create request — or replaces the homepage with an SSO surface / develop
 * navigation (surfaced by `detectSsoType`). A pre-hydration no-op leaves the
 * button idle+enabled, so `toPass` re-clicks. The bounded click timeout + catch
 * stop a covered/detached button (after the first successful click) from
 * stalling an iteration; the app's own `isLoading` re-entry guard prevents any
 * duplicate create.
 *
 * Callers still drive their own post-submit flow afterward (SSO handling and/or
 * `waitForURL(/develop/)`); this only guarantees the click was accepted.
 */
export async function submitHomepage(page: Page, timeout?: number): Promise<void> {
  const submitButton = page.getByTestId('homepage-prompt-submit');
  await expect(async () => {
    await submitButton.click({ timeout: SHORT_TIMEOUT }).catch(() => {});
    const registered =
      (await submitButton.isDisabled().catch(() => false)) ||
      (await detectSsoType(page, true, SHORT_TIMEOUT)) !== 'timeout';
    expect(registered, 'homepage submit did not register (button still idle after click)').toBe(true);
  }).toPass({ timeout: timeout ?? DEFAULT_TIMEOUT });
}

/**
 * Wait for apps page to fully load
 */
export async function waitForAppsPage(page: Page): Promise<void> {
  // Wait for sites API
  await page.waitForResponse('**/api/sites');

  // Wait for page content
  await page.getByTestId('projects-page-title').waitFor({
    state: 'visible',
    timeout: DEFAULT_TIMEOUT,
  });
}

/**
 * Preview-gate failure signatures — the M1 decision gate for the regression
 * stability plan (docs/plans/2026-06-29-regression-preview-stability.md
 * §Milestone 1). When the preview gate in `waitForChatInput` times out, we
 * classify *why* so 2–3 scheduled cron cycles produce an actionable dominant
 * signature before any pool/account work begins.
 */
type PreviewGateSignature =
  | 'build-latency' // develop-skeleton/loader still visible → first build never completed
  | 'job-unresolved' // URL still ?type=job, or /api/sites still returns a job-shaped id
  | 'preview-cold-start' // app id resolved, skeleton gone, iframe never became visible
  | 'unknown'; // signals don't match a known bucket — inspect the dump

/**
 * A real V2 app id is 10 chars (APP_ID_LENGTH in
 * app/src/lib/control-plane/v2-control-plane-adapter.ts); a quick-create job
 * id is shorter (~7). The front-end uses the same length test
 * (`finalSiteData.id.length <= 8` → still a job) in useSiteCreationStore.ts.
 * Inlined rather than imported from api.ts to avoid a ui.ts↔api.ts cycle
 * (api.ts already imports dismissOverlays from this file).
 */
const JOB_ID_MAX_LENGTH = 8;

interface SitesProbeResult {
  ok: boolean;
  status: number;
  resolvedId: string;
  bodySnippet: string;
}

/** The classifying signals captured at a preview-gate timeout. */
interface PreviewGateSignals {
  isTypeJob: boolean;
  resolvedIsJob: boolean;
  skeletonVisible: boolean;
  loaderVisible: boolean;
  iframeVisible: boolean;
}

/**
 * Pure classification of the M1 preview-gate signals into a dominant
 * signature. Extracted from the logging path so the decision-gate logic is
 * side-effect free — kept pure so it can be exported and unit-tested once a
 * runner exists for tests/ (none today). Order matters: build-stage
 * (skeleton/loader still up) is checked first because a stuck build can also
 * carry a stale ?type=job — see the "also present" hint in the dump.
 */
function classifyPreviewGate(signals: PreviewGateSignals): PreviewGateSignature {
  if (signals.skeletonVisible || signals.loaderVisible) return 'build-latency';
  if (signals.isTypeJob || signals.resolvedIsJob) return 'job-unresolved';
  if (!signals.iframeVisible) return 'preview-cold-start';
  return 'unknown';
}

/**
 * Parse a develop URL into the id segment and whether it is still a
 * quick-create job (`?type=job`). Pure; falls back to a substring check if the
 * URL is somehow unparseable (shouldn't happen for page.url()).
 */
function parseDevelopUrl(url: string): { isTypeJob: boolean; developId: string } {
  try {
    const parsed: URL = new URL(url);
    const match: RegExpMatchArray | null = parsed.pathname.match(/\/develop\/([^/]+)/);
    return { isTypeJob: parsed.searchParams.get('type') === 'job', developId: match ? match[1] : '' };
  } catch {
    return { isTypeJob: url.includes('type=job'), developId: '' };
  }
}

/** Bound the diagnostic probe — it runs on an already-wedged page, so an unbounded fetch could hang until the global test timeout. */
const SITES_PROBE_TIMEOUT_MS = 10000;

/**
 * One-shot `GET /api/sites?site_id=<id>` probe used only for timeout
 * diagnostics. Mirrors the evaluate shape in `waitForJobResolution` (api.ts)
 * but with an AbortController bound so it can't extend the failure it is
 * diagnosing. Returns null only when there is no id to probe; on fetch/abort
 * failure it returns a result with `status: -1` and the error text in
 * `bodySnippet`, so the caller prints it in-order inside the diagnostics block
 * (never a stray line, never a masked timeout).
 */
async function probeSitesForId(page: Page, id: string): Promise<SitesProbeResult | null> {
  if (!id) return null;
  try {
    const result: { ok: boolean; status: number; body: string } = await page.evaluate(
      async ({ siteId, timeoutMs }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(`/api/sites?site_id=${encodeURIComponent(siteId)}`, {
            signal: controller.signal,
          });
          const body = await response.text();
          return { ok: response.ok, status: response.status, body };
        } finally {
          clearTimeout(timer);
        }
      },
      { siteId: id, timeoutMs: SITES_PROBE_TIMEOUT_MS },
    );

    let resolvedId: string = '';
    try {
      const parsed: { id?: unknown } = JSON.parse(result.body);
      resolvedId = typeof parsed.id === 'string' ? parsed.id : '';
    } catch {
      // Non-JSON body — leave resolvedId empty; bodySnippet still surfaces it.
    }
    return { ok: result.ok, status: result.status, resolvedId, bodySnippet: result.body.slice(0, 200) };
  } catch (error) {
    return { ok: false, status: -1, resolvedId: '', bodySnippet: `probe threw: ${String(error).slice(0, 200)}` };
  }
}

/** Where the fix for a given signature lives — printed as the last diagnostic line. */
function previewGateSignatureOwner(signature: PreviewGateSignature): string {
  switch (signature) {
    case 'build-latency':
      return 'product (first-build latency) — M3 pools may help';
    case 'job-unresolved':
      return 'create helper (M2 waitForJobResolution) + product (DPP-handoff orphan)';
    case 'preview-cold-start':
      return 'product/infra — preview container cold-start (out of scope; escalate to preview/mhp-core owners)';
    default:
      return 'unknown — inspect the signals above';
  }
}

/**
 * On a preview-gate timeout, dump the three signals from the M1 plan (URL /
 * job-resolution state, /api/sites probe, skeleton/loader/iframe visibility)
 * and the classified signature to stdout. Stdout is the decision-gate channel:
 * it shows in Actions job logs and in the HTML/blob per-test stdout. A
 * machine-readable channel for the M5 adjusted-rate report (parse blob stdout,
 * or add a JUnit annotation) is deferred to M5, when that classifier is built.
 * Best-effort: any internal error is swallowed so this never masks the
 * original timeout.
 */
async function logPreviewGateTimeout(page: Page, startedAtMs: number, caughtError: unknown): Promise<void> {
  try {
    const elapsedSec: number = Math.round((Date.now() - startedAtMs) / 1000);
    const url: string = page.url();
    const { isTypeJob, developId }: { isTypeJob: boolean; developId: string } = parseDevelopUrl(url);

    const skeletonVisible: boolean = await page
      .getByTestId('develop-skeleton')
      .isVisible()
      .catch((): boolean => false);
    const loaderVisible: boolean = await page
      .getByTestId('develop-chat-pane-loader')
      .isVisible()
      .catch((): boolean => false);
    const iframeVisible: boolean = await page
      .getByTestId('preview-iframe')
      .isVisible()
      .catch((): boolean => false);

    const probe: SitesProbeResult | null = await probeSitesForId(page, developId);
    const resolvedIsJob: boolean =
      probe !== null && probe.resolvedId.length > 0 && probe.resolvedId.length <= JOB_ID_MAX_LENGTH;

    const signals: PreviewGateSignals = { isTypeJob, resolvedIsJob, skeletonVisible, loaderVisible, iframeVisible };
    const signature: PreviewGateSignature = classifyPreviewGate(signals);
    // Derive the stage label from the signature so build-stage has a single
    // definition (in classifyPreviewGate), not a second copy here.
    const stage: string = signature === 'build-latency' ? 'build-stage' : 'preview-boot-stage';
    // Strip ANSI color codes — Playwright colorizes matcher messages, and this
    // line is part of the stdout contract the M5 classifier will parse.
    const rawFailure: string = caughtError instanceof Error ? caughtError.message : String(caughtError);
    const failedAt: string = rawFailure.split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '');

    console.log('  [PREVIEW GATE TIMEOUT DIAGNOSTICS]');
    console.log(`    signature: ${signature}`);
    console.log(`    failed at: ${failedAt.slice(0, 200)}`);
    console.log(`    stage: ${stage} (elapsed ~${elapsedSec}s)`);
    console.log(`    url: ${url}`);
    console.log(`    type=job in url: ${isTypeJob} (develop id: ${developId || '<none>'})`);
    if (probe === null) {
      console.log('    GET /api/sites?site_id: <not probed>');
    } else {
      console.log(
        `    GET /api/sites?site_id: HTTP ${probe.status} ok=${probe.ok} ` +
          `resolvedId=${probe.resolvedId || '<none>'} jobShaped=${resolvedIsJob}`,
      );
      if (!probe.ok) console.log(`    /api/sites body: ${probe.bodySnippet}`);
    }
    console.log(`    develop-skeleton visible: ${skeletonVisible}`);
    console.log(`    develop-chat-pane-loader visible: ${loaderVisible}`);
    console.log(`    preview-iframe visible: ${iframeVisible}`);
    // A build-stage timeout that still carries job signals may hide unresolved
    // jobs inside the build-latency bucket — flag it for cron analysis.
    if (signature === 'build-latency' && (isTypeJob || resolvedIsJob)) {
      console.log('    note: job-unresolved signals also present under this build-stage timeout');
    }
    console.log(`    → fix lives in: ${previewGateSignatureOwner(signature)}`);
  } catch (error) {
    console.log(`  [PREVIEW GATE TIMEOUT DIAGNOSTICS] capture failed: ${String(error).slice(0, 200)}`);
  }
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
    // M1 diagnostics: on any preview-gate timeout, dump the classifying signals
    // to stdout and re-throw the ORIGINAL error unchanged. Purely additive —
    // control flow, the error, its stack, and pass/fail are identical to
    // before; only extra stdout is produced. Machine-readable classification
    // for the M5 adjusted-rate report is deferred to M5.
    const previewGateStartedAt: number = Date.now();
    try {
      await expect(page.getByTestId('develop-skeleton')).not.toBeVisible({ timeout: PREVIEW_TIMEOUT });
      await expect(page.getByTestId('develop-chat-pane-loader')).not.toBeVisible({ timeout: PREVIEW_TIMEOUT });

      await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
      await expect(page.getByTestId('preview-iframe')).toHaveAttribute('src', /.+/);
    } catch (error) {
      await logPreviewGateTimeout(page, previewGateStartedAt, error);
      throw error;
    }
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
  await page.getByTestId('project-card-edit-button').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
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

  const submitButton = page.getByTestId('homepage-prompt-submit');
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

  const submitButton = page.getByTestId('homepage-prompt-submit');
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

  const submitButton = page.getByTestId('homepage-prompt-submit');
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
  const congratsModal = page.getByTestId('first-publish-congrats-modal');
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
  const laterButton = page.getByTestId('go-live-modal-later');

  // Wait for the modal's dismiss button (it surfaces asynchronously after a
  // first publish) instead of sleeping the full budget unconditionally.
  const appeared = await laterButton
    .waitFor({ state: 'visible', timeout: waitTime })
    .then(() => true)
    .catch(() => false);

  if (appeared) {
    await laterButton.click();
    await expect(laterButton).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    console.log('Dismissed Go Live modal (first publish)');
    return true;
  }

  console.log('No Go Live modal appeared (republish or already gone live)');
  return false;
}

/**
 * Wait for AI generation to complete. Handles interruptions that block the
 * stream: ask-question panels (clicks Skip to dismiss) and publish
 * confirmation modals (clicks approve). Waits until chat-send-button appears.
 *
 * The publish confirmation modal (HITL gate) blocks the agent stream in ALL
 * environments — including local where no real deployment pipeline exists.
 * Always pass approvePublish: true when the prompt instructs the agent to publish.
 */
export async function waitForGenerationComplete(
  page: Page,
  timeout = AI_RESPONSE_TIMEOUT_MS,
  { approvePublish = false }: { approvePublish?: boolean } = {},
): Promise<void> {
  const sendButton = page.getByTestId('chat-send-button');
  const askQuestionSkip = page.getByTestId('ask-question-skip');

  const aborted = { value: false };

  const handlePublishLoop = approvePublish
    ? (async () => {
        const confirmButton = page.getByTestId('agent-publish-confirm-button');
        while (!aborted.value) {
          const found = await confirmButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
          if (aborted.value) return;
          if (found) {
            console.log('  Approving agent publish confirmation');
            await confirmButton.click().catch((err) => console.log('  [publish click failed]', err.message));
            await confirmButton.waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT }).catch(() => {});
            continue;
          }
          // Fallback: @ux/disrupt portals can evade Playwright visibility checks.
          const clicked = await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="agent-publish-confirm-button"]') as HTMLElement | null;
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          });
          if (clicked) {
            console.log('  Approving agent publish confirmation (DOM fallback)');
            await page.waitForTimeout(1000);
          }
        }
      })()
    : Promise.resolve();

  const handleAskQuestionLoop = (async () => {
    while (!aborted.value) {
      const found = await askQuestionSkip.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
      if (aborted.value) return;
      if (found) {
        const firstOption = page.getByTestId('ask-question-choice-list').locator('[role="option"]').first();
        if (await firstOption.isVisible().catch(() => false)) {
          console.log('  Ask-question detected, picking first option');
          await firstOption.click().catch((err) => console.log('  [option click failed]', err.message));
        } else {
          console.log('  Ask-question detected, clicking Skip (no options visible)');
          await askQuestionSkip.click().catch((err) => console.log('  [skip click failed]', err.message));
        }
        await page.waitForTimeout(1000);
      }
    }
  })();

  try {
    await expect(sendButton).toBeVisible({ timeout });
  } finally {
    aborted.value = true;
    await Promise.allSettled([handlePublishLoop, handleAskQuestionLoop]);
  }
}

