import type { AggregatedResult, TrialResult } from '../runner/types.js';
import type { BaselineScores } from './types.js';
import { exceedsThreshold, resolveThreshold, hasVersionMismatch } from './threshold.js';
import type { ThresholdConfig } from './threshold.js';

/**
 * Enriches score-mode evaluators in a ScenarioResult with passAtK/passToTheK
 * derived from per-trial comparison against a baseline median.
 *
 * Returns a NEW aggregated record. The input ScenarioResult is not mutated.
 * Each evaluator is processed independently.
 *
 * Score-mode evaluators are left unchanged (passAtK remains undefined) when:
 * - The baseline has no entry for the evaluator.
 * - The baseline medianScore is undefined or non-finite.
 * - evalVersion differs between current run and baseline.
 * - All trials have verdict 'unknown' (no valid comparison data).
 * - The trials array is empty (result.trials.length === 0).
 * - The evaluator is absent from every trial (no trial contains a matching evalResult).
 *
 * Pass-rate evaluators are copied unchanged.
 */
export function enrichScoreModePassRates(
  result: { trials: TrialResult[]; aggregated: Record<string, AggregatedResult> },
  baseline: BaselineScores,
  config: ThresholdConfig,
): Record<string, AggregatedResult> {
  const enriched: Record<string, AggregatedResult> = {};

  for (const [name, agg] of Object.entries(result.aggregated)) {
    if (agg.regressionMode !== 'score') {
      enriched[name] = agg;
      continue;
    }

    const baselineEntry = baseline.scores[name];
    const baselineMedian = baselineEntry?.medianScore;

    if (baselineMedian === undefined || !Number.isFinite(baselineMedian)) {
      enriched[name] = agg;
      continue;
    }

    if (hasVersionMismatch(agg.evalVersion, baselineEntry?.evalVersion)) {
      enriched[name] = agg;
      continue;
    }

    const threshold = resolveThreshold(name, config, baseline.regressionThresholds);

    if (!Number.isFinite(threshold)) {
      enriched[name] = agg;
      continue;
    }

    const lowerIsBetter = agg.lowerIsBetter === true;

    if (result.trials.length === 0) {
      enriched[name] = agg;
      continue;
    }

    let passingTrials = 0;
    let validTrials = 0;
    let foundAny = false;

    for (const trial of result.trials) {
      const evalResult = trial.evalResults.find((e) => e.evaluator === name);
      if (evalResult === undefined) continue;
      foundAny = true;
      if (evalResult.verdict === 'unknown') continue;
      validTrials++;
      if (
        Number.isFinite(evalResult.score) &&
        !exceedsThreshold(evalResult.score, baselineMedian, threshold, lowerIsBetter)
      ) {
        passingTrials++;
      }
    }

    // Evaluator not present in any trial: no data to compare, skip enrichment.
    if (!foundAny) {
      enriched[name] = agg;
      continue;
    }

    // All present trials had unknown verdict: no valid comparison, skip enrichment.
    if (validTrials === 0) {
      enriched[name] = agg;
      continue;
    }

    enriched[name] = {
      ...agg,
      passAtK: passingTrials > 0,
      passToTheK: validTrials > 0 && passingTrials === validTrials,
      baselinePassingTrials: passingTrials,
    };
  }

  return enriched;
}
