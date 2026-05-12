import { clamp01 } from '../shared.js';

export interface StructuralScoreResult {
  /** Normalized score in [0.0, 1.0]. */
  score: number;
  /** false when the HTML lacks the elements needed to compute a meaningful score. */
  canScore: boolean;
  reason: string;
  details: Record<string, unknown>;
}

export interface StructuralEvalSpec {
  /** Matches the `evaluator` field on EvalResult and the evaluator's `name`. */
  name: string;
  /** Short label injected into EvalResult.details.dimension for traceability. */
  dimension: string;
  description: string;
  /** Semantic version tag for regression comparison. Bump when scoring logic changes. */
  evalVersion?: string;
  score: (bodyHtml: string) => StructuralScoreResult;
  /**
   * When true, the spec receives body HTML with data-dev-* attributes intact.
   * Default (false/absent): dev attributes are stripped before scoring.
   * Use for specs that explicitly analyse component provenance (e.g. component-decomposition).
   */
  keepDevAttributes?: true;
  /**
   * When true, the evaluator passes the full document HTML (not just <body>)
   * to score(). Use for specs that need <head> content (e.g. viewport meta).
   * Default (false/absent): only <body> content is passed.
   */
  needsFullDocument?: true;
}

const DATA_DEV_ATTR_RE = /\s+data-dev-[^\s=/>]+(?:=["'][^"']*["']|=[^\s"'>]+)?/g;

/**
 * Removes data-dev-* attributes from HTML before scoring.
 * These are injected by dev tooling and produce noise in structural analysis.
 */
export function stripDevAttributes(html: string): string {
  return html.replace(DATA_DEV_ATTR_RE, '');
}

/**
 * Division guard for ratio calculations.
 *
 * Returns 1.0 when denominator is 0 or non-finite — the spec-level
 * `canScore: false` flag handles the "no elements to measure" case;
 * `safeRatio` is a last-resort guard for intermediate arithmetic.
 */
export function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator === 0) return 1.0;
  const ratio = numerator / denominator;
  if (!Number.isFinite(ratio)) return 0;
  return clamp01(ratio);
}
