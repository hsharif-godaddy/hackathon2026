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

interface HoverTrackingApi {
  /** Attach to the target element's `onMouseEnter`. */
  onMouseEnter: () => void
  /** Attach to the target element's `onMouseLeave`. */
  onMouseLeave: () => void
  /**
   * Read accumulated hover time and reset the counter. If the visitor is
   * still hovering, the clock keeps running from `performance.now()` so
   * post-snapshot hover continues to accumulate cleanly.
   *
   * Use at engagement milestones (e.g. first focus) to emit a partitioned
   * `hover_time` event without double-counting against the pagehide flush.
   */
  snapshotHoverMs: () => number
}

/**
 * Tracks cursor hover time over a target element (e.g. the homepage prompt
 * textarea) and emits two analytics events:
 *
 * - `{firstHoverEvent}` — on the first `mouseenter` after mount, payload
 *   `{ msFromPageLoad }`. Structured as a `hover` action event so it lands
 *   in the same instrumentation bucket as focus/first_input.
 * - `{hoverTimeEvent}` with `trigger: 'pagehide'` — on unload, payload
 *   `{ totalHoverMs }` for whatever hover has accumulated since the last
 *   snapshot. Drained via `ClientLogBuffer.flushBeacon()` because keepalive
 *   fetch is unreliable during unload.
 *
 * Callers can emit additional `{hoverTimeEvent}` variants at their own
 * milestones (e.g. focus) by calling `snapshotHoverMs()` and logging
 * themselves; the returned value is the accumulated hover time since the
 * last snapshot, and the counter is reset so the pagehide emission won't
 * double-count.
 *
 * `performance.now()` is used throughout because it's monotonic and relative
 * to the document's time origin (i.e. "ms from page load" without extra
 * bookkeeping).
 */
export function useTextareaHoverTracking(
  logAnalytics: LogAnalyticsFn,
  options: {
    firstHoverEvent?: string
    hoverTimeEvent?: string
    firstHoverEid?: string
  } = {},
): HoverTrackingApi {
  const firstHoverEvent = options.firstHoverEvent ?? 'homepage.prompt.first_hover'
  const hoverTimeEvent = options.hoverTimeEvent ?? 'homepage.prompt.hover_time'
  const firstHoverEid = options.firstHoverEid ?? 'homepage.prompt.input'

  const hasLoggedFirstHoverRef = useRef(false)
  const hoverStartRef = useRef<number | null>(null)
  const totalHoverMsRef = useRef(0)

  // Stabilize the caller's logAnalytics so the pagehide effect doesn't
  // re-subscribe when its identity changes (Hivemind cohort resolution,
  // baseData re-renders, etc.).
  const logAnalyticsRef = useRef(logAnalytics)
  logAnalyticsRef.current = logAnalytics

  const onMouseEnter = useCallback(function onMouseEnter() {
    // Guard against re-entry without a prior mouseleave (DOM reshuffling,
    // event quirks). Preserve the original session start so elapsed time
    // isn't discarded.
    if (hoverStartRef.current === null) {
      hoverStartRef.current = performance.now()
    }
    if (!hasLoggedFirstHoverRef.current) {
      // Set the flag AFTER the log call. If logAnalytics throws, we want
      // the next mouseenter to retry instead of permanently losing the
      // first_hover event. The throw still propagates (and gets reported
      // by React's error handling), so the bug stays visible.
      logAnalyticsRef.current(
        firstHoverEvent,
        {
          msFromPageLoad: Math.round(performance.now()),
        },
        {
          kind: 'action',
          eid: firstHoverEid,
          action: 'hover',
        },
      )
      hasLoggedFirstHoverRef.current = true
    }
  }, [firstHoverEvent, firstHoverEid])

  const onMouseLeave = useCallback(function onMouseLeave() {
    if (hoverStartRef.current !== null) {
      totalHoverMsRef.current += performance.now() - hoverStartRef.current
      hoverStartRef.current = null
    }
  }, [])

  const snapshotHoverMs = useCallback(function snapshotHoverMs() {
    if (hoverStartRef.current !== null) {
      const now = performance.now()
      totalHoverMsRef.current += now - hoverStartRef.current
      hoverStartRef.current = now
    }
    const snapshot = Math.round(totalHoverMsRef.current)
    totalHoverMsRef.current = 0
    return snapshot
  }, [])

  useEffect(function flushHoverTimeOnPageHide() {
    function onPageHide() {
      const totalHoverMs = snapshotHoverMs()
      // snapshotHoverMs keeps the clock running so mid-page callers (focus)
      // don't break the accumulator. Pagehide is terminal: close the
      // session explicitly, otherwise a bfcache restore resumes from a
      // stale start and charges the entire bfcache dwell to the next
      // snapshot. performance.now() keeps advancing across bfcache, so
      // this guard is load-bearing.
      hoverStartRef.current = null
      if (totalHoverMs <= 0) return
      // try/finally (not try/catch) so the beacon always flushes even if
      // the analytics pipeline throws — without swallowing the error for
      // dev/debugging. Otherwise a mid-navigation throw would strand all
      // buffered session events (focus, first_input, bounce, …).
      try {
        logAnalyticsRef.current(hoverTimeEvent, {
          totalHoverMs,
          trigger: 'pagehide',
        })
      } finally {
        ClientLogBuffer.flushBeacon()
      }
    }

    window.addEventListener('pagehide', onPageHide)
    return function cleanup() {
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [hoverTimeEvent, snapshotHoverMs])

  return { onMouseEnter, onMouseLeave, snapshotHoverMs }
}
