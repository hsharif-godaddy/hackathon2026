/**
 * Pool-app bootstrap — idempotent setup that ensures the long-lived apps
 * consumed by `e2e-v2` exist for the target env. Run via the dedicated
 * `bootstrap-pool` Playwright project:
 *
 *   pnpm exec playwright test --project=bootstrap-pool --env=test
 *
 * Why a Playwright spec and not a plain node script: app creation goes
 * through the homepage → develop flow and reuses the same auth helpers as
 * the specs (`loginViaSsoDirect` for sign-in, `detectSsoType` /
 * `handleSsoLogin` as a defensive fallback). A `.mjs` script would have to
 * reimplement SSO.
 *
 * Idempotency: each pool is created only if `getPoolAppId` can't already
 * find one. Re-running is cheap when the pool is intact (just two
 * GET /api/sites lookups) and self-healing when an app was deleted.
 *
 * Pool apps carry the `[e2e-pool:<purpose>]` prefix, which the eviction
 * guard and prefix-cleanup helpers skip (they match `[e2e:`), so the pool
 * survives across runs. See tests/e2e/REFACTOR_PLAN.md PR 4 design notes.
 */
import { test, expect } from '../helpers/test-fixtures';

import { deleteApp, findPoolAppId, getPoolPrefix, getPublishedUrl, waitForPublishedUrl } from '../helpers/api';
import { detectSsoType, handleSsoLogin, isSignInUIResult, loginViaSsoDirect } from '../helpers/auth';
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  PUBLISH_TIMEOUT_MS,
  getEnvConfig,
} from '../helpers/constants';
import { dismissOverlays, waitForDevelopPage } from '../helpers/ui';

const { env } = getEnvConfig();
// Auto-publish only works where the deployment pipeline exists (test/prod).
// On local the publish-domain pool can't be pre-published; skip its wait.
const autoPublishSupported = env !== 'local';

/**
 * Create a pool app via the homepage submit flow (mirrors
 * create-flow.spec.ts). Returns the resolved app id. The prompt MUST carry
 * the pool prefix so the eviction guard skips it and `getPoolAppId` can
 * find it on subsequent runs.
 */
