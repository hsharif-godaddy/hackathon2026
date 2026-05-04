// FIELD_SEPARATOR must not appear in any field's charset. ':' is excluded from
// SITE_ID_REGEX, CELL_PREFIX_REGEX, and TOKEN_REGEX below — the field-separator
// invariant test in __tests__/codec.test.ts asserts this contract explicitly.
const FIELD_SEPARATOR = ':'
const MAX_ENCODED_LENGTH = 128

// siteId charset matches nanoid default plus hyphen (real ids look like
// "nxOMNRQOtCBBHG7e3CI8R", "k8bnu24pcq", "test-app-123"). Excludes "." and
// "/" so a malicious siteId cannot inject hostname segments. Length cap of 32
// means UUID-format ids (36 chars with dashes) are rejected here — callers
// must check `isEncodableSiteId` before encoding.
export const SITE_ID_REGEX = /^[A-Za-z0-9_-]{6,32}$/

// `cellPrefix` is the SHORT form ("c4", "c36") — NOT the full AppInfo.cellId
// from the control plane (e.g. "c4-dev-sxb1-eu-central-1"). The two are
// related but distinct: callers holding a full cellId must extract the prefix
// (the leading `c\d+` segment) before passing it here. Keeping the names
// distinct prevents accidental encodeSharePayload({ cellPrefix: app.cellId })
// throws at runtime. Length cap (1-6 digits) documents that cells are small
// integers; matches the digit count of every cell currently in use.
export const CELL_PREFIX_REGEX = /^c\d{1,6}$/

export const TOKEN_REGEX = /^[A-Za-z0-9_-]{8,16}$/

export interface SharePayload {
  siteId: string
  cellPrefix: string
  token: string
}

export function isEncodableSiteId(siteId: string): boolean {
  return SITE_ID_REGEX.test(siteId)
}

export function isEncodableCellPrefix(cellPrefix: string): boolean {
  return CELL_PREFIX_REGEX.test(cellPrefix)
}

export function isEncodableToken(token: string): boolean {
  return TOKEN_REGEX.test(token)
}

/**
 * Encode a share payload as a base64url single-segment URL component.
 *
 * Throws if any field fails its charset/length contract. Callers should
 * pre-check with `isEncodableSiteId` / `isEncodableCellPrefix` /
 * `isEncodableToken` and fall back to a legacy URL when validation fails —
 * that way failures surface at share-create time, not silently when
 * recipients open broken links later.
 */
export function encodeSharePayload(payload: SharePayload): string {
  if (!isEncodableSiteId(payload.siteId)) {
    throw new Error(`encodeSharePayload: siteId fails validation`)
  }
  if (!isEncodableCellPrefix(payload.cellPrefix)) {
    throw new Error(`encodeSharePayload: cellPrefix fails validation`)
  }
  if (!isEncodableToken(payload.token)) {
    throw new Error(`encodeSharePayload: token fails validation`)
  }

  const plaintext = `${payload.siteId}${FIELD_SEPARATOR}${payload.cellPrefix}${FIELD_SEPARATOR}${payload.token}`
  return Buffer.from(plaintext, 'utf8').toString('base64url')
}

/**
 * Redact a share token for logging. Share tokens are 7-day bearer credentials
 * for unauthenticated preview access — logging them verbatim into Loki /
 * structured logs would let anyone with log-viewer access exfiltrate active
 * tokens. Returns the last 4 chars (enough for log correlation, not enough
 * to brute-force given an 8-char unknown prefix is 2^48 possibilities).
 *
 * Apply at every log site that mentions a token: route handlers, repository
 * methods, BFF proxy. Use the literal string '****' when the input is not
 * a usable token (null/undefined/short string) so log shape stays uniform.
 */
export function tokenSuffix(token: unknown): string {
  if (typeof token !== 'string' || token.length < 8) return '****'
  return token.slice(-4)
}

export function decodeSharePayload(encoded: string): SharePayload | null {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_ENCODED_LENGTH) {
    return null
  }

  // Buffer.from(_, 'base64url') is lenient: invalid chars are silently dropped
  // rather than throwing. The real safety net is the per-field regex check
  // below, which rejects anything that didn't round-trip to a valid payload.
  const plaintext = Buffer.from(encoded, 'base64url').toString('utf8')

  const parts = plaintext.split(FIELD_SEPARATOR)
  if (parts.length !== 3) return null

  const [siteId, cellPrefix, token] = parts
  if (!siteId || !cellPrefix || !token) return null

  if (!SITE_ID_REGEX.test(siteId)) return null
  if (!CELL_PREFIX_REGEX.test(cellPrefix)) return null
  if (!TOKEN_REGEX.test(token)) return null

  return { siteId, cellPrefix, token }
}
