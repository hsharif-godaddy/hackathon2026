import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { scoreToVerdict } from './eval-utils.js';

const DEFAULT_MAX_TURNS = 30;

export class PromptEfficiencyEvaluator implements Evaluator {
  readonly name = 'prompt-efficiency';
  readonly deterministic = true;

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
    const verdict = scoreToVerdict(score);

    return {
      evaluator: this.name,
      score,
      verdict,
      reason: (
        `Used ${userTurns} of ${maxTurns} max turns` +
        ` (efficiency: ${(score * 100).toFixed(0)}%)`
      ),
      details: { userTurns, maxTurns, score },
    };
  }
}
