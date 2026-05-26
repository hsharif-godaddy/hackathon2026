// DPP → /develop hand-off regression: cross-session re-send guard + cold-overlay fix.
// See docs/dpp-develop-handoff.md and scripts/dpp-local-repro.sh. Skipped on local/dev (no /v1/apps).
import { test, expect, type APIRequestContext } from '@playwright/test'

import { deleteAppsWithPrefix, evictOldestE2eAppsToFitLimit } from '../helpers/api'
import { loginIfNeeded } from '../helpers/auth'
import {
  AI_RESPONSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT,
  E2E_NO_DELETE,
  LONG_TIMEOUT,
  PREVIEW_TIMEOUT,
  getEnvConfig,
  getSpecPrefix,
} from '../helpers/constants'
import { dismissOverlays, logTestResult, logTestStart, waitForDevelopPage } from '../helpers/ui'

const SPEC_NAME = 'develop-dpp-handoff'

/**
 * Per-environment mgmt-airo base URL. Mirrors `MGMT_AIRO_BASE_URL` in
 * app/.env.local.* (the BFF reads the same value from process.env at runtime).
 * Returning null gates the spec into a `test.skip()` so we don't fire fake
 * traffic at local-control-plane (which doesn't implement /v1/apps).
 */
function mgmtAiroBaseUrl(): string | null {
  const { env } = getEnvConfig()
  switch (env) {
    case 'test':
    case 'pre-test':
      return 'https://mgmt.nstk.net'
    case 'prod':
      // Per docs/app-route.md base-URL table; differs from MGMT_AIRO_BASE_URL
      // in app/.env.local.prod (mgmt.woosaas.godaddy.com), but the unified
      // /v1/apps doc is the source of truth for this endpoint.
      return 'https://mgmt.mwcs.godaddy.com'
    case 'local':
    case 'dev':
      return null
  }
}

interface ProvisionAppResult {
  statusJobId: string
}

/**
 * Call `POST /api/airo/v1/apps` with the provided shopper JWT — this is the
 * same call DPP makes after a successful domain purchase. The response is
 * always 202 Accepted with a `statusJobId` we navigate to next.
 *
 * Using Playwright's `APIRequestContext` (not the page) so we don't carry the
 * builder's cookies onto a different host — mgmt-airo is on a separate
 * origin and the only auth we need is the bearer-style `sso-jwt` header.
 */
async function provisionAppViaMgmtAiro(
  request: APIRequestContext,
  jwt: string,
  body: {
    productId: string
    fqdn: string
    initialPrompt: string
    title: string
  },
): Promise<ProvisionAppResult> {
  const baseUrl = mgmtAiroBaseUrl()
  if (!baseUrl) throw new Error('mgmtAiroBaseUrl returned null — should have been gated by test.skip')

  const response = await request.post(`${baseUrl}/api/airo/v1/apps`, {
    headers: {
      Authorization: `sso-jwt ${jwt}`,
      'Content-Type': 'application/json',
    },
    data: {
      productId: body.productId,
      datacenter: 'sxb1',
      isTrial: true,
      fqdn: body.fqdn,
      appConfigs: [
        {
          templateName: 'default',
          variables: {
            fqdn: body.fqdn,
            initialPrompt: body.initialPrompt,
            title: body.title,
          },
        },
      ],
    },
  })

  if (response.status() !== 202) {
    const text = await response.text().catch(() => '<unreadable>')
    throw new Error(
      `POST ${baseUrl}/api/airo/v1/apps returned ${response.status()} (expected 202). Body: ${text}`,
    )
  }

  const json = (await response.json()) as { statusJobId?: string }
  if (!json.statusJobId) {
    throw new Error(`POST /v1/apps response had no statusJobId: ${JSON.stringify(json)}`)
  }
  return { statusJobId: json.statusJobId }
}

/**
 * Extract the SSO shopper JWT from the authenticated browser context. The
 * builder app stores it under the `auth_idp` cookie on the airo-builder host
 * (see `app/src/lib/gd-auth-service.ts:23`). mgmt-airo expects the bare token
 * with the `sso-jwt` scheme prefix — the prefix is added at the call site, so
 * this helper returns the raw value.
 */
async function getSsoJwtFromContext(
  context: import('@playwright/test').BrowserContext,
): Promise<string> {
  const cookies = await context.cookies()
  const authIdp = cookies.find((c) => c.name === 'auth_idp')
  if (!authIdp || !authIdp.value) {
    const names = cookies.map((c) => c.name).join(', ')
    throw new Error(`auth_idp cookie missing after SSO login. Cookies: ${names}`)
  }
  return authIdp.value
}

const flagKey = (appId: string): string => `initial-prompt-auto-sent-${appId}`

