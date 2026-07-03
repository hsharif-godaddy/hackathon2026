import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

export class BugHitRateEvaluator implements Evaluator {
  readonly name = 'bug-hit-rate';
  readonly comparisonMode = 'passRate' as const;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const errorCount = transcript.errors.length;
    // score = 1 / (1 + errors): 0 errors → 1.0, 1 → 0.5, 2 → 0.33, …
    const score = errorCount === 0 ? 1.0 : 1 / (1 + errorCount);
    const verdict: EvalResult['verdict'] =
      errorCount <= 1 ? 'pass' : 'fail';
    const reason =
      errorCount === 0
        ? 'No unrecovered errors'
        : `${errorCount} unrecovered error(s) in transcript`;

    return {
      evaluator: this.name,
      score,
      verdict,
      reason,
      details: { errorCount, errors: transcript.errors },
    };
  }
}
