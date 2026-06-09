/**
 * Score scale + scoreType helpers.
 *
 * Every GoArena evaluator declares its own scale (`scoreConfig.min`/`max`, almost always 0–100).
 * Raw scores are kept for per-evaluator reporting; NORMALIZED [0,1] scores are used for any
 * cross-evaluator aggregation so we never blend e.g. a 1–10 evaluator with a 0–100 one.
 */

export interface ScoreScale {
  min: number;
  max: number;
}

export const DEFAULT_SCALE: ScoreScale = { min: 0, max: 100 };

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

/** Resolve the scale from an evaluator spec's scoreConfig, falling back to 0–100. */
export function resolveScale(scoreConfig: { min?: number; max?: number } | undefined): ScoreScale {
  const min = typeof scoreConfig?.min === 'number' && Number.isFinite(scoreConfig.min) ? scoreConfig.min : DEFAULT_SCALE.min;
  const max = typeof scoreConfig?.max === 'number' && Number.isFinite(scoreConfig.max) ? scoreConfig.max : DEFAULT_SCALE.max;
  // Guard against a degenerate or inverted scale.
  if (!(max > min)) return DEFAULT_SCALE;
  return { min, max };
}

/** Map a raw score onto [0,1] for the given scale (clamped). */
export function normalize(score: number, scale: ScoreScale): number {
  const t = (score - scale.min) / (scale.max - scale.min);
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

/**
 * Extract a numeric score from a judge's parsed JSON. Looks at the conventional fields used across
 * the evaluator templates (`score`, `overallScore`). Returns null when absent/non-numeric.
 */
export function extractNumericScore(parsed: unknown): number | null {
  if (!isObject(parsed)) return null;
  const direct = parsed['score'] ?? parsed['overallScore'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  return null;
}

/**
 * Extract a categorical label from a judge's parsed JSON (`status`, `verdict`, `label`, or a
 * string-valued `score`). Returns null when none present.
 */
export function extractCategoricalLabel(parsed: unknown): string | null {
  if (!isObject(parsed)) return null;
  for (const key of ['status', 'verdict', 'label', 'category', 'score']) {
    const v = parsed[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Is a numeric score within the declared scale (with a tiny epsilon for float noise)? */
export function withinScale(score: number, scale: ScoreScale): boolean {
  const eps = (scale.max - scale.min) * 1e-6;
  return score >= scale.min - eps && score <= scale.max + eps;
}
