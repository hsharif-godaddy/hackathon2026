import type { EvalResult } from './evaluator.js';

export type ChecklistItemStatus = 'pass' | 'fail' | 'incomplete';

export interface ChecklistItemOutcome {
  id: string;
  type?: string;
  status: ChecklistItemStatus;
  reason: string;
}

export interface ChecklistVerdict {
  verdict: EvalResult['verdict'];
  score: number;
  reason: string;
  passedCount: number;
  failedCount: number;
  incompleteCount: number;
  hardFailures: string[];
}

/**
 * Reduce per-item CheckList outcomes to a single scenario verdict,
 * shared by the static expected-artifact-match evaluator and the LLM
 * narrow-artifact-judge so their verdicts are produced by identical
 * rules and are therefore directly comparable in signal-disagreement
 * analysis.
 *
 * Every checklist item is now binary (capability / invariance), so the
 * reduction is a clean pass/fail — it never emits 'partial'. Directional
 * (degree) signals were moved out to the score-mode
 * DirectionalSignalEvaluator precisely because a 'partial' verdict
 * deflated pass@k without being a clean fail (see ChecklistCheckType).
 *
 * Rules:
 * - any capability (MFT) / invariance (INV) failure → hard 'fail'
 * - all evaluable items pass → 'pass'
 * - no item could be evaluated → 'incomplete'
 *
 * The verdict is the headline; score = passed / evaluated exists only
 * so the result aggregates cleanly in composites and pass@k.
 */
export function reduceChecklistOutcomes(
  outcomes: ChecklistItemOutcome[],
): ChecklistVerdict {
  const evaluated = outcomes.filter((o) => o.status !== 'incomplete');
  const incompleteCount = outcomes.length - evaluated.length;

  if (evaluated.length === 0) {
    return {
      verdict: 'incomplete',
      score: 0,
      reason: 'No checklist item could be evaluated (insufficient data)',
      passedCount: 0,
      failedCount: 0,
      incompleteCount,
      hardFailures: [],
    };
  }

  const passed = evaluated.filter((o) => o.status === 'pass');
  const hardFailures = evaluated.filter((o) => o.status === 'fail');

  const verdict: EvalResult['verdict'] =
    hardFailures.length > 0 ? 'fail' : 'pass';

  const reason =
    verdict === 'pass'
      ? `All ${evaluated.length} evaluated checklist item(s) met`
      : `${hardFailures.length} required expectation(s) unmet: ` +
        hardFailures.map((o) => o.id).join(', ');

  return {
    verdict,
    score: passed.length / evaluated.length,
    reason,
    passedCount: passed.length,
    failedCount: hardFailures.length,
    incompleteCount,
    hardFailures: hardFailures.map((o) => o.id),
  };
}
