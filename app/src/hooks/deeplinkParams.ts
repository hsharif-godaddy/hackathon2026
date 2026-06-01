export const ACTION_PARAM = 'action'
export const SOURCE_PARAM = 'source'

/** Allowed source values for deeplinks. Unknown sources fall back to DEEPLINK. */
export const ALLOWED_SOURCES = {
  DEEPLINK: 'deeplink',
  BELL_CAMPAIGN: 'bell_campaign',
} as const

export type DeeplinkSource = (typeof ALLOWED_SOURCES)[keyof typeof ALLOWED_SOURCES]

const ALLOWED_SOURCE_VALUES = new Set<string>(Object.values(ALLOWED_SOURCES))

export function resolveDeeplinkSource(params: URLSearchParams): DeeplinkSource {
  const rawSource = params.get(SOURCE_PARAM) ?? ''
  return ALLOWED_SOURCE_VALUES.has(rawSource) ? (rawSource as DeeplinkSource) : ALLOWED_SOURCES.DEEPLINK
}

/**
 * Strips `action` and `source` from the URL without triggering navigation.
 * Only removes params when action matches the expected value.
 */
export function clearDeeplinkParam(action: string): void {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)
  if (params.get(ACTION_PARAM) !== action) return

  params.delete(ACTION_PARAM)
  params.delete(SOURCE_PARAM)
  const newSearch = params.toString()
  const hash = window.location.hash
  const newUrl = newSearch
    ? `${window.location.pathname}?${newSearch}${hash}`
    : `${window.location.pathname}${hash}`
  window.history.replaceState(null, '', newUrl)
}
