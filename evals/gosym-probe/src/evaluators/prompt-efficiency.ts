import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

/**
 * Measures user turn count as a proxy for prompt efficiency.
 * Emits the raw turn count (lower is better) for score-mode regression.
 */
export class PromptEfficiencyEvaluator implements Evaluator {
  readonly name = 'prompt-efficiency';
  readonly evalVersion = '2.0';
  readonly comparisonMode = 'score' as const;
  readonly lowerIsBetter = true;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const userTurns = transcript.turns.filter(
      (t) => t.role === 'user',
    ).length;

    return {
      evaluator: this.name,
      score: userTurns,
      verdict: 'directional',
      reason: `${userTurns} user turns`,
      details: { userTurns },
      evalVersion: this.evalVersion,
    };
  }
}
