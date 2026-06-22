/** The two directions the homepage rebuild modal offers. */
export type RebuildModalDirection = 'modernize' | 'keep-similar'

/**
 * What the user chose to bring over from their source site. Persisted by the
 * modal and threaded to the agent. Booleans are the source of truth; the cards
 * are presets that seed them (see {@link presetForDirection}).
 */
export interface RebuildBringOverChoice {
  direction: RebuildModalDirection
  keepLogo: boolean
  keepImages: boolean
  keepColors: boolean
  keepFonts: boolean
}

/** The StylePreferences subset a bring-over choice determines. */
export interface BringOverStylePreferences {
  keepLogo: boolean
  keepSourceImages: boolean
  colorPreference: 'keep-original' | 'suggest-new'
  typographyStyle: 'keep-original' | 'modern'
}

/** All-keep defaults: used when the user hasn't gone through the modal. */
export const DEFAULT_BRING_OVER_PREFERENCES: BringOverStylePreferences = {
  keepLogo: true,
  keepSourceImages: true,
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
}

/**
 * Card presets. Keep-similar brings everything over. Reimagine starts a fresh
 * design but keeps the logo so the brand stays recognizable (matches the legacy
 * reimagine behavior) — the user can still toggle the logo off.
 */
export function presetForDirection(direction: RebuildModalDirection): RebuildBringOverChoice {
  const keepRest = direction === 'keep-similar'
  return { direction, keepLogo: true, keepImages: keepRest, keepColors: keepRest, keepFonts: keepRest }
}

/** Pure mapping from the four toggles to the StylePreferences fields they drive. */
export function bringOverToStylePreferences(choice: RebuildBringOverChoice): BringOverStylePreferences {
  return {
    keepLogo: choice.keepLogo,
    keepSourceImages: choice.keepImages,
    colorPreference: choice.keepColors ? 'keep-original' : 'suggest-new',
    typographyStyle: choice.keepFonts ? 'keep-original' : 'modern',
  }
}

/** Runtime guard for an untrusted choice object (message metadata, sessionStorage). */
export function isRebuildBringOverChoice(value: unknown): value is RebuildBringOverChoice {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.direction === 'modernize' || v.direction === 'keep-similar') &&
    typeof v.keepLogo === 'boolean' &&
    typeof v.keepImages === 'boolean' &&
    typeof v.keepColors === 'boolean' &&
    typeof v.keepFonts === 'boolean'
  )
}
