/**
 * Restricts model overrides to Claude Sonnet/Haiku models only to prevent cost abuse.
 * isModelSupported() includes expensive non-Claude models like gpt-4,
 * while grants are not model-specific — this allowlist is the primary defense.
 * Opus models are intentionally excluded due to significantly higher per-token cost.
 *
 * Update this set when new Claude models are added.
 */
export const ALLOWED_OVERRIDE_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5',
  'sonnet',
  'haiku',
]);
