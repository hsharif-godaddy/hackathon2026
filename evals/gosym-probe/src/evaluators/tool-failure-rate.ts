import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

export class ToolFailureRateEvaluator implements Evaluator {
  readonly name = 'tool-failure-rate';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const allToolCalls = transcript.turns.flatMap((turn) => turn.toolCalls);
    const totalCalls = allToolCalls.length;

    if (totalCalls === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No tool calls in transcript',
        details: { failedCount: 0, totalCalls: 0, failedTools: [] },
      };
    }

    // tc.error === '' signals a non-fatal warning; only non-empty strings are real failures.
    const failedCalls = allToolCalls.filter((tc) => tc.error != null && tc.error !== '');
    const failedCount = failedCalls.length;

    const failedToolNames = [...new Set(failedCalls.map((tc) => tc.name))].sort();

    const rate = failedCount / totalCalls;
    const reason =
      failedCount === 0
        ? `No tool failures across ${totalCalls} tool call(s)`
        : `${failedCount}/${totalCalls} tool calls failed (${(rate * 100).toFixed(0)}%): ${failedToolNames.join(', ')}`;

    return {
      evaluator: this.name,
      score: rate,
      verdict: 'observed',
      reason,
      details: {
        failedCount,
        totalCalls,
        failedTools: failedToolNames,
      },
    };
  }
}
