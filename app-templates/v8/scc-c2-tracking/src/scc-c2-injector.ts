/**
 * SCC c2 client injector for Customer Signals Platform
 *
 * Loads and initializes the Signals Capture Client (SCC) for c2 context
 * to enable event tracking in customer AI-generated websites.
 *
 * Documentation: https://confluence.godaddy.com/display/CSP/Web+Instrumentation
 */

import { initSCCClickListener } from './scc-click-listener'
import { initSCCRouteTracker } from './scc-route-tracker'

/**
 * Initialize SCC c2 client
 *
 * Loads the SCC c2 client from the CDN and initializes it for event tracking.
 * The client supports Traffic and Event Bus sinks for c2 context.
 */
export function injectSCCC2() {
  if (typeof window === 'undefined') {
    return
  }

  // Initialize _signalsDataLayer synchronously before loading SCC script
  if (!(window as any)._signalsDataLayer) {
    ;(window as any)._signalsDataLayer = []
  }

  // Check if already injected or script already exists in DOM
  if ((window as any).__SCC_C2_INJECTED__) {
    return
  }

  // Check if SCC is already loaded (from HTML script or previous injection)
  if ((window as any).SCC && (window as any).SCC.c2) {
    ;(window as any).__SCC_C2_INJECTED__ = true
    setTimeout(() => {
      try {
        initSCCClickListener()
        initSCCRouteTracker()
      } catch (error) {
        // Silent fail
      }
    }, 1000)
    return
  }

  // Check if script tag exists but hasn't loaded yet
  const existingScript = document.querySelector('script[src*="scc-c2"]')
  if (existingScript) {
    // If already loaded, just initialize listeners
    if ((window as any).SCC && (window as any).SCC.c2) {
      ;(window as any).__SCC_C2_INJECTED__ = true
      setTimeout(() => {
        try {
          initSCCClickListener()
          initSCCRouteTracker()
        } catch (error) {
          // Silent fail
        }
      }, 1000)
      return
    }

    // Script tag exists but not loaded yet - set up fallback mechanism
    if (!existingScript.hasAttribute('data-fallback-setup')) {
      existingScript.setAttribute('data-fallback-setup', 'true')
      existingScript.addEventListener('error', function onScriptError() {
        existingScript.remove()
        ;(window as any).__SCC_C2_INJECTED__ = false
        injectSCCC2()
      })
    }

    // Set up timeout fallback in case script loads but SCC doesn't initialize
    setTimeout(() => {
      if (!(window as any).SCC || !(window as any).SCC.c2) {
        existingScript.remove()
        ;(window as any).__SCC_C2_INJECTED__ = false
        injectSCCC2()
        return
      }
    }, 2000)

    // Set up polling to check if script loads successfully
    let attempts = 0
    const maxAttempts = 20
    const checkSCC = setInterval(() => {
      attempts++
      if ((window as any).SCC && (window as any).SCC.c2) {
        clearInterval(checkSCC)
        ;(window as any).__SCC_C2_INJECTED__ = true
        setTimeout(() => {
          try {
            initSCCClickListener()
            initSCCRouteTracker()
          } catch (error) {
            // Silent fail
          }
        }, 1000)
      } else if (attempts >= maxAttempts) {
        clearInterval(checkSCC)
      }
    }, 100)

    return
  }

  // Mark as injected
  ;(window as any).__SCC_C2_INJECTED__ = true

  // Determine environment and CDN URL
  const hostname = window.location.hostname
  let sccUrl: string

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.includes('.dev-') ||
    hostname.includes('dev.') ||
    hostname.includes('dev-godaddy')
  ) {
    sccUrl = 'https://img1.dev-wsimg.com/signals/js/clients/scc-c2/scc-c2.js'
  } else if (
    hostname.includes('.test-') ||
    hostname.includes('test.') ||
    hostname.includes('test-godaddy') ||
    hostname.includes('test-godaddy.com')
  ) {
    sccUrl = 'https://img1.test-wsimg.com/signals/js/clients/scc-c2/scc-c2.min.js'
  } else {
    sccUrl = 'https://img1.wsimg.com/signals/js/clients/scc-c2/scc-c2.min.js'
  }

  const script = document.createElement('script')
  script.src = sccUrl
  script.async = true
  script.crossOrigin = 'anonymous'

  script.onload = function load() {
    // Initialize click listener and route tracker after DOM is ready
    setTimeout(() => {
      try {
        initSCCClickListener()
        initSCCRouteTracker()
      } catch (error) {
        // Silent fail
      }
    }, 1000)

    // Send initial page view
    setTimeout(() => {
      try {
        const dataLayer = (window as any)._signalsDataLayer
        dataLayer.push({
          schema: 'add_event',
          version: 'v1',
          data: {
            eid: 'airo.website.page.view',
            type: 'page_view',
            event_label: document.title || window.location.href,
            custom_properties: {
              url: window.location.href,
              title: document.title || '',
              referrer: document.referrer || undefined
            }
          }
        })
      } catch (e) {
        // Silent fail
      }
    }, 200)
  }

  script.onerror = function error() {
    ;(window as any).__SCC_C2_INJECTED__ = false
  }

  // Insert script into document
  try {
    document.head.appendChild(script)
  } catch (error) {
    ;(window as any).__SCC_C2_INJECTED__ = false
  }
}

// Auto-inject on import (similar to FullStory)
// This ensures SCC c2 is injected even if main.tsx doesn't call it
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  setTimeout(() => {
    injectSCCC2()
  }, 0)
}

