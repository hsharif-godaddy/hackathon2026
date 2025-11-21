/**
 * SCC c2 Tracking Package
 *
 * Event tracking for AI-generated websites using the Signals Capture Client (SCC) c2.
 * Enables consistent analytics and user interaction tracking via the Customer Signals Platform (CSP).
 */

export { injectSCCC2 } from './scc-c2-injector'
export { initSCCClickListener } from './scc-click-listener'
export { initSCCRouteTracker } from './scc-route-tracker'
export {
  trackClick,
  trackClickSimple,
  trackVirtualPageView,
  type ElementObject,
  type ClickEventData,
  type VirtualPageViewEventData
} from './scc-events'

