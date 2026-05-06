import type { Config } from '../../config/environments/types.js';

// Matches Private_Use (\p{Co}) and Unassigned (\p{Cn}) Unicode chars —
// the exact categories LiteLLM's guardrail rejects.
const UNSAFE_UNICODE_RE = /[\p{Co}\p{Cn}]/gu;

/**
 * Removes Private_Use and Unassigned Unicode characters from a string
 * before it is sent to an LLM API. These categories are rejected by
 * LiteLLM's guardrail with a 400 error.
 */
export function stripUnsafeUnicode(text: string): string {
  return text.replace(UNSAFE_UNICODE_RE, '');
}

/**
 * Config with credentials stripped. `gocode.apiKey` is absent so
 * this type is safe to serialize into run metadata on disk.
 */
export type SanitizedConfig = Omit<Config, 'gocode'> & {
  gocode: Omit<Config['gocode'], 'apiKey'>;
};

/**
 * Returns a copy of config with `gocode.apiKey` removed.
 * Use this before writing config to any persistent store.
 */
export function sanitizeConfig(config: Config): SanitizedConfig {
  const { gocode: { apiKey: _apiKey, ...gocode }, ...rest } = config;
  return { ...rest, gocode };
}
