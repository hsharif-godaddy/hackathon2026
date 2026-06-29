const SECRET_HEADER_RE: RegExp = /authorization|api[-_]?key|token/i

/**
 * Redact the secret portion of a header value, preserving the scheme and the
 * first/last two characters so an operator can sanity-check which credential is
 * in play without the value being loggable. "ApiKey abcd1234" → "ApiKey ab<redacted>34".
 * Values of four chars or fewer are fully redacted.
 */
export function scrubHeaderValue(value: string): string {
  const spaceIdx: number = value.indexOf(' ')
  const scheme: string = spaceIdx === -1 ? '' : `${value.slice(0, spaceIdx)} `
  const secret: string = spaceIdx === -1 ? value : value.slice(spaceIdx + 1)
  if (secret.length <= 4) return `${scheme}<redacted>`
  return `${scheme}${secret.slice(0, 2)}<redacted>${secret.slice(-2)}`
}

/**
 * Scrub credential-bearing headers (Authorization / *api-key* / *token*) before
 * they reach a log line; non-secret headers (e.g. Content-Type) pass through
 * verbatim. The guard keeping the OTLP credential out of the unreachable-endpoint
 * warn log.
 */
export function scrubHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const scrubbed: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    scrubbed[name] = SECRET_HEADER_RE.test(name) ? scrubHeaderValue(value) : value
  }
  return scrubbed
}
