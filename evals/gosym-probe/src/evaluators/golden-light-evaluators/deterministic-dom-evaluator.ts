import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { EvalResult, Evaluator } from '../evaluator.js';
import { extractBodyHtml, clamp01, readSnapshotHtml } from '../shared.js';
import { scoreToVerdict } from '../eval-utils.js';
import type { StructuralEvalSpec } from './dom-eval-types.js';
import { stripDevAttributes } from './dom-eval-types.js';

/**
 * Wraps any StructuralEvalSpec into a fully-conformant Evaluator.
 *
 * Responsibilities:
 * - Extract and clean HTML before delegating to the spec
 * - Isolate spec errors (returns unknown instead of throwing)
 * - Clamp score to [0, 1]
 * - Inject dimension into details for traceability
 */
export class DeterministicDomEvaluator implements Evaluator {
  readonly name: string;
  readonly evalVersion?: string;

  constructor(private readonly spec: StructuralEvalSpec) {
    this.name = spec.name;
    this.evalVersion = spec.evalVersion;
  }

  async evaluate(
    _transcript: Transcript,
    _scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const html = await readSnapshotHtml(snapshot);
    if (!html.trim()) {
      return this.unknown('No DOM snapshot available');
    }

    const rawHtml = this.spec.needsFullDocument ? html : extractBodyHtml(html);
    const cleanHtml = this.spec.keepDevAttributes
      ? rawHtml
      : stripDevAttributes(rawHtml);

    let result;
    try {
      result = this.spec.score(cleanHtml);
    } catch (err: unknown) {
      console.warn(
        '[DeterministicDomEvaluator] spec threw during scoring:',
        { spec: this.spec.name },
        err,
      );
      return this.unknown('Spec threw during scoring');
    }

    if (!result.canScore) {
      return this.unknown(result.reason || 'Insufficient HTML to score this dimension');
    }

    const score = clamp01(result.score);
    return {
      evaluator: this.name,
      score,
      verdict: scoreToVerdict(score),
      reason: result.reason,
      details: {
        dimension: this.spec.dimension,
        ...result.details,
      },
      ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
    };
  }

  private unknown(reason: string): EvalResult {
    return {
      evaluator: this.name,
      score: 0,
      verdict: 'unknown',
      reason,
      ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
    };
  }
}
