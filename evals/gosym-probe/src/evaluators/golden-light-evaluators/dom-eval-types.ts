import { clamp01 } from '../shared.js';
import type { ChecklistItemOutcome } from '../checklist-verdict.js';

export type { ChecklistItemOutcome };

export interface StructuralScoreResult {
  /** Normalized score in [0.0, 1.0]. */
  score: number;
  /** false when the HTML lacks the elements needed to compute a meaningful score. */
  canScore: boolean;
  reason: string;
  details: Record<string, unknown>;
}

interface StructuralEvalSpecBase {
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

export interface PassRateSpec extends StructuralEvalSpecBase {
  /**
   * Determines the verdict path in DeterministicDomEvaluator and the composite
   * track this evaluator belongs to.
   * - 'passRate': verdict derived from reduceChecklistOutcomes (binary pass/fail/unknown)
   */
  comparisonMode: 'passRate';
  /**
   * Returns typed binary checklist outcomes for the checks this spec owns.
   * A check whose source element is absent emits status: 'unknown'.
   * Never throws on empty/malformed HTML — returns all-unknown in that case.
   * Checks are computed from typed locals, NOT from StructuralScoreResult.details.
   */
  toChecklistItems: (bodyHtml: string) => ChecklistItemOutcome[];
}

export interface ScoreSpec extends StructuralEvalSpecBase {
  /**
   * Determines the verdict path in DeterministicDomEvaluator and the composite
   * track this evaluator belongs to.
   * - 'score': verdict derived from scoreToVerdict(clamp01(result.score))
   */
  comparisonMode: 'score';
  toChecklistItems?: (bodyHtml: string) => ChecklistItemOutcome[];
}

export type StructuralEvalSpec = PassRateSpec | ScoreSpec;

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
