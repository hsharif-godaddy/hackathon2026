/**
 * SCC Route Tracker - Runtime Injection
 *
 * Tracks virtual page views when routes change by monitoring browser history.
 * This is injected at runtime and doesn't require React Router dependencies.
 *
 * Documentation: https://confluence.godaddy.com/display/CSP/Web+Instrumentation
 */

import { trackVirtualPageView } from './scc-events'

/**
 * Initialize route tracking
 *
 * Monitors route changes via History API and sends virtual page view events.
 * This works with both React Router and native browser navigation.
 */
export function initSCCRouteTracker(): void {
  if (typeof window === 'undefined' || (window as any).__SCC_ROUTE_TRACKER_INITIALIZED__) {
    return
  }
  ;(window as any).__SCC_ROUTE_TRACKER_INITIALIZED__ = true

  let lastUrl = window.location.href

  function trackPageView() {
    const currentUrl = window.location.href
    if (currentUrl !== lastUrl) {
      trackVirtualPageView({
        url: currentUrl,
        title: document.title || '',
        referrer: lastUrl
      })
      lastUrl = currentUrl
    }
  }

  // Monitor popstate (back/forward navigation)
  window.addEventListener('popstate', trackPageView)

  // Monitor pushState and replaceState
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  history.pushState = function pushState(...args) {
    originalPushState.apply(history, args)
    setTimeout(trackPageView, 0)
  }

  history.replaceState = function replaceState(...args) {
    originalReplaceState.apply(history, args)
    setTimeout(trackPageView, 0)
  }
}

