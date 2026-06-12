/**
 * Locale-stable user-message markers for secrets composer save/cancel.
 * UI may show translated copy; detection and agents must use these tags, not t() strings.
 */

export const SECRETS_COMPOSER_OUTCOME_TAG_RE =
  /^\[\[secrets-composer-outcome:(cancel|added|updated)\]\](?:\s+|$)/

/** Legacy cancel phrases (pre-tag); includes translated bodies from older builds. */
export const LEGACY_SECRETS_CANCEL_MARKERS = [
  'I cancelled entering the requested secret(s)',
  'I cancelled adding secrets',
] as const

export const LEGACY_SECRETS_SUCCESS_RE = /^Secret(s)? (added|updated|saved) successfully/i

export type SecretsComposerOutcomeKind = 'cancel' | 'add' | 'update'

export function buildSecretsComposerCancelUserMessage(): string {
  return '[[secrets-composer-outcome:cancel]]'
}

export function buildSecretsComposerSuccessUserMessage(
  mode: 'add' | 'update',
  secretNames: string[],
): string {
  const tag = mode === 'update' ? 'updated' : 'added'
  const actionWord = mode === 'update' ? 'updated' : 'added'
  const names = secretNames.map((name) => name.trim()).filter(Boolean)
  const body =
    names.length > 1
      ? `Secrets ${actionWord} successfully: ${names.join(', ')}`
      : `Secret ${actionWord} successfully: ${names[0] ?? ''}`
  return `[[secrets-composer-outcome:${tag}]] ${body}`
}

export function stripSecretsComposerOutcomeTag(content: string): string {
  return content.trim().replace(SECRETS_COMPOSER_OUTCOME_TAG_RE, '').trim()
}

export function parseSecretsComposerOutcomeKind(content: string): SecretsComposerOutcomeKind | null {
  const match = content.trim().match(/^\[\[secrets-composer-outcome:(cancel|added|updated)\]\]/)
  if (!match) {
    return null
  }
  if (match[1] === 'cancel') {
    return 'cancel'
  }
  if (match[1] === 'added') {
    return 'add'
  }
  return 'update'
}

export function isSecretsComposerCancelUserContent(content: string): boolean {
  const trimmed = content.trim()
  if (parseSecretsComposerOutcomeKind(trimmed) === 'cancel') {
    return true
  }
  return LEGACY_SECRETS_CANCEL_MARKERS.some((marker) => trimmed.includes(marker))
}

export function isSecretsComposerSuccessUserContent(content: string): boolean {
  const trimmed = content.trim()
  const kind = parseSecretsComposerOutcomeKind(trimmed)
  if (kind === 'add' || kind === 'update') {
    return true
  }
  return LEGACY_SECRETS_SUCCESS_RE.test(trimmed)
}
