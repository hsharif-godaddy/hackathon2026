function cookieValue(name: string): string | undefined {
  if (typeof document === 'undefined') {
    return undefined
  }
  const segments = document.cookie.split(';')
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed.startsWith(`${name}=`)) {
      continue
    }
    const raw = trimmed.slice(name.length + 1)
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return undefined
}

/**
 * Visitor cookie value after one decode (Next `request.cookies` or client `cookieValue`).
 * Second decodeURIComponent would corrupt ids whose decoded form still contains `%…` sequences.
 */
export function visitorIdFromVisitorCookieRaw(visitorDecodedValue: string | undefined | null): string | undefined {
  if (!visitorDecodedValue) {
    return undefined
  }
  return new URLSearchParams(visitorDecodedValue).get('vid') || undefined
}

/**
 * Reads `vid` from the `visitor` cookie only.
 * Used only for ship/client logs (e.g. Elasticsearch), not CSP / FullStory payloads.
 */
export function getVisitorIdFromCookie(): string | undefined {
  return visitorIdFromVisitorCookieRaw(cookieValue('visitor'))
}
