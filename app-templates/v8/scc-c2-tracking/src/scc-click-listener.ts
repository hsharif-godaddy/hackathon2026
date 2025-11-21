/**
 * Automatic Click Listener for SCC c2 Event Tracking
 *
 * Automatically tracks clicks on links, buttons, and other interactive elements
 * in AI-generated websites.
 *
 * Documentation: https://confluence.godaddy.com/display/CSP/Web+Instrumentation
 */

import { trackClickSimple } from './scc-events'

/**
 * Initialize automatic click tracking
 *
 * Sets up event delegation to track clicks on links, buttons, and form submissions.
 * This should be called once when the application loads.
 */
export function initSCCClickListener(): void {
  if (typeof window === 'undefined' || (window as any).__SCC_CLICK_LISTENER_INITIALIZED__) {
    return
  }
  ;(window as any).__SCC_CLICK_LISTENER_INITIALIZED__ = true

  function attachListener() {
    if (!document.body) {
      setTimeout(attachListener, 100)
      return
    }

    document.addEventListener('click', function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (!target) return

      const interactiveElement = target.closest('a, button, [role="button"], input[type="submit"], input[type="button"]')
      if (!interactiveElement) return

      const tagName = interactiveElement.tagName.toLowerCase()
      const element = interactiveElement as HTMLElement

      // Determine section
      let section = 'page'
      if (interactiveElement.closest('header, [role="banner"]')) section = 'header'
      else if (interactiveElement.closest('footer, [role="contentinfo"]')) section = 'footer'
      else if (interactiveElement.closest('nav, [role="navigation"]')) section = 'navigation'
      else if (interactiveElement.closest('main, [role="main"]')) section = 'main'

      // Determine widget
      const widget =
        tagName === 'a' ? 'link'
          : tagName === 'button' || element.getAttribute('role') === 'button' ? 'button'
          : tagName === 'input' && (element as HTMLInputElement).type === 'submit' ? 'submit_button'
          : 'element'

      trackClickSimple(section, widget, {
        elementId: element.id || undefined,
        elementText: element.textContent?.trim()?.substring(0, 100) || undefined,
        href: (element as HTMLAnchorElement).href || undefined,
        tagName,
        timestamp: new Date().toISOString()
      })
    }, true)
  }

  attachListener()
}

