import type { EvalResult } from '../evaluators/evaluator.js';
import type { ScenarioResult } from '../runner/types.js';
import {
  findSignalDisagreements,
  comparable,
  STATIC_EVALUATOR_NAME,
  JUDGE_EVALUATOR_NAME,
} from './signal-disagreement.js';

export interface EvaluatorStability {
  evaluator: string;
  /** Trials where this evaluator produced a verdict-mode result. */
  trials: number;
  /** Count of distinct verdicts seen across those trials. */
  distinctVerdicts: number;
  /** distinctVerdicts/trials, in [0,1]. 1/N = perfectly stable (one
   * verdict across all trials); higher = noisier grader. */
  flipRate: number;
  /** The verdicts seen, for the report. */
  verdicts: EvalResult['verdict'][];
}

export interface GraderStability {
  perEvaluator: EvaluatorStability[];
  /** Trials where BOTH the static + judge evaluators produced a
   * comparable verdict (the denominator for disagreementRate). */
  comparableTrials: number;
  disagreements: number;
  /** disagreements/comparableTrials, in [0,1]; 0 when no comparable
   * trials. */
  disagreementRate: number;
}

/**
 * 'directional' (score-mode) evaluators have no pass/fail verdict, so a
 * flip-rate over them is meaningless — exclude them. Note 'incomplete' is
 * deliberately NOT excluded: a grader that emits pass on some trials and
 * incomplete on others is genuinely unstable, so 'incomplete' counts toward
 * the per-evaluator flip-rate (unlike the disagreement rate, which compares
 * only pass/fail via comparable()).
 */
function isVerdictMode(verdict: EvalResult['verdict']): boolean {
  return verdict !== 'directional';
}

/**
 * Quantify GRADER stability across the trials of a multi-trial run —
 * the meta-metric of "how much do we trust the grader itself", distinct
 * from how the agent-under-test scored. Two signals:
 *
 * - per-evaluator verdict flip-rate: distinct verdicts / trials. A
 *   deterministic evaluator should hold one verdict (low flip-rate)
 *   where the build is stable; an LLM judge flipping on identical-ish
 *   builds is grader noise. (Note: each trial is a different build, so
 *   some variation is the agent, not the grader — read alongside the
 *   per-trial table, not in isolation.)
 * - static-vs-judge disagreement rate: how often the static evaluator
 *   and the narrow judge — which share one checklist — diverge.
 *
 * Pure/deterministic; safe to call with any trial count (caller gates
 * rendering on trials > 1).
 */
export function computeGraderStability(
  results: ScenarioResult[],
  staticName: string = STATIC_EVALUATOR_NAME,
  judgeName: string = JUDGE_EVALUATOR_NAME,
): GraderStability {
  const byEvaluator = new Map<string, EvalResult['verdict'][]>();
  for (const result of results) {
    for (const trial of result.trials) {
      for (const r of trial.evalResults) {
        if (!isVerdictMode(r.verdict)) continue;
        const list = byEvaluator.get(r.evaluator) ?? [];
        list.push(r.verdict);
        byEvaluator.set(r.evaluator, list);
      }
    }
  }

  const perEvaluator: EvaluatorStability[] = [...byEvaluator.entries()]
    .map(([evaluator, verdicts]) => {
      const distinct = new Set(verdicts).size;
      return {
        evaluator,
        trials: verdicts.length,
        distinctVerdicts: distinct,
        flipRate: verdicts.length > 0 ? distinct / verdicts.length : 0,
        verdicts,
      };
    })
    .sort((a, b) => a.evaluator.localeCompare(b.evaluator));

  const disagreements = findSignalDisagreements(results, staticName, judgeName);
  const comparableTrials = countComparableTrials(results, staticName, judgeName);

  return {
    perEvaluator,
    comparableTrials,
    disagreements: disagreements.length,
    disagreementRate:
      comparableTrials > 0 ? disagreements.length / comparableTrials : 0,
  };
}

function countComparableTrials(
  results: ScenarioResult[],
  staticName: string,
  judgeName: string,
): number {
  let n = 0;
  for (const result of results) {
    for (const trial of result.trials) {
      const s = trial.evalResults.find((r) => r.evaluator === staticName);
      const j = trial.evalResults.find((r) => r.evaluator === judgeName);
      if (s && j && comparable(s.verdict) && comparable(j.verdict)) n++;
    }
  }
  return n;
}
