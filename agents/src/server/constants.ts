/**
 * Restricts model overrides to approved Claude models to prevent cost abuse.
 * isModelSupported() includes expensive non-Claude models like gpt-4,
 * while grants are not model-specific — this allowlist is the primary defense.
 *
 * Update this set when new Claude models are added.
 */
export const ALLOWED_OVERRIDE_MODELS = new Set([
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'azure/claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5',
  'sonnet',
  'haiku',
]);
