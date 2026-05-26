import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

/**
 * Measures tool-call batching efficiency using a self-normalizing model.
 *
 * score = (calls - turns) / (calls - 1)
 *
 * Where calls = total successful tool calls, turns = productive assistant turns.
 *
 * Semantics: (calls - turns) is the number of "bonus" calls batched beyond the
 * unavoidable minimum of 1 call per turn. (calls - 1) is the maximum possible
 * bonus calls if everything were in a single turn. Score is the fraction of
 * maximum batching opportunity realized — no free parameters, no calibration.
 *
 * Bounds: 0.0 (one call per turn) → 1.0 (all calls in one turn).
 * Returns unknown when calls < 2 (cannot measure batching from a single call).
 */
export class ToolBatchingEfficiencyEvaluator implements Evaluator {
  readonly name = 'tool-batching-efficiency';
  readonly evalVersion = '1.2';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = false;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const productiveTurns = transcript.turns.filter(
      (t) => t.role === 'assistant' && t.toolCalls.some((tc) => !tc.error),
    );

    if (productiveTurns.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No assistant turns with tool calls',
        details: { totalSuccessfulCalls: 0, productiveTurns: 0 },
        evalVersion: this.evalVersion,
      };
    }

    const totalSuccessfulCalls = productiveTurns.reduce(
      (sum, turn) => sum + turn.toolCalls.filter((tc) => !tc.error).length,
      0,
    );

    if (totalSuccessfulCalls < 2) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: `Only ${totalSuccessfulCalls} successful call(s) — cannot measure batching`,
        details: { totalSuccessfulCalls, productiveTurns: productiveTurns.length },
        evalVersion: this.evalVersion,
      };
    }

    const turns = productiveTurns.length;
    const calls = totalSuccessfulCalls;
    const score = (calls - turns) / (calls - 1);

    return {
      evaluator: this.name,
      score,
      verdict: 'observed',
      reason: `${calls} successful calls across ${turns} productive turns`,
      details: { totalSuccessfulCalls: calls, productiveTurns: turns },
      evalVersion: this.evalVersion,
    };
  }
}