/**
 * Return the realAppId after the URL has flipped from the initial
 * /develop/{statusJobId}?type=job to /develop/{realAppId}. The flip happens
 * once `creationPhase === 'complete'` (see useInitialization.ts:898) which
 * can take a couple of minutes for a fresh provision; PREVIEW_TIMEOUT is the
 * existing budget for first-app generation in regression specs.
 */
async function waitForRealAppIdFlip(
  page: import('@playwright/test').Page,
  statusJobId: string,
): Promise<string> {
  await page.waitForURL(
    (url) => {
      const match = url.pathname.match(/\/develop\/([a-zA-Z0-9-]+)/)
      const segment = match?.[1]
      return !!segment && segment !== statusJobId && !url.searchParams.has('type')
    },
    { timeout: PREVIEW_TIMEOUT },
  )
  const match = page.url().match(/\/develop\/([a-zA-Z0-9-]+)/)
  const realAppId = match?.[1]
  if (!realAppId) throw new Error(`URL did not flip to a realAppId form: ${page.url()}`)
  return realAppId
}

test.describe('Develop — DPP cold redirect → no re-send on reload', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo)
    const baseUrl = mgmtAiroBaseUrl()
    test.skip(
      baseUrl === null,
      'DPP hand-off spec only runs against environments with the unified /v1/apps endpoint (test, pre-test, prod).',
    )
    if (!E2E_NO_DELETE) {
      await page.goto('/')
      await evictOldestE2eAppsToFitLimit(page).catch(() => {})
    }
  })

  test.afterEach(async ({ page }, testInfo) => {
    if (!E2E_NO_DELETE) {
      await deleteAppsWithPrefix(page, getSpecPrefix(SPEC_NAME)).catch(() => {})
    }
    await logTestResult(page, testInfo)
  })

  test('cold redirect auto-sends once, overlay clears, and reload (flag in place / cleared) does not re-send or re-show overlay', async ({
    page,
    context,
    request,
  }, testInfo) => {
    testInfo.setTimeout(600_000)

    // Disable the coachmark tour so it doesn't cover the chat composer when
    // we land on the develop page (mirrors develop-chat.spec.ts:64).
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true')
    })

    const prefix = getSpecPrefix(SPEC_NAME)
    // Keep the prompt body short (~22 chars) — manual DPP repros against
    // the same backends consistently complete with this shape, while the
    // longer salted-prefix-in-prompt variant correlated with agent hangs
    // post-tool-result. The bracketed prefix lives in the title so
    // `deleteAppsWithPrefix` still matches via `site.name`; the short
    // A-{salt} marker is what we filter transcript user-bubbles on.
    const runId = prefix.match(/:([a-z0-9]+)\]$/)?.[1] ?? 'x'
    const promptMarker = `A-${runId}`
    const initialPrompt = `create hello world ${promptMarker}`

    // Salt the fqdn so parallel runs / retries don't collide on hostname.
    const saltedFqdn = `${prefix.replace(/[^a-z0-9]/gi, '').toLowerCase()}.tacopizza.space`

    console.log('🔐 Step 1: Logging in to extract shopper JWT...')
    await page.goto('/')
    await dismissOverlays(page)
    // `loginIfNeeded` opens the user-menu, checks for Sign Out, and triggers
    // the SSO surface via the menu's Sign In button when not authed. We can't
    // use `handleSsoLogin` directly here — that helper assumes the SSO surface
    // is already showing, but visiting `/` alone doesn't trigger it (the
    // homepage submit chain is what triggers it for other specs).
    await loginIfNeeded(page)
    const jwt = await getSsoJwtFromContext(context)
    console.log(`  ✓ Got auth_idp cookie (length=${jwt.length})`)

    console.log('🚀 Step 2: POST /api/airo/v1/apps (DPP-shaped provision call)...')
    const { statusJobId } = await provisionAppViaMgmtAiro(request, jwt, {
      productId: 'aab-v1',
      fqdn: saltedFqdn,
      initialPrompt,
      title: prefix,
    })
    console.log(`  ✓ statusJobId=${statusJobId}`)

    console.log('🌐 Step 3: Navigate to /develop/{statusJobId}?type=job ...')
    await page.goto(`/develop/${statusJobId}?type=job`, { timeout: LONG_TIMEOUT })

    console.log('⏳ Step 4: Wait for URL flip to /develop/{realAppId} ...')
    const realAppId = await waitForRealAppIdFlip(page, statusJobId)
    console.log(`  ✓ realAppId=${realAppId}`)

    await waitForDevelopPage(page)
    await dismissOverlays(page)

    const transcript = page.getByTestId('chat-transcript')
    await expect(transcript).toBeVisible({ timeout: LONG_TIMEOUT })

    console.log('💬 Step 5: Confirm exactly one user message with our marker...')
    // The auto-send injects "This site is for {fqdn}. {initialPrompt}" (the
    // FQDN preamble is provenance-neutral — see [id]/page.tsx:1426). The
    // A-{salt} marker is unique to this run and appears once if everything
    // is working.
    //
    // Narrow to user-bubble elements via the chat-message-user testid so the
    // count assertion measures user submits — not any element whose text
    // happens to contain the marker (chat-history virtualization, NBA cards,
    // status headers, etc. could otherwise inflate the count and silently
    // weaken the regression guard).
    const userMessages = transcript
      .locator('[data-testid="chat-message-user"]')
      .filter({ hasText: promptMarker })
    await expect(userMessages).toHaveCount(1, {
      timeout: AI_RESPONSE_TIMEOUT_MS,
    })

    console.log('🚩 Step 6: Confirm durable flag was written...')
    const flagAfterAutoSend = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      flagKey(realAppId),
    )
    expect(flagAfterAutoSend).toBe('true')

    console.log('⏳ Step 6.5: Wait for first edit — preview-iframe visible (sync point)...')
    // Sync barrier before the reload steps. preview-iframe becoming visible
    // means the agent has replied at least once — `conversation_info` has
    // landed (so the conversationId cookie is set) and at least one file
    // edit has been applied (so server-side history is populated). The
    // reload steps below need both prerequisites in place to exercise the
    // existing-app gate path that #4074 fixed.
    //
    // Deliberately NOT asserting overlay==0 here. On the cold path the
    // overlay's lifecycle is agent-timed: it can stay up across clarifying
    // questions, multi-step builds, or slow streaming — none of which
    // implicate the #4074 bug. The deterministic regression invariant is
    // "reload of an existing app does not re-show the overlay," asserted
    // in steps 7 and 8.
    await page.getByTestId('preview-iframe').waitFor({ state: 'visible', timeout: PREVIEW_TIMEOUT })

    console.log('🔄 Step 7: Reload with flag in place — must not re-send or re-show overlay...')
    await page.reload({ timeout: LONG_TIMEOUT })
    await waitForDevelopPage(page)
    await expect(transcript).toBeVisible({ timeout: LONG_TIMEOUT })
    // Give any spurious auto-send a window to fire before locking in the
    // count. The auto-send effect runs on the first `websocketConnected`
    // tick, so 5s is comfortably past it.
    await page.waitForTimeout(5_000)
    await expect(
      transcript.locator('[data-testid="chat-message-user"]').filter({ hasText: promptMarker }),
    ).toHaveCount(1)
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), flagKey(realAppId)),
    ).toBe('true')
    // Existing-app load must not re-show the building overlay. With the
    // conversation-cookie now set (from the first auto-send), the gate falls
    // back to the historyLoadingComplete + hasMessages branches, which
    // short-circuit hydration. preview-iframe stays visible, overlay stays gone.
    await expect(page.getByTestId('preview-iframe')).toBeVisible({ timeout: PREVIEW_TIMEOUT })
    await expect(page.getByTestId('preview-building-overlay')).toHaveCount(0)

    console.log('🧨 Step 8: Clear flag, reload — history guard must hold AND overlay must stay gone...')
    await page.evaluate((key) => window.localStorage.removeItem(key), flagKey(realAppId))
    await page.reload({ timeout: LONG_TIMEOUT })
    await waitForDevelopPage(page)
    await expect(transcript).toBeVisible({ timeout: LONG_TIMEOUT })
    await page.waitForTimeout(5_000)
    await expect(
      transcript.locator('[data-testid="chat-message-user"]').filter({ hasText: promptMarker }),
    ).toHaveCount(1)
    // Without the localStorage flag the conversation-history guard must hold,
    // and the overlay must still not re-appear.
    await expect(page.getByTestId('preview-iframe')).toBeVisible({ timeout: PREVIEW_TIMEOUT })
    await expect(page.getByTestId('preview-building-overlay')).toHaveCount(0)

    console.log('🍪 Step 9: Cookie-less reload — strict gate must wait for history, not infer fresh-app from missing cookie...')
    // Pins the #4111 fix: cookie-less reload of an existing app must not re-fire auto-send.
    await page.context().clearCookies({ name: `conversationId_${realAppId}` })
    // Also clear the localStorage flag to disable the durable belt-and-
    // suspenders guard, isolating the cookie-less + history-guard path.
    await page.evaluate((key) => window.localStorage.removeItem(key), flagKey(realAppId))
    await page.reload({ timeout: LONG_TIMEOUT })
    await waitForDevelopPage(page)
    await expect(transcript).toBeVisible({ timeout: LONG_TIMEOUT })
    await page.waitForTimeout(5_000)
    await expect(
      transcript.locator('[data-testid="chat-message-user"]').filter({ hasText: promptMarker }),
    ).toHaveCount(1)
    await expect(page.getByTestId('preview-iframe')).toBeVisible({ timeout: PREVIEW_TIMEOUT })
    await expect(page.getByTestId('preview-building-overlay')).toHaveCount(0)

    console.log('✅ DPP hand-off regression: refresh-no-resend AND overlay-no-re-show confirmed (incl. cookie-less)')
  })
})
