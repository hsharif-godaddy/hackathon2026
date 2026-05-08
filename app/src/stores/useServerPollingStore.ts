import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

// Enable Immer MapSet plugin for Map support
enableMapSet()

/**
 * Get site-scoped JWT token for preview app authentication
 *
 * Preview apps run on different domains than the builder app:
 * - Production: preview.c4.test-airoapp.ai vs airo-builder.test-godaddy.com
 * - Local: localhost vs local.gasket.dev-godaddy.com
 *
 * This function retrieves a site-scoped JWT from the builder that can be used
 * to authenticate with the preview app. The JWT is scoped to the specific site
 * to prevent authorization bypass attacks.
 *
 * @param siteId - The site ID to generate token for
 * @returns Site-scoped JWT token or null if unavailable
 */
// Bootstrap-race prevention: ensure the managed customer process (vite/node)
// is actually serving requests before issuing the auth-bearing bootstrap
// fetch. dev-supervisor's /airo/health is JWT-excluded but PASSIVE — it
// reports the current process state without triggering a wake-up.
//
// See dev-supervisor/internal/proxy/http/health.go for the response shape:
//   - 200 {"status":"healthy"}                    → vite probe returned 2xx;
//                                                    actually ready to serve
//   - 200 {"status":"healthy","reason":"autostart"} → process stopped but
//                                                    autostart-capable; the
//                                                    next authed request to
//                                                    `/` will trigger
//                                                    `handleAutoStart` and
//                                                    block until vite binds
//   - 503 {"status":"unhealthy",...}              → starting transition /
//                                                    target unreachable
//
// Strategy:
//   1. Poll /airo/health for up to HEALTH_POLL_TIMEOUT_MS.
//   2. If we ever see "actually ready" (200 with no `reason: autostart`),
//      return true.
//   3. If we see `reason: autostart`, the process is hibernated. Issue a
//      blocking `HEAD /` with the JWT — this routes through dev-supervisor's
//      RequestRouter (router.go:22-30), triggers handleAutoStart
//      (autostart.go:22), and the request stays open until vite is ready.
//      Server-side deadline is 60s for state transition + 30s for TCP
//      probe = 90s total worst case (autostart.go:66, autostart.go:17).
//      When the HEAD returns 2xx, dev-supervisor has forwarded the
//      original request to vite (autostart.go:105) and the response is
//      vite's actual response — guaranteeing readiness. (We don't
//      re-poll /airo/health afterward; the wake-up response IS the
//      readiness signal.)
//   4. If we never see 200 within the deadline (only 503 / errors), the
//      process is in transition; return false and let the outer polling
//      cycle retry.
//
// Why blocking wake-up vs fire-and-forget poll: dev-supervisor's
// handleAutoStart already implements the "block until ready" semantics for
// us. Polling concurrently with it would create two in-flight requests to
// `/` (handled gracefully via ErrAlreadyStarting, but wasteful) and add a
// second source of truth. Letting one request both trigger and confirm
// keeps the contract simple.
//
// Why this isn't unifiable into a single bootstrap call: the auth bootstrap
// in _checkUrlHealth needs a HEAD request that sets the cross-domain
// `preview_auth` cookie via Set-Cookie. The wake-up here uses the same JWT
// but conceptually has a different job ("trigger autostart"). Once vite is
// up, the bootstrap proceeds; if its first try happens to succeed, the
// cookie is set in one round trip rather than two — but the wake-up
// guarantees that the bootstrap doesn't race against an idle process.
//
// Exported for unit tests in useServerPollingStore.test.ts.
export const HEALTH_POLL_TIMEOUT_MS = 5000
export const HEALTH_POLL_INTERVAL_MS = 250
export const HEALTH_PROBE_TIMEOUT_MS = 2000
// Hibernation wake-up uses dev-supervisor's autostart-and-block path.
// dev-supervisor's own budget is two-phase:
//   1. autostart.go:66 — wait up to 60s for ProcessState → Running
//   2. autostart.go:17 (tcpProbeDeadline) — after Running, probe backend
//      TCP for up to 30s before forwarding
// Total worst-case server-side: 90s. We use 100s here to give a small
// client-side margin (network RTT, scheduling jitter). Using a value
// shorter than ~95s would cause the AbortController to cancel the HEAD
// while dev-supervisor is still legitimately working — exactly the
// failure mode this PR exists to fix.
export const WAKEUP_TIMEOUT_MS = 100000

