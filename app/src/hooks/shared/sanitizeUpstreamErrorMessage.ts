type Translate = (key: string, values?: Record<string, unknown>, defaultMessage?: string) => string

const GENERIC_FALLBACK = 'Something went wrong. Please try again.'

function isTechnicalUpstreamMessage(message: string): boolean {
  if (!message.trim() || message === 'Unknown error' || message === 'Send failed') {
    return true
  }

  return (
    /\bgateway time-?out\b/i.test(message)
    || /\b504\b/.test(message)
    || /\b408\b/.test(message)
    || /\bmaxRetriesExceeded\b/.test(message)
    || /^Chat request failed:/i.test(message)
    || /failed to fetch/i.test(message)
    || /^retry failed/i.test(message)
  )
}

export function sanitizeUpstreamErrorMessage(message: string, t: Translate): string {
  if (!isTechnicalUpstreamMessage(message)) {
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
