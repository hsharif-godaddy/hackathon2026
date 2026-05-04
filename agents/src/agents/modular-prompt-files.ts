import type { ProfileData } from '../profiles/types.js'

export const MODULAR_PROMPT_FILES_KEY = 'initial.modularPromptFiles' as const

/** Modular prompt files (3.0+). Each is independently swappable. */
export const DEFAULT_MODULAR_PROMPT_FILES = [
  'identity.md',
  'questioning.md',
  'project-name.md',
  'design-direction.md',
  'design-reference.md',
  'feature-list.md',
  'handoff-template.md',
  'examples.md',
] as const

/** Basename only: letters, digits, underscore, dot, hyphen; must end in `.md` (prevents path traversal). */
const SAFE_MODULAR_FILENAME = /^[\w.-]+\.md$/u

function assertSafeModularFilename(name: string): void {
  if (!SAFE_MODULAR_FILENAME.test(name)) {
    throw new Error(
      `Invalid modular prompt filename "${name}": use a single .md basename (letters, digits, _, -, . only; no slashes).`,
    )
  }
}

/**
 * Parse CSV from profile / ALS. Whitespace-only and all-empty tokens fall back to defaults.
 * Each non-empty token must be a safe basename (no path segments); otherwise throws.
 */
export function parseModularPromptFilesCsv(rawInput: string): string[] {
  const raw = rawInput.trim()
  if (!raw) return [...DEFAULT_MODULAR_PROMPT_FILES]
  const parsed = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (parsed.length === 0) return [...DEFAULT_MODULAR_PROMPT_FILES]
  for (const name of parsed) {
    assertSafeModularFilename(name)
  }
  return parsed
}

/**
 * True when the profile intends a custom modular file list (at least one non-empty CSV token).
 * Matches {@link parseModularPromptFilesCsv} / {@link parseModularPromptFilesFromProfileProperty} so we
 * do not register an `initial-v3-<profile>` variant that would duplicate default prompts.
 */
export function profileDefinesCustomModularPromptFiles(profile: ProfileData): boolean {
  const v = profile.properties[MODULAR_PROMPT_FILES_KEY]
  return typeof v === 'string' && v.split(',').some(s => s.trim().length > 0)
}

export function parseModularPromptFilesFromProfileProperty(profile: ProfileData): string[] {
  const v = profile.properties[MODULAR_PROMPT_FILES_KEY]
  const raw = typeof v === 'string' ? v : ''
  return parseModularPromptFilesCsv(raw)
}
