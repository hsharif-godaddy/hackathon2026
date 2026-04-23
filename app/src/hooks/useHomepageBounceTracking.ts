import { useCallback, useEffect, useRef } from 'react'

import { ClientLogBuffer } from '@/lib/logging'

type LogAnalyticsFn = (
  event: string,
  data?: Record<string, unknown>,
  options?: {
    kind?: 'action' | 'click' | 'impression'
    eid?: string
    action?: 'blur' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll' | 'custom'
  },
) => void

interface Options {
  /** Time window in ms; leaving within this window without engagement counts as a bounce. */
  thresholdMs?: number
  /** Scroll depth percentage (0-100) that qualifies as engagement. */
  engagementScrollPercent?: number
}

interface BounceTrackingApi {
  /**
   * Imperatively mark the session engaged. Use for programmatic conversions
   * that don't produce a DOM click/focus — e.g. auto-submitting a prompt
   * restored from localStorage after SSO round-trip.
   *
   * Idempotent and safe to call on every submit regardless of trigger path.
   */
  markEngaged: () => void
}

const DEFAULT_THRESHOLD_MS = 5000
const DEFAULT_ENGAGEMENT_SCROLL_PERCENT = 25

/**
 * Fires `homepage.bounced` on `pagehide` when the visitor leaves within
 * `thresholdMs` without producing an engagement signal (scroll past threshold,
 * click, focus, or an explicit `markEngaged()` call).
 *
 * Intentionally does not fire on `visibilitychange=hidden`: tab-switching is
 * not a bounce, and pagehide is the terminal signal (navigation, close, or
 * bfcache eviction). A few mobile tab-kills will go uncounted, which is
 * acceptable measurement noise for A/B comparison since it affects cohorts
 * uniformly.
 *
 * Fires regardless of `event.persisted`. Modern browsers park almost every
 * same-tab cross-origin navigation (e.g. typing a URL in the address bar)
 * into bfcache, which means `persisted === true` is the common case for the
 * single most important bounce path. Skipping it silently discards the
 * dominant signal. Same-origin link clicks are handled by the `click`
 * engagement listener before pagehide, so internal navigation to a cached
 * page doesn't false-positive.
 *
 * Payload: `{ msOnPage, scrollMaxPercent }`. The enriched event (with
 * cohort/visitorId/baseData) is queued via `logAnalytics` and then drained
 * with `ClientLogBuffer.flushBeacon()` which uses `navigator.sendBeacon` —
 * the platform primitive for unload-time delivery. The default keepalive
 * fetch flush is unreliable on tab close; beacons are guaranteed to leave
 * the page.
 */
export function useHomepageBounceTracking(
  logAnalytics: LogAnalyticsFn,
  options: Options = {},
): BounceTrackingApi {
  const thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS
  const engagementScrollPercent =
    options.engagementScrollPercent ?? DEFAULT_ENGAGEMENT_SCROLL_PERCENT

  const engagedRef = useRef(false)
  const loggedRef = useRef(false)

  // Hold logAnalytics in a ref so effect identity is stable. The caller's
  // callback reference changes when the Hivemind cohort resolves from
  // INELIGIBLE_COHORT to the real assignment; if the effect depended on it,
  // the teardown would reset pageLoadAt to the cohort-resolve time and
  // corrupt msOnPage for any visitor whose cohort loads post-mount.
  const logAnalyticsRef = useRef(logAnalytics)
  logAnalyticsRef.current = logAnalytics

  const markEngaged = useCallback(function markEngaged() {
    engagedRef.current = true
  }, [])

  useEffect(function trackBounce() {
    const pageLoadAt = performance.now()
    let maxScrollPercent = 0

    function currentScrollPercent() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      if (scrollable <= 0) return 0
      const pct = (window.scrollY / scrollable) * 100
      if (pct < 0) return 0
      if (pct > 100) return 100
      return pct
    }

    function onScroll() {
      const pct = currentScrollPercent()
      if (pct > maxScrollPercent) {
        maxScrollPercent = pct
      }
      if (pct >= engagementScrollPercent) {
        engagedRef.current = true
      }
    }

    function onDomEngage() {
      engagedRef.current = true
    }

    function onPageHide() {
      maybeLogBounce()
    }

    function maybeLogBounce() {
      if (loggedRef.current || engagedRef.current) return
      const msOnPage = Math.round(performance.now() - pageLoadAt)
      if (msOnPage >= thresholdMs) return
      loggedRef.current = true
      logAnalyticsRef.current('homepage.bounced', {
        msOnPage,
        scrollMaxPercent: Math.round(maxScrollPercent),
      })
      // Beacon-flush instead of the default flush(): we're inside a pagehide
      // handler, so the browser will tear down any in-flight keepalive fetch
      // before it completes. sendBeacon is the only mechanism that commits
      // delivery synchronously and survives the unload. Keeps cohort and
      // visitorId enrichment since we still go through logAnalytics above.
      ClientLogBuffer.flushBeacon()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('click', onDomEngage, { capture: true })
    document.addEventListener('focusin', onDomEngage, { capture: true })
    window.addEventListener('pagehide', onPageHide)

    // Capture initial scroll position in case the visitor loads mid-page via a hash link.
    onScroll()

    return function cleanup() {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('click', onDomEngage, true)
      document.removeEventListener('focusin', onDomEngage, true)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [engagementScrollPercent, thresholdMs])

  return { markEngaged }
}