// Bootstrap-fetch retry — sets the cross-domain `preview_auth` cookie via
// dev-supervisor's `/airo/auth-check` endpoint, with a small retry budget
// for transient failures. CRITICAL: the bootstrap targets `/airo/auth-check`
// (not the root `/`) so the request bypasses dev-supervisor's RequestRouter
// and never triggers autostart.
//
// Why /airo/auth-check specifically:
//   - server.go:125 registers `/airo/auth-check` directly on the mux
//     (not via the `/` → RequestRouter path).
//   - JWT middleware wraps the mux, so the request goes through Bearer
//     auth and middleware.go:130-160 queues Set-Cookie on validation.
//   - handleAuthCheck (auth_check.go:19) writes the JSON response body
//     immediately, FLUSHING the response. The Set-Cookie travels on the
//     same flush — typically ~100ms total.
//   - vite is never involved. autostart is never triggered. Cookie
//     reaches the browser regardless of customer-process state.
//
// Why this matters: a previous design sent HEAD `/` for the bootstrap.
// JWT middleware queued Set-Cookie, but the request then flowed to
// RequestRouter → handleAutoStart, which BLOCKED the response for up
// to 90s waiting for vite. If the client AbortController fired before
// vite was ready, the response was never flushed and the cookie never
// crossed the wire — even though it had been "set" in dev-supervisor's
// in-memory header buffer. Hibernated apps systematically failed this
// bootstrap. Switching to `/airo/auth-check` decouples cookie-set from
// vite-readiness entirely.
//
// Distinct from the PR #3489 retry approach this restores: then, retry
// was the PRIMARY mechanism for absorbing startup-race latency
// (vite-not-yet-bound returning 502). Now, prevention (waitForViteReady)
// handles vite-readiness as a separate concern, and the bootstrap is
// vite-independent. Retry only catches transients in dev-supervisor
// itself: brief 5xx, network blip, JWKS-fetch hiccup — things that
// recover within a few attempts.
//
// Only 5xx and network/timeout errors retry. 4xx (auth failures) and
// status 0 (opaque-redirect from `redirect: 'manual'`) are definitive —
// won't recover on retry, break early to save the backoff budget.
//
// Sleep schedule between attempts: 250ms then 750ms (BACKOFF_BASE_MS *
// 3^attempt; only the first two sleeps fire across 3 attempts).
// Worst-case total: 3 × 5s timeout + 1s backoff = ~16s when fully
// exhausted on persistent 5xx; happy path (first 200) is one round trip.
export const MAX_BOOTSTRAP_ATTEMPTS = 3
export const BOOTSTRAP_BACKOFF_BASE_MS = 250
export const BOOTSTRAP_FETCH_TIMEOUT_MS = 5000

interface HealthBody {
  status?: string
  reason?: string
}

