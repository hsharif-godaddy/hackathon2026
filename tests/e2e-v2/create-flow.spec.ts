/**
 * Create flow — homepage submit → SSO → develop redirect → app created.
 *
 * Coverage equivalent to Step 1 of the legacy `tests/e2e/e2e.spec.ts`
 * monolith, isolated into its own spec. Originally intended as the only
 * spec exercising the homepage create flow (other specs were going to use
 * `createSiteViaApi` for speed), but `createSiteViaApi` + a direct
 * `/develop/<id>` navigation proved unreliable for any test that waited
 * >5 min on AI-streaming gates — so chat-send / develop-ui /
 * publish-and-domain all do their own homepage submit in `beforeAll`. This
 * file remains the canonical spec for selector regressions on the home
 * prompt, hydration race conditions, and the SSO-then-redirect sequence.
 *
 * Concurrency: serial / 1 worker. The test handles SSO and we don't want
 * concurrent logins racing on the shared shopper account.
 */
import { test, expect } from '@playwright/test';

import { deleteApp, deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api';
import { detectSsoType, handleSsoLogin, isSignInUIResult } from '../helpers/auth';
import {
  CHAT_INPUT_TIMEOUT,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  getSpecPrefix,
} from '../helpers/constants';
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui';

const SPEC_NAME = 'create-flow';

test.describe.configure({ mode: 'serial' });

// Every e2e-v2 spec already starts with no storageState (live SSO per
// test, see playwright.config.ts notes). This spec deliberately exercises
// the cold-start homepage → SSO → develop redirect path, which is what
// the existing `detectSsoType` / `handleSsoLogin` calls below already
// drive — so no fixture override is needed here.

test.describe('E2E v2 - Create flow', () => {
  let createdAppId: string | null = null;

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    createdAppId = null;
    if (!E2E_NO_DELETE) {
      await page.goto('/');
      await evictOldestE2eAppsToFitLimit(page).catch(() => {});
    }
  });

  test('Homepage submit creates app and lands on develop page', async ({ page }, testInfo) => {
    // 3 min: homepage hydration (10 s fixed wait) + SSO redirect + develop-page render.
    testInfo.setTimeout(180_000);

    // Suppress coachmark tour before any navigation so localStorage is set
    // before the develop page reads it.
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });

    await page.goto('/');

    const promptInput = page.getByTestId('homepage-prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });

    // Cookie banner / overlay can intercept clicks on the submit button.
    await dismissOverlays(page);

    await promptInput.fill(
      `${getSpecPrefix(SPEC_NAME)} Simple landing page with a hero section and a call to action button`,
    );

    // data-eid is server-rendered so its presence doesn't prove React hydration,
    // and the disabled-state flips synchronously even before the click handler
    // is attached. Empirically 10 s is enough to cover hydration on the slowest
    // of the four target environments (dev/pre-test/test/prod). networkidle was
    // tried (commit ee364cdee) and was unreliable because background polling
    // requests prevent the page from ever going idle. If a hydration marker is
    // ever exposed (e.g. a data-hydrated attribute on the form), prefer
    // page.waitForFunction over this fixed wait.
    const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
    await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    await page.waitForTimeout(10_000);
    console.log('  Submit button ready');

    await submitButton.click();
    console.log('  Submit clicked');

    const ssoResult = await detectSsoType(page, true);
    if (ssoResult === 'authenticated') {
      console.log('  Already authenticated, proceeding to develop page');
    } else if (isSignInUIResult(ssoResult)) {
      console.log(`  SSO detected (${ssoResult}), logging in...`);
      await handleSsoLogin(page);
    } else {
      throw new Error(
        `Unexpected state after submit: neither SSO nor develop page appeared (got: ${ssoResult})`,
      );
    }

    await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
    await waitForDevelopPage(page);

    // App id in /develop/:id may be a UUID (hyphens). [a-zA-Z0-9]+ truncates
    // hyphenated UUIDs (e.g. abc12345-def6-7890 → abc12345), causing logged
    // app IDs to be wrong and any downstream string-equality checks to fail.
    const appId = page.url().match(/\/develop\/([^/?#]+)/)?.[1] ?? '';
    expect(appId, 'develop URL should contain an app id').not.toBe('');
    createdAppId = appId;
    console.log(`  App created: ${appId}`);

    await dismissOverlays(page);

    // Light verification that develop loaded — full coverage of develop UI lives
    // in develop-ui.spec.ts. We only assert the two surfaces that prove the
    // create→develop transition completed successfully.
    const previewIframe = page.getByTestId('preview-iframe');
    await previewIframe.waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT });
    await expect(previewIframe).toHaveAttribute('src', /.+/);

    const chatInput = page.getByTestId('chat-input-textarea');
    await chatInput.waitFor({ state: 'visible', timeout: CHAT_INPUT_TIMEOUT });
    await expect(chatInput).not.toBeDisabled();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);

    if (E2E_NO_DELETE) {
      console.log('Cleanup skipped (E2E_NO_DELETE=true)');
      return;
    }

    // Prefer the hardened ID-based delete — it surfaces non-200 responses
    // instead of silently leaking. Fall back to prefix-based cleanup only
    // when the test failed before capturing the appId, so a partially
    // created app still gets reclaimed.
    if (createdAppId) {
      try {
        await deleteApp(page, createdAppId);
      } catch (err) {
        console.error(`  Cleanup of app ${createdAppId} failed:`, err);
      }
    } else {
      try {
        await page.goto('/apps');
        await deleteAppsWithPrefix(page, getSpecPrefix(SPEC_NAME));
      } catch (err) {
        console.error(`  Prefix-cleanup fallback failed:`, err);
      }
    }
  });
});
