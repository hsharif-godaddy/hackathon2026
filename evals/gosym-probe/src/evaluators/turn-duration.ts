import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

const PASS_THRESHOLD = 0.7;
const PARTIAL_THRESHOLD = 0.4;

export class TurnDurationEvaluator implements Evaluator {
  readonly name = 'turn-duration';
  readonly deterministic = true;

  constructor(
    private readonly options: { maxDurationMs: number },
  ) {}

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const { maxDurationMs } = this.options;
    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    const hasData = assistantTurns.some(
      (t) => t.durationMs !== undefined,
    );

    if (!hasData) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No assistant turns with durationMs data',
        details: {},
      };
    }

    const totalDurationMs = assistantTurns.reduce(
      (sum, t) => sum + (t.durationMs ?? 0),
      0,
    );
    const score = Math.max(0, 1 - totalDurationMs / maxDurationMs);

    let verdict: EvalResult['verdict'];
    if (score >= PASS_THRESHOLD) {
      verdict = 'pass';
    } else if (score >= PARTIAL_THRESHOLD) {
      verdict = 'partial';
    } else {
      verdict = 'fail';
    }

    return {
      evaluator: this.name,
      score,
      verdict,
      reason: (
        `Used ${totalDurationMs}ms of ${maxDurationMs}ms max duration` +
        ` (efficiency: ${(score * 100).toFixed(0)}%)`
      ),
      details: { totalDurationMs, maxDurationMs },
    };
  }
}