async function probeHealth(healthUrl: string): Promise<{ ok: boolean; body: HealthBody }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      // No credentials — /airo/health is JWT-excluded; sending cookies
      // would just trigger a CORS preflight unnecessarily.
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, body: {} }
    // Defensive parse: if the body isn't JSON or is missing the `reason`
    // field, treat as ready. This avoids a regression on hypothetical
    // pre-`reason`-field dev-supervisor versions where the absence of
    // the field is also "ready".
    const body = await res.json().catch(() => ({}))
    return { ok: true, body: body as HealthBody }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function triggerWakeup(url: string, token: string): Promise<boolean> {
  // Use AbortSignal.timeout for the wake-up; the per-call timeout has to
  // accommodate dev-supervisor's autostart-and-block window (~30s).
  const wakeupController = new AbortController()
  const timeoutId = setTimeout(() => wakeupController.abort(), WAKEUP_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      // No credentials here — this is a wake-up trigger, not the cookie
      // bootstrap. The follow-up bootstrap fetch in _checkUrlHealth uses
      // credentials:'include' to receive the Set-Cookie header.
      redirect: 'manual',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: wakeupController.signal,
    })
    return res.ok
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function waitForViteReady(url: string, token: string | null): Promise<boolean> {
  const healthUrl = new URL('/airo/health', url).toString()
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const { ok, body } = await probeHealth(healthUrl)
      if (ok) {
        if (body.reason !== 'autostart') {
          // Actually ready — vite probe returned 2xx.
          return true
        }
        // Hibernated. Without a token we can't trigger autostart (the
        // wake-up HEAD requires the JWT to pass dev-supervisor's auth
        // middleware), so bail out and let the outer polling cycle retry
        // with a fresh token.
        if (!token) {
          logger.warn('server-polling.wakeup-skipped-no-token', {
            message: 'Preview app is hibernated but no JWT available to trigger wake-up',
            url,
          })
          return false
        }
        // Fire the blocking wake-up and treat its response as the
        // readiness signal.
        try {
          const woke = await triggerWakeup(url, token)
          if (!woke) {
            logger.warn('server-polling.wakeup-failed', {
              message: 'Wake-up HEAD did not return 2xx — autostart may have timed out',
              url,
            })
          }
          return woke
        } catch (wakeupError) {
          logger.warn('server-polling.wakeup-error', {
            message: 'Wake-up request errored or timed out',
            url,
            error: wakeupError instanceof Error ? wakeupError.message : String(wakeupError),
          })
          return false
        }
      }
      // 503 → vite is starting; keep polling until it transitions to 200.
    } catch {
      // Network error / abort on the health probe itself — keep polling
      // until the deadline.
    }
    await new Promise(r => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
  }
  return false
}

/**
 * Bootstrap the cross-domain `preview_auth` cookie via /airo/auth-check.
 *
 * Sends a HEAD to `<previewUrl>/airo/auth-check` with the site-scoped JWT
 * in the Authorization header. dev-supervisor's JWT middleware validates
 * the Bearer, sets Set-Cookie on the response, and forwards to
 * handleAuthCheck which immediately writes a 200. The response (with
 * Set-Cookie) flushes in ~100ms — vite is never involved. See the
 * top-of-file comment block for the full rationale.
 *
 * On 5xx or network/timeout error, retries up to MAX_BOOTSTRAP_ATTEMPTS
 * with backoff. On 4xx (definitive auth failure) or status 0 (opaque
 * redirect from `redirect: 'manual'`), breaks early.
 *
 * @param previewBaseUrl  Preview origin, e.g. `https://abc.preview.c4.airoapp.ai`.
 *                        The `/airo/auth-check` path is appended internally.
 * @param token           Site-scoped JWT, or null for unauthenticated previews.
 *
 * Exported for unit tests.
 */
