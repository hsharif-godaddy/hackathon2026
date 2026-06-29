import type { EvalResult } from './evaluator.js';
import type { ChecklistCheckType } from '../scenarios/types.js';

export type ChecklistItemStatus = 'pass' | 'fail' | 'unknown';

export interface ChecklistItemOutcome {
  id: string;
  type: ChecklistCheckType;
  status: ChecklistItemStatus;
  reason: string;
}

export interface ChecklistVerdict {
  verdict: EvalResult['verdict'];
  score: number;
  reason: string;
  passedCount: number;
  failedCount: number;
  unknownCount: number;
  hardFailures: string[];
  directionalFailures: string[];
}

/**
 * Reduce per-item CheckList outcomes to a single scenario verdict,
 * shared by the static expected-artifact-match evaluator and the LLM
 * narrow-artifact-judge so their verdicts are produced by identical
 * rules and are therefore directly comparable in signal-disagreement
 * analysis.
 *
 * Rules:
 * - capability (MFT) / invariance (INV) failure → hard 'fail'
 * - directional (DIR) failure only → 'partial'
 * - all evaluable items pass → 'pass'
 * - no item could be evaluated → 'unknown'
 *
 * The verdict is the headline; score = passed / evaluated exists only
 * so the result aggregates cleanly in composites and pass@k.
 */
export function reduceChecklistOutcomes(
  outcomes: ChecklistItemOutcome[],
): ChecklistVerdict {
  const evaluated = outcomes.filter((o) => o.status !== 'unknown');
  const unknownCount = outcomes.length - evaluated.length;

  if (evaluated.length === 0) {
    return {
      verdict: 'unknown',
      score: 0,
      reason: 'No checklist item could be evaluated (insufficient data)',
      passedCount: 0,
      failedCount: 0,
      unknownCount,
      hardFailures: [],
      directionalFailures: [],
    };
  }

  const passed = evaluated.filter((o) => o.status === 'pass');
  const failed = evaluated.filter((o) => o.status === 'fail');
  const hardFailures = failed.filter(
    (o) => o.type === 'capability' || o.type === 'invariance',
  );
  const directionalFailures = failed.filter((o) => o.type === 'directional');

  const verdict: EvalResult['verdict'] =
    hardFailures.length > 0
      ? 'fail'
      : directionalFailures.length > 0
        ? 'partial'
        : 'pass';

  const reason =
    verdict === 'pass'
      ? `All ${evaluated.length} evaluated checklist item(s) met`
      : verdict === 'partial'
        ? `${directionalFailures.length} directional expectation(s) unmet: ` +
          directionalFailures.map((o) => o.id).join(', ')
        : `${hardFailures.length} required expectation(s) unmet: ` +
          hardFailures.map((o) => o.id).join(', ');

  return {
    verdict,
    score: passed.length / evaluated.length,
    reason,
    passedCount: passed.length,
    failedCount: failed.length,
    unknownCount,
    hardFailures: hardFailures.map((o) => o.id),
    directionalFailures: directionalFailures.map((o) => o.id),
  };
}
