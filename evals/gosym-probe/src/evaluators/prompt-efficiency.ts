import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { SIGMOID_MIDPOINT, SIGMOID_STEEPNESS, sigmoidScore } from './shared.js';

/**
 * Measures user turn count as a proxy for prompt efficiency.
 * Scoring uses sigmoid normalization (midpoint=15, steepness=0.2)
 * tuned for discrimination in the 3-30 turn range.
 */
export class PromptEfficiencyEvaluator implements Evaluator {
  readonly name = 'prompt-efficiency';
  readonly evalVersion = '1.0';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = false;

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
      score: sigmoidScore(userTurns, SIGMOID_MIDPOINT, SIGMOID_STEEPNESS),
      verdict: 'observed',
      reason: `${userTurns} user turns`,
      details: { userTurns },
      evalVersion: this.evalVersion,
    };
  }
}
