import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

export class AgentStepsEvaluator implements Evaluator {
  readonly name = 'agent-steps';
  readonly regressionMode = 'score' as const;
  // Score formula is 1 - usedSteps/maxSteps, so higher = fewer steps = better
  readonly lowerIsBetter = false;

  constructor(private readonly options: { maxSteps: number }) {
    if (!Number.isFinite(options.maxSteps) || options.maxSteps <= 0) {
      throw new RangeError(
        `AgentStepsEvaluator requires maxSteps > 0, got ${options.maxSteps}`,
      );
    }
  }

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const { maxSteps } = this.options;
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
      };
    }

    const totalSteps = assistantTurns.reduce(
      (sum, t) => sum + (t.totalSteps ?? 0),
      0,
    );
    const score = Math.max(0, 1 - totalSteps / maxSteps);

    return {
      evaluator: this.name,
      score,
      verdict: 'observed',
      reason: (
        `Used ${totalSteps} of ${maxSteps} max agent steps` +
        ` (efficiency: ${(score * 100).toFixed(0)}%)`
      ),
      details: { totalSteps, maxSteps },
    };
  }
}
