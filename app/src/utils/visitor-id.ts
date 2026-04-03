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
 * Reads `vid` from the `visitor` cookie only.
 * Used only for ship/client logs (e.g. Elasticsearch), not CSP / FullStory payloads.
 */
export function getVisitorIdFromCookie(): string | undefined {
  const visitorRaw = cookieValue('visitor')
  if (!visitorRaw) {
    return undefined
  }
  return new URLSearchParams(visitorRaw).get('vid') || undefined
}
