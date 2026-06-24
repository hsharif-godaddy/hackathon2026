type Translate = (key: string, values?: Record<string, unknown>, defaultMessage?: string) => string

const GENERIC_FALLBACK = 'Something went wrong. Please try again.'

/** errorTypes whose server-side `clientMessage` is curated and safe to show
 * verbatim. Everything else (raw upstream/proxy strings, unknown classes) is
 * replaced with generic copy — an allowlist, so a leaky upstream phrasing
 * ("Cannot connect to API: Connect Timeout Error") can never reach the UI
 * regardless of its wording. The display components render their own i18n copy
 * for these types anyway; this only governs the stored fallback string. */
const DISPLAY_SAFE_ERROR_TYPES: ReadonlySet<string> = new Set([
  'BUDGET_SERVICE_UNAVAILABLE',
  'BUDGET_SERVICE_ERROR',
  'BUDGET_SERVICE_AUTH_ERROR',
  'NETWORK_ERROR',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'STREAM_TYPE_VALIDATION',
  'CONTENT_FILTERED',
])

export function sanitizeUpstreamErrorMessage(message: string, errorType: string | undefined, t: Translate): string {
  if (errorType !== undefined && DISPLAY_SAFE_ERROR_TYPES.has(errorType) && message.trim()) {
    return message
  }

  return t('builder_common_error_generic', undefined, GENERIC_FALLBACK)
}

export function resolveUpstreamErrorStatusCode(message: string, statusCode?: number): number | undefined {
  if (statusCode !== undefined) {
    return statusCode
  }

  if (/\bgateway time-?out\b/i.test(message)) {
    return 504
  }

  const chatFailedMatch = /^Chat request failed:\s*(\d+)/i.exec(message.trim())
  if (chatFailedMatch) {
    return Number(chatFailedMatch[1])
  }

  if (/\b504\b/.test(message)) {
    return 504
  }

  if (/\b408\b/.test(message)) {
    return 408
  }

  return undefined
}
