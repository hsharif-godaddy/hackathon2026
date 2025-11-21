/**
 * SCC c2 Event Tracking Utilities
 *
 * Provides typed interfaces for sending events to the Signals Capture Client (SCC).
 * Uses _signalsDataLayer.push() as per CSP documentation for c2 context.
 *
 * Documentation: https://confluence.godaddy.com/display/CSP/Web+Instrumentation
 */

/**
 * Get the signals data layer, initializing if needed
 */
function getSignalsDataLayer(): any[] {
  if (typeof window === 'undefined') {
    return []
  }
  if (!(window as any)._signalsDataLayer) {
    ;(window as any)._signalsDataLayer = []
  }
  return (window as any)._signalsDataLayer
}

/**
 * Element object for CSP events (area, product, section, widget)
 */
interface ElementObject {
  /** Top level namespace to group events */
  area: string
  /** Product, component or medium */
  product: string
  /** Section of the page or system (slash delimited path) */
  section: string
  /** Type of object or element emitting the event */
  widget: string
}

/**
 * Click event data for CSP
 */
interface ClickEventData {
  /** Element object for namespace/identification */
  element: ElementObject
  /** Optional EID for legacy support */
  eid?: string
  /** Custom properties */
  customProperties?: Record<string, unknown>
}

/**
 * Virtual page view event data for CSP
 */
interface VirtualPageViewEventData {
  /** Page URL */
  url: string
  /** Page title */
  title?: string
  /** Referrer URL */
  referrer?: string
}

/**
 * Default element values for AI-generated websites
 */
const DEFAULT_ELEMENT: ElementObject = {
  area: 'airo',
  product: 'website',
  section: 'page',
  widget: 'element'
}

/**
 * Send a click event to CSP using _signalsDataLayer
 *
 * @param eventData - Click event data with element object
 */
export function trackClick(eventData: ClickEventData): void {
  try {
    const dataLayer = getSignalsDataLayer()
    dataLayer.push({
      schema: 'add_click',
      version: 'v1',
      data: {
        element: eventData.element,
        ...(eventData.eid && { eid: eventData.eid }),
        ...(eventData.customProperties && { customProperties: eventData.customProperties })
      }
    })
  } catch (error) {
    // Silent fail
  }
}

/**
 * Track a click event with simplified parameters
 * Uses default element values for AI-generated websites
 *
 * @param section - Section of the page (e.g., 'header', 'footer', 'hero')
 * @param widget - Widget type (e.g., 'button', 'link', 'cta')
 * @param customProperties - Optional custom properties
 */
export function trackClickSimple(
  section: string,
  widget: string,
  customProperties?: Record<string, unknown>
): void {
  trackClick({
    element: {
      ...DEFAULT_ELEMENT,
      section,
      widget
    },
    customProperties
  })
}

/**
 * Send a virtual page view event to CSP using _signalsDataLayer
 *
 * @param eventData - Virtual page view event data
 */
export function trackVirtualPageView(eventData: VirtualPageViewEventData): void {
  try {
    const dataLayer = getSignalsDataLayer()
    dataLayer.push({
      schema: 'add_event',
      version: 'v1',
      data: {
        eid: 'airo.website.page.view',
        type: 'page_view',
        event_label: eventData.title || eventData.url,
        custom_properties: {
          url: eventData.url,
          ...(eventData.title && { title: eventData.title }),
          ...(eventData.referrer && { referrer: eventData.referrer })
        }
      }
    })
  } catch (error) {
    // Silent fail
  }
}

/**
 * Export element object type for use in other modules
 */
export type { ElementObject, ClickEventData, VirtualPageViewEventData }

