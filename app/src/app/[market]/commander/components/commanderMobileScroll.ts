/** Marks the commander mobile canvas root; enables scroll gutter styling on descendants. */
export const COMMANDER_MOBILE_CANVAS_ATTR = 'data-commander-mobile-canvas'

/** Marks a scroll container that should gain bottom padding when the mobile bar is visible. */
export const COMMANDER_MOBILE_SCROLL_ATTR = 'data-commander-mobile-scroll'

export const COMMANDER_MOBILE_BAR_RESERVE_VAR = '--commander-mobile-bar-reserve'

export const commanderMobileScrollRootProps = {
  [COMMANDER_MOBILE_SCROLL_ATTR]: '',
} as const

export type CommanderMobileScrollSpreadProps =
  | typeof commanderMobileScrollRootProps
  | Record<string, never>

/** postMessage type handled by preview dev-tools to pad the iframe document scroll area. */
export const SET_SCROLL_GUTTER_MESSAGE_TYPE = 'SET_SCROLL_GUTTER' as const

export function coerceScrollGutterPaddingBottom(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
