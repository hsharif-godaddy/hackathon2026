/**
 * Normalizes pathway session id from the cookie value after one cookie-layer decode
 * (`request.cookies.get('pathway')?.value`).
 */
export function trafficPathwaySessionId(pathwayDecodedValue: string | undefined | null): string | undefined {
  const t = pathwayDecodedValue?.trim()
  if (!t || t.length === 0) {
    return undefined
  }
  return t
}
