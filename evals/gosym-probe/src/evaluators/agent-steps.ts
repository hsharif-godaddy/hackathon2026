import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { SIGMOID_MIDPOINT, SIGMOID_STEEPNESS, sigmoidScore } from './shared.js';

/**
 * Measures total agent steps across a conversation.
 * Scoring uses sigmoid normalization (midpoint=15, steepness=0.2)
 * tuned for discrimination in the 3-30 step range.
 */
export class AgentStepsEvaluator implements Evaluator {
  readonly name = 'agent-steps';
  readonly evalVersion = '1.0';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = false;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    const hasData = assistantTurns.some(
      (t) => t.totalSteps !== undefined,
    );

    if (!hasData) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No assistant turns with totalSteps data',
        details: {},
        evalVersion: this.evalVersion,
      };
    }

    const totalSteps = assistantTurns.reduce(
      (sum, t) => sum + (t.totalSteps ?? 0),
      0,
    );

    if (!Number.isFinite(totalSteps)) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: `Invalid totalSteps sum: ${totalSteps}`,
        details: { totalSteps },
        evalVersion: this.evalVersion,
      };
    }

    return {
      evaluator: this.name,
      score: sigmoidScore(totalSteps, SIGMOID_MIDPOINT, SIGMOID_STEEPNESS),
      verdict: 'observed',
      reason: `${totalSteps} agent steps`,
      details: { totalSteps },
      evalVersion: this.evalVersion,
    };
  }
}
