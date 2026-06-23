// Vivid Figma indigo for the stepper — intentionally brighter than the app's
// muted brand --color-ai (#613EA3) to match the approved design.
export const AI_COLOR = '#7836EA'
export const CONNECTOR_MUTED = 'rgba(20, 20, 40, 0.12)'
export const PENDING_ICON = 'rgba(20, 20, 40, 0.4)'

// Exact pixel sizes (NOT Tailwind spacing utilities): the app's spacing scale
// can resolve larger than these literals, so the geometry is kept in px to
// preserve the approved design exactly.
export const ICON_PX = 20
export const CONNECTOR_PX = 3
export const CAP_PX = 12

/** Connector color/fill transition (kept inline; not a static Tailwind class). */
export const CONNECTOR_TRANSITION = 'background-color 500ms, background-image 500ms'
