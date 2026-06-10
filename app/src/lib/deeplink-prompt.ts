/**
 * Pure helpers for the email deep-link prompt-prefill feature.
 *
 * `initialPromptKey` carries an i18n key *suffix* (marketing-owned). We resolve
 * it to `builder_deeplink_prompt_<suffix>` and look it up in the loaded intl
 * messages (existence check happens in the hook, not here).
 *
 * The `itc` and `itc_source` analytics params are validated with the shared
 * `validateItc` from `@/lib/itc` — same charset/length rules, single source of
 * truth (do not re-implement here).
 */

const PROMPT_KEY_SUFFIX_PATTERN = /^[a-z0-9_]+$/
const MAX_PROMPT_KEY_SUFFIX_LENGTH = 64

export const DEEPLINK_PROMPT_KEY_PREFIX = 'builder_deeplink_prompt_'

/**
 * Validate an `initialPromptKey` suffix. Returns the trimmed suffix or null.
 * Rejects (does not strip) disallowed input so a malformed link is ignored
 * rather than silently coerced into a different key.
 */
export function sanitizePromptKeySuffix(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_PROMPT_KEY_SUFFIX_LENGTH) return null
  if (!PROMPT_KEY_SUFFIX_PATTERN.test(trimmed)) return null
  return trimmed
}

/** Build the namespaced i18n key from a sanitized suffix. */
export function buildDeeplinkPromptKey(suffix: string): string {
  return `${DEEPLINK_PROMPT_KEY_PREFIX}${suffix}`
}
