import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

/**
 * Measures total agent steps across a conversation.
 * Emits the raw step count (lower is better) for score-mode regression.
 */
export class AgentStepsEvaluator implements Evaluator {
  readonly name = 'agent-steps';
  readonly evalVersion = '2.0';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

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
      score: totalSteps,
      verdict: 'observed',
      reason: `${totalSteps} agent steps`,
      details: { totalSteps },
      evalVersion: this.evalVersion,
    };
  }
}
