import type { EvalResult } from '../evaluators/evaluator.js';
import type { TrialResult } from '../runner/types.js';

/**
 * Returns true when an eval result should be included in trial score
 * aggregation. Excludes results where the evaluator itself failed or
 * where the verdict is 'unknown' (insufficient data to judge).
 */
export function isValidTrialScore(result: Pick<EvalResult, 'evaluatorFailed' | 'verdict'>): boolean {
  if (result.evaluatorFailed || result.verdict === 'unknown') return false;
  return true;
}

/**
 * Extracts per-trial scores for a single named evaluator from trial results.
 * Skips trials where the evaluator is absent, failed, or returned 'unknown'.
 */
export function extractTrialScoresForEvaluator(name: string, trials: TrialResult[]): number[] {
  const scores: number[] = [];
  for (const trial of trials) {
    const evalResult = trial.evalResults.find((e) => e.evaluator === name);
    if (!evalResult || !isValidTrialScore(evalResult)) continue;
    scores.push(evalResult.score);
  }
  return scores;
}

/**
 * Builds a map from evaluator name to per-trial scores across all trials.
 * Skips results where the evaluator failed or returned 'unknown'.
 */
export function extractAllTrialScores(trials: TrialResult[]): Map<string, number[]> {
  const scoresByEvaluator = new Map<string, number[]>();
  for (const trial of trials) {
    for (const result of trial.evalResults) {
      if (!isValidTrialScore(result)) continue;
      let scores = scoresByEvaluator.get(result.evaluator);
      if (!scores) {
        scores = [];
        scoresByEvaluator.set(result.evaluator, scores);
      }
      scores.push(result.score);
    }
  }
  return scoresByEvaluator;
}
