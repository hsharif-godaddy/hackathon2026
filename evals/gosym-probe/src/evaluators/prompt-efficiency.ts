import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
const DEFAULT_MAX_TURNS = 30;

export class PromptEfficiencyEvaluator implements Evaluator {
  readonly name = 'prompt-efficiency';
  readonly regressionMode = 'score' as const;
  // Score formula is 1 - usedTurns/maxTurns, so higher = fewer turns = better
  readonly lowerIsBetter = false;

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const maxTurns = scenario.maxTurns ?? DEFAULT_MAX_TURNS;
    const userTurns = transcript.turns.filter(
      (t) => t.role === 'user',
    ).length;
    const score = Math.max(0, 1 - userTurns / maxTurns);

    return {
      evaluator: this.name,
      score,
      verdict: 'observed',
      reason: (
        `Used ${userTurns} of ${maxTurns} max turns` +
        ` (efficiency: ${(score * 100).toFixed(0)}%)`
      ),
      details: { userTurns, maxTurns, score },
    };
  }
}
