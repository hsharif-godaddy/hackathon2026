import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

export class TurnDurationEvaluator implements Evaluator {
  readonly name = 'turn-duration';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const definedDurations = transcript.turns
      .filter((t) => t.role === 'assistant' && t.durationMs !== undefined)
      .map((t) => t.durationMs as number);

    if (definedDurations.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No assistant turns with durationMs data',
        details: {},
      };
    }

    const totalDurationMs = definedDurations.reduce((sum, ms) => sum + ms, 0);
    const averageDurationMs = totalDurationMs / definedDurations.length;

    return {
      evaluator: this.name,
      score: totalDurationMs,
      verdict: 'observed',
      reason: `Total AAB duration: ${totalDurationMs}ms across ${definedDurations.length} turns (avg ${averageDurationMs.toFixed(0)}ms)`,
      details: {
        totalDurationMs,
        averageDurationMs,
        perTurnMs: definedDurations,
      },
    };
  }
}