export async function bootstrapWithRetry(
  previewBaseUrl: string,
  token: string | null,
): Promise<{ response: Response | undefined; lastError: unknown; attempts: number }> {
  // Construct the auth-check URL internally so callers can't accidentally
  // point this at the root `/` (which would re-introduce the autostart
  // dependency this PR exists to fix).
  const authCheckUrl = new URL('/airo/auth-check', previewBaseUrl).toString()
  let response: Response | undefined
  let lastError: unknown
  let attempts = 0
  for (let attempt = 0; attempt < MAX_BOOTSTRAP_ATTEMPTS; attempt++) {
    attempts = attempt + 1
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BOOTSTRAP_FETCH_TIMEOUT_MS)
    try {
      response = await fetch(authCheckUrl, {
        signal: controller.signal,
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'include', // Receive Set-Cookie cross-origin
        redirect: 'manual', // Don't follow auth-failure 307s
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (response.ok) return { response, lastError: undefined, attempts }
      lastError = new Error(`status ${response.status}`)
      // Only 5xx is retryable. 4xx (auth failure) and status 0 (opaque
      // redirect from `redirect: 'manual'`) are definitive and won't
      // recover. The `< 500` form covers both.
      if (response.status < 500) break
    } catch (err) {
      lastError = err
      // Network errors (timeout, abort, ECONNRESET) are transient — retry.
    } finally {
      clearTimeout(timeoutId)
    }
    if (attempt < MAX_BOOTSTRAP_ATTEMPTS - 1) {
      await new Promise(r =>
        setTimeout(r, BOOTSTRAP_BACKOFF_BASE_MS * Math.pow(3, attempt)),
      )
    }
  }
  return { response, lastError, attempts }
}

async function getPreviewAppToken(siteId: string): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null // Server-side rendering
  }

  try {
    const response = await fetch(`/api/auth/token?siteId=${encodeURIComponent(siteId)}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store' // Prevent browser cache from mixing tokens between apps
    })

    if (!response.ok) {
      logger.warn('server-polling.token-fetch.failed', {
        message: 'Failed to fetch token from API',
        status: response.status,
        siteId
      })
      return null
    }

    const data = await response.json()
    return data.token || null
  } catch (error) {
    logger.debug('server-polling.token-fetch.error', {
      message: 'Error fetching token from API',
      error: error instanceof Error ? error.message : String(error),
      siteId
    })
    return null
  }
}

export interface ServerState {
  appId: string
  port: number | null
  url: string | null
  status: 'pending' | 'running' | 'stopped' | 'failed' | 'error'
  lastActivity?: string
  isReady: boolean
  healthCheckPassed: boolean
  cookieVerified?: boolean
  error?: string
}

interface PollingState {
  server: ServerState | null
  isPolling: boolean
  pollCount: number
  currentInterval: number
  timeoutId: NodeJS.Timeout | null
  lastPollTime: number | null
  realAppId: string | null  // Resolved app ID for auth/health checks (null until transition)
}

interface ServerPollingStore {
  // State per server
  servers: Map<string, PollingState>

  // Actions
  startPollingForServer: (appId: string) => void
  stopPollingForServer: (appId: string) => void
  getServerState: (appId: string) => ServerState | null
  isPollingServer: (appId: string) => boolean
  cleanup: () => void

  // Internal polling logic
  _pollServer: (appId: string) => Promise<void>
  _scheduleNextPoll: (appId: string) => void
  _calculateNextInterval: (pollCount: number) => number
  _checkUrlHealth: (url: string, appId: string) => Promise<{ healthy: boolean; cookieVerified?: boolean }>
}

// Adaptive polling intervals (in ms)
const POLLING_INTERVALS = {
  initial: 1000,     // 1 second initially
  fast: 2000,        // 2 seconds for first 10 polls
  medium: 5000,      // 5 seconds for next 20 polls
  slow: 15000,       // 15 seconds for next 30 polls
  slowest: 30000     // 30 seconds thereafter
}

const MAX_POLLS = {
  fast: 10,
  medium: 30,
  slow: 60
}

export const useServerPollingStore = create<ServerPollingStore>()(
  devtools(
    immer((set, get) => ({
    servers: new Map(),

    startPollingForServer: (appId: string) => {
      // De-dup: if any existing entry is polling for the same real app ID, skip
      // Check both realAppId (set after transition) and server.appId (may be set before realAppId)
      const existingForReal = Array.from(get().servers.values()).find(
        (state) => state.isPolling && (state.realAppId === appId || state.server?.appId === appId)
      )
      if (existingForReal) {
        logger.debug('server-polling.duplicate-prevented', {
          message: 'Skipping start - existing entry already polling for this app',
          appId
        })
        return
      }

      const existing = get().servers.get(appId)

      // Don't start if already polling
      if (existing?.isPolling) {
        return
      }

      set((state) => {
        const existingState = state.servers.get(appId)
        if (existingState) {
          // Reuse existing state to preserve server info, poll count, etc.
          existingState.isPolling = true
          // Reset cookieVerified so retry starts with clean state
          if (existingState.server) {
            existingState.server.cookieVerified = undefined
          }
        } else {
          // Create new state
          state.servers.set(appId, {
            server: null,
            isPolling: true,
            pollCount: 0,
            currentInterval: POLLING_INTERVALS.initial,
            timeoutId: null,
            lastPollTime: null,
            realAppId: null
          })
        }
      })

      // Start immediate poll
      get()._pollServer(appId)
    },

    stopPollingForServer: (appId: string) => {
      const pollingState = get().servers.get(appId)

      if (!pollingState) return

      // Clear any pending timeout
      if (pollingState.timeoutId) {
        clearTimeout(pollingState.timeoutId)
      }

      set((state) => {
        const existingState = state.servers.get(appId)
        if (existingState) {
          existingState.isPolling = false
          existingState.timeoutId = null
        }
      })
    },

    getServerState: (appId: string) => {
      return get().servers.get(appId)?.server || null
    },

    isPollingServer: (appId: string) => {
      return get().servers.get(appId)?.isPolling || false
    },

    cleanup: () => {
      const { servers } = get()

      // Stop all polling
      servers.forEach((pollingState) => {
        if (pollingState.timeoutId) {
          clearTimeout(pollingState.timeoutId)
        }
      })

      set((state) => {
        state.servers.clear()
      })
    },

    _pollServer: async (appId: string) => {
      const pollingState = get().servers.get(appId)

      if (!pollingState || !pollingState.isPolling) {
        logger.debug('server-polling.already-stopped', { message: 'Polling stopped', appId })
        return
      }

      // Use realAppId if available, otherwise original appId
      let effectiveAppId = pollingState.realAppId ?? appId

      try {
        logger.debug('server-polling.attempt', { message: 'Polling server', appId, attempt: pollingState.pollCount + 1 })

        const response = await appFetch(`/api/servers/${appId}`)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        const serverData = data.server

        // Handle temporary ID → real ID transition (e.g., dev-job-* → real appId)
        // Store realAppId on the polling state, but keep entry under original key
        if (serverData.appId && serverData.appId !== appId) {
          set((state) => {
            const current = state.servers.get(appId)
            if (current) {
              current.realAppId = serverData.appId
            }
          })
          effectiveAppId = serverData.appId
          logger.info('server-polling.appid-transition', {
            message: 'App ID transitioned from temp to real',
            tempId: appId,
            realId: effectiveAppId
          })
        }

        // If we have a URL, perform actual health check.
        // Note: For local dev + JWT-protected preview apps, this also bootstraps auth by
        // setting the preview-domain auth cookie via Authorization header.
        // Use effectiveAppId to ensure JWT is requested for the real allocated app ID
        let healthCheckPassed = false
        let cookieVerified: boolean | undefined
        if ((serverData.status === 'running' || serverData.status === 'starting') && serverData.url) {
          logger.debug('server-polling.health-check', { message: 'Performing health check', appId: effectiveAppId, url: serverData.url, status: serverData.status })
          const result = await get()._checkUrlHealth(serverData.url, effectiveAppId)
          healthCheckPassed = result.healthy
          cookieVerified = result.cookieVerified
          logger.debug('server-polling.health-check-result', { message: 'Health check result', appId: effectiveAppId, passed: healthCheckPassed, cookieVerified })
        }

        set((state) => {
          const currentState = state.servers.get(appId)
          if (currentState) {
            currentState.server = {
              appId: serverData.appId || effectiveAppId,
              port: serverData.port,
              url: serverData.url,
              status: serverData.status,
              lastActivity: serverData.lastActivity,
              isReady: serverData.status === 'running' && !!serverData.url && healthCheckPassed,
              healthCheckPassed,
              cookieVerified,
              error: undefined
            }
            currentState.pollCount++
            currentState.lastPollTime = Date.now()
          }
        })

        // Stop polling only if server is ready AND health check passed
        if (serverData.status === 'running' && serverData.url && healthCheckPassed) {
          logger.info('server-polling.ready', { message: 'Server is ready and health check passed', appId: effectiveAppId, url: serverData.url })
          get().stopPollingForServer(appId)
          return
        }

        // Stop polling if server failed permanently
        if (serverData.status === 'failed') {
          logger.warn('server-polling.failed', { message: 'Server failed permanently', appId: effectiveAppId })
          get().stopPollingForServer(appId)
          return
        }

        // Schedule next poll with backoff
        const currentState = get().servers.get(appId)
        if (currentState?.isPolling) {
          get()._scheduleNextPoll(appId)
        }

      } catch (error) {
        logger.error('server-polling.error', { message: 'Error polling server', appId: effectiveAppId, error: error instanceof Error ? error.message : String(error) })

        set((state) => {
          const currentState = state.servers.get(appId)
          if (currentState) {
            currentState.server = {
              appId: effectiveAppId,
              port: null,
              url: null,
              status: 'error',
              isReady: false,
              healthCheckPassed: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
            currentState.pollCount++
            currentState.lastPollTime = Date.now()
          }
        })

        // Continue polling on error, but with backoff
        const errorState = get().servers.get(appId)
        if (errorState?.isPolling) {
          get()._scheduleNextPoll(appId)
        }
      }
    },

    _scheduleNextPoll: (appId: string) => {
      const pollingState = get().servers.get(appId)

      if (!pollingState || !pollingState.isPolling) return

      const nextInterval = get()._calculateNextInterval(pollingState.pollCount)

      logger.debug('server-polling.schedule', { message: 'Scheduling next poll', appId, nextInterval, attempt: pollingState.pollCount + 1 })

      const timeoutId = setTimeout(() => {
        get()._pollServer(appId)
      }, nextInterval)

      set((state) => {
        const currentState = state.servers.get(appId)
        if (currentState) {
          currentState.timeoutId = timeoutId
          currentState.currentInterval = nextInterval
        }
      })
    },

    _calculateNextInterval: (pollCount: number) => {
      if (pollCount < MAX_POLLS.fast) {
        return POLLING_INTERVALS.fast
      } else if (pollCount < MAX_POLLS.medium) {
        return POLLING_INTERVALS.medium
      } else if (pollCount < MAX_POLLS.slow) {
        return POLLING_INTERVALS.slow
      } else {
        return POLLING_INTERVALS.slowest
      }
    },

    _checkUrlHealth: async (url: string, appId: string): Promise<{ healthy: boolean; cookieVerified?: boolean }> => {
      try {
        // Fetch the site-scoped JWT FIRST — both phases need it. The
        // bootstrap uses it to set the cross-domain cookie via /airo/auth-check;
        // waitForViteReady uses it to trigger autostart on a hibernated
        // preview. One token, two consumers, no duplicate /api/auth/token call.
        const token = await getPreviewAppToken(appId)

        // Debug: Log URL being checked to detect stale allocation IDs
        const urlHostname = new URL(url).hostname
        logger.debug('server-polling.health-check.url', { appId, url, hostname: urlHostname })

        // Phase 1: cross-domain auth cookie bootstrap (vite-independent).
        //
        // Sends HEAD to /airo/auth-check with the JWT. dev-supervisor's
        // JWT middleware queues Set-Cookie; handleAuthCheck flushes the
        // response immediately (~100ms). Crucially, /airo/auth-check is
        // registered DIRECTLY on the mux — it does NOT pass through
        // RequestRouter, so it does NOT trigger autostart and does NOT
        // depend on the customer process being up.
        //
        // This ordering matters: by setting the cookie before waiting for
        // vite, we (a) fail fast on auth errors without waiting up to 90s
        // for autostart, (b) ensure the cookie is in place before
        // waitForViteReady's wake-up HEAD fires (so dev-supervisor's
        // autostart-blocked response can also benefit from cookie auth
        // if Bearer somehow becomes invalid mid-flow), and (c) let any
        // concurrent iframe navigation (e.g. user opens preview in new
        // tab during loading) succeed earlier.
        //
        // Retry budget (defense in depth): brief 5xx from dev-supervisor,
        // network blip, JWKS-fetch hiccup. 4xx and opaque redirects
        // break early — see bootstrapWithRetry comment.
        const { response, lastError, attempts } = await bootstrapWithRetry(url, token)

        // Validate bootstrap response.
        // 2xx = JWT validated, Set-Cookie sent. Anything else is a definitive
        // or exhausted-transient failure. Log at warn (not debug) for
        // operator visibility — a failed bootstrap means the user-visible
        // preview never becomes "ready". The `attempts` field distinguishes
        // a transient 5xx that gave up after MAX_BOOTSTRAP_ATTEMPTS from a
        // 4xx/opaque-redirect that bailed after one attempt.
        if (!response?.ok) {
          logger.warn('server-polling.health-check.bootstrap-failed', {
            message: 'Cookie bootstrap failed at /airo/auth-check — auth or transient network',
            appId,
            url,
            attempts,
            status: response?.status,
            error: lastError instanceof Error ? lastError.message : String(lastError),
          })
          return { healthy: false }
        }

        // Phase 2: wait for vite to be reachable (and wake it up if it's
        // hibernated). See waitForViteReady comment for the contract.
        //
        // After this PR's refactor, this gate exists ONLY to ensure the
        // iframe will load cleanly — a blank-iframe-during-90s-autostart
        // is bad UX. Cookie set is no longer dependent on this; it
        // succeeded in Phase 1.
        //
        // Bails fast on the original "vite-starting" race (503 → keep
        // polling). On hibernation, blocks for up to WAKEUP_TIMEOUT_MS
        // while dev-supervisor's autostart completes.
        const ready = await waitForViteReady(url, token)
        if (!ready) {
          logger.debug('server-polling.health-check.not-ready', {
            message: 'vite not ready (poll deadline or wake-up failure)',
            appId,
            url,
          })
          return { healthy: false }
        }

        // Verify cookie was stored by calling auth-check without Authorization header.
        // If the browser stored the cookie, this request will authenticate via cookie.
        // If third-party cookies are blocked and CHIPS isn't supported, this will fail.
        // Verify cookie was stored: only 401 means "cookie not stored" (cookieVerified=false).
        // Other errors (5xx, network) leave cookieVerified=undefined to avoid false positives.
        let cookieVerified: boolean | undefined
        if (token) {
          const authCheckUrl = new URL('/airo/auth-check', url).href
          const verifyController = new AbortController()
          const verifyTimeoutId = setTimeout(() => verifyController.abort(), 5000)
          try {
            const verifyResponse = await fetch(authCheckUrl, {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              signal: verifyController.signal
            })
            if (verifyResponse.ok) {
              cookieVerified = true
            } else if (verifyResponse.status === 401) {
              cookieVerified = false
              logger.warn('server-polling.cookie-verification.failed', {
                message: 'Cookie not stored - browser may be blocking third-party cookies',
                appId
              })
            } else {
              logger.warn('server-polling.cookie-verification.unexpected', {
                message: 'Unexpected status from auth-check',
                appId,
                status: verifyResponse.status
              })
            }
          } catch (verifyError) {
            logger.warn('server-polling.cookie-verification.error', {
              message: 'Cookie verification request failed',
              appId,
              error: verifyError instanceof Error ? verifyError.message : String(verifyError)
            })
          } finally {
            clearTimeout(verifyTimeoutId)
          }
        }

        return { healthy: true, cookieVerified }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.debug('server-polling.health-check.timeout', { message: 'Health check timed out', appId, url })
        } else {
          logger.debug('server-polling.health-check.failed', { message: 'Health check failed', appId, url, error: error instanceof Error ? error.message : String(error) })
        }
        return { healthy: false }
      }
    }
  })),
    { name: 'ServerPollingStore' }
  )
)

// Cleanup function for use in components
export const cleanupServerPolling = () => {
  useServerPollingStore.getState().cleanup()
}