async function createPoolApp(
  page: import('@playwright/test').Page,
  prompt: string,
): Promise<string> {
  await page.addInitScript(() => {
    localStorage.setItem('airo-intro-tour-shown', 'true');
  });

  await loginViaSsoDirect(page);
  await page.goto('/');
  await dismissOverlays(page);

  const promptInput = page.getByTestId('homepage-prompt-input');
  await promptInput.waitFor({ state: 'visible', timeout: LONG_TIMEOUT });
  await dismissOverlays(page);
  await promptInput.fill(prompt);

  // 10 s fixed hydration wait — see create-flow.spec.ts for the rationale
  // (data-eid present before hydration; networkidle unreliable here).
  const submitButton = page.locator('[data-eid*="homepage.prompt.submit"]');
  await expect(submitButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
  await page.waitForTimeout(10_000);
  await submitButton.click();

  const ssoResult = await detectSsoType(page, true);
  if (isSignInUIResult(ssoResult)) {
    console.log(`  SSO detected (${ssoResult}) during pool create, logging in...`);
    await handleSsoLogin(page);
  }

  await page.waitForURL(/\/develop\//, { timeout: LONG_TIMEOUT });
  await waitForDevelopPage(page);

  // [^/?#]+ (not [a-zA-Z0-9]+) so hyphenated UUID ids aren't truncated.
  const appId = page.url().match(/\/develop\/([^/?#]+)/)?.[1] ?? '';
  expect(appId, 'develop URL should contain an app id').not.toBe('');
  return appId;
}

test.describe.configure({ mode: 'serial' });

test.describe('Pool app bootstrap', () => {
  test('ensure develop-ui pool app exists (read-only landing page)', async ({ page }) => {
    test.setTimeout(300_000);

    await loginViaSsoDirect(page);
    await page.goto('/');
    await dismissOverlays(page);

    // findPoolAppId returns null only when /api/sites was reached and no app
    // matched (confirmed absent). A transient /api/sites failure THROWS and
    // fails the bootstrap — we must NOT swallow it into "create a new one",
    // which is how duplicate pool apps got minted when the env was flapping.
    const existing = await findPoolAppId(page, 'develop-ui');
    if (existing) {
      console.log(`✓ develop-ui pool app already exists: ${existing}`);
      return;
    }

    const prompt = `${getPoolPrefix('develop-ui')} Simple landing page with a hero section`;
    const appId = await createPoolApp(page, prompt);
    console.log(`✓ Created develop-ui pool app: ${appId}`);
  });

  test('ensure chat-send pool app exists (scratch app for chat round-trips)', async ({ page }) => {
    // Up to 10 min: create + initial AI gen + a generous settle-to-idle wait.
    test.setTimeout(600_000);

    await loginViaSsoDirect(page);
    await page.goto('/');
    await dismissOverlays(page);

    // chat-send mutates the transcript each run (it sends messages), but
    // e2e-v2 runs are serialized per env (workflow concurrency group), so the
    // shared app is never written by two runs at once. The app stays
    // unpublished — chat-send only needs an idle, pre-generated app so the
    // spec's readiness gate isn't a cold-gen wait.
    //
    // Unlike develop-ui, this pool app must be verified IDLE, not merely
    // present: if a prior run or bootstrap disconnected mid-generation it can
    // be left stuck "awaiting stream" (a disabled Stop button, no send button —
    // ChatInput keeps Stop on a busy app with an empty input), which the spec
    // can never recover from. Confirmed-absent → null (create); a transient
    // /api/sites failure throws (don't mint a duplicate).
    const existing = await findPoolAppId(page, 'chat-send');
    if (existing) {
      await page.goto(`/develop/${existing}`);
      await waitForDevelopPage(page);
      const idle = await page
        .getByTestId('chat-stop-button')
        .waitFor({ state: 'hidden', timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      if (idle) {
        console.log(`✓ chat-send pool app already exists and is idle: ${existing}`);
        return;
      }
      // Stuck awaiting/streaming — self-heal by re-seeding (mirrors the
      // publish-domain unpublished-reseed path) rather than failing and
      // requiring a manual delete.
      console.log(
        `  chat-send pool app ${existing} is stuck (stop button never cleared); deleting and re-seeding`,
      );
      await page.goto('/');
      await dismissOverlays(page);
      await deleteApp(page, existing);
    }

    const prompt = `${getPoolPrefix('chat-send')} Simple landing page with a hero section`;
    const appId = await createPoolApp(page, prompt);

    // Wait for the initial generation to fully settle to idle BEFORE this test
    // ends — the test's context closing mid-stream is exactly what leaves the
    // app stuck awaiting. The pool app is only usable once the Stop button is
    // gone (idle). Throws on timeout so we never cache a stuck app.
    await expect(page.getByTestId('chat-stop-button')).toBeHidden({ timeout: AI_RESPONSE_TIMEOUT_MS });
    console.log(`✓ Created chat-send pool app (idle): ${appId}`);
  });

  test('ensure publish-domain pool app exists (pre-published landing page)', async ({ page }) => {
    // Up to 15 min: create + AI gen + auto-publish wait.
    test.setTimeout(900_000);

    await loginViaSsoDirect(page);
    await page.goto('/');
    await dismissOverlays(page);

    // See develop-ui above: confirmed-absent → null (create); transient
    // /api/sites failure throws (don't create a duplicate).
    const existing = await findPoolAppId(page, 'publish-domain');
    if (existing) {
      if (!autoPublishSupported) {
        console.log(`✓ publish-domain pool app exists: ${existing} (publish not required on ${env})`);
        return;
      }
      // Reuse ONLY if it's genuinely published. A stale pool app whose publish
      // never landed must be re-seeded, not silently reused — that exact
      // false-positive (ephemeral growl matched, deploy never landed) is what
      // motivated switching the check to published_url.
      const publishedUrl = await getPublishedUrl(page, existing);
      if (publishedUrl) {
        console.log(`✓ publish-domain pool app already published: ${existing} → ${publishedUrl}`);
        return;
      }
      // Broken pool: exists but its publish never landed. Auto-reseed —
      // delete it and fall through to recreate — rather than throwing and
      // requiring a manual delete (operationally painful in CI). This mirrors
      // the self-healing missing-pool path below.
      console.log(
        `  publish-domain pool app ${existing} has no published_url (publish never landed); ` +
          `deleting and re-seeding`,
      );
      await deleteApp(page, existing);
    }

    const prompt =
      `${getPoolPrefix('publish-domain')} Simple landing page - ` +
      `do not ask follow up questions and publish this app`;
    const appId = await createPoolApp(page, prompt);
    console.log(`  Created publish-domain pool app: ${appId}`);

    if (autoPublishSupported) {
      // Authoritative publish verification: poll GET /api/sites until the app
      // has a published_url, instead of matching the ephemeral publish-success
      // growl (which can fire — or be matched — without the deploy landing,
      // caching a non-published pool app). Throws on timeout so we never cache
      // a broken pool app.
      const publishedUrl = await waitForPublishedUrl(page, appId, { timeoutMs: PUBLISH_TIMEOUT_MS });
      console.log(`✓ publish-domain pool app published: ${appId} → ${publishedUrl}`);
    } else {
      console.log(`✓ publish-domain pool app created (auto-publish skipped on ${env}): ${appId}`);
    }
  });
});
