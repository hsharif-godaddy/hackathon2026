import type { ScenarioResult, TrialResult } from '../runner/types.js';

export interface BaselineEligibility {
  eligible: boolean;
  /** Machine-readable reason a run was rejected; undefined when eligible. */
  reason?: 'no-trials' | 'no-agent-output' | 'all-incomplete-verdicts';
  /** Human-readable explanation for logs. */
  detail?: string;
}

/** True when a trial contains at least one assistant turn (the agent
 * actually responded). A turn-0 build — agent connected but produced
 * nothing — has only the synthetic user's turn. */
function hasAgentOutput(trial: TrialResult): boolean {
  return trial.transcript.turns.some((t) => t.role === 'assistant');
}

/** True when a trial produced at least one pass/fail verdict —
 * i.e. an evaluator could actually judge it. */
function hasComparableVerdict(trial: TrialResult): boolean {
  return trial.evalResults.some((e) => e.verdict !== 'incomplete');
}

/**
 * Decide whether a graduation run is substantive enough to save as a
 * baseline. A baseline becomes a regression floor, so saving one over a
 * run where the agent never produced anything (e.g. a misconfigured
 * GoCode endpoint 401ing every trial → zero-turn builds) silently pins
 * the floor to garbage and masks the real failure on the next run.
 *
 * Two independent failure modes are rejected:
 * - **no agent output**: no trial has an assistant turn. This is the
 *   turn-0 empty-build case, which the older all-unknown check missed
 *   because vacuous evaluators (bug-hit-rate, tool-call-verification)
 *   still emit `pass` on an empty transcript.
 * - **all-incomplete verdicts**: agent output may exist but no evaluator
 *   could judge any trial (infrastructure failure during grading).
 *
 * A run is eligible only when at least one trial both produced agent
 * output and a comparable verdict.
 */
export function assessBaselineEligibility(
  result: ScenarioResult,
): BaselineEligibility {
  if (result.trials.length === 0) {
    return {
      eligible: false,
      reason: 'no-trials',
      detail: 'no completed trials',
    };
  }

  if (!result.trials.some(hasAgentOutput)) {
    return {
      eligible: false,
      reason: 'no-agent-output',
      detail:
        'no trial produced an assistant turn (agent did no work — likely '
        + 'an environment/auth failure, not a measurable build)',
    };
  }

  if (!result.trials.some(hasComparableVerdict)) {
    return {
      eligible: false,
      reason: 'all-incomplete-verdicts',
      detail: 'all trials produced only incomplete verdicts',
    };
  }

  return { eligible: true };
}
