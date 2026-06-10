import { describe, expect, it } from 'vitest'

import { buildDeeplinkPromptKey, sanitizePromptKeySuffix } from './deeplink-prompt'

describe('sanitizePromptKeySuffix', () => {
  it('accepts lowercase, digits, underscore', () => {
    expect(sanitizePromptKeySuffix('hair_salon')).toBe('hair_salon')
    expect(sanitizePromptKeySuffix('logo2')).toBe('logo2')
  })

  it('rejects empty, null, and over-length input', () => {
    expect(sanitizePromptKeySuffix(null)).toBeNull()
    expect(sanitizePromptKeySuffix('')).toBeNull()
    expect(sanitizePromptKeySuffix('a'.repeat(65))).toBeNull()
  })

  it('rejects disallowed characters rather than stripping them', () => {
    expect(sanitizePromptKeySuffix('Hair-Salon')).toBeNull() // uppercase + hyphen
    expect(sanitizePromptKeySuffix('hair salon')).toBeNull() // space
    expect(sanitizePromptKeySuffix('builder_deeplink_prompt_x')).toBe('builder_deeplink_prompt_x') // still just a suffix; namespace is added separately
  })
})

describe('buildDeeplinkPromptKey', () => {
  it('prefixes the namespace', () => {
    expect(buildDeeplinkPromptKey('hair_salon')).toBe('builder_deeplink_prompt_hair_salon')
  })
})

// `itc` / `itc_source` validation for deep links is covered by the shared
// `validateItc` in `@/lib/itc` (see itc/storage.test.ts) — not duplicated here.
