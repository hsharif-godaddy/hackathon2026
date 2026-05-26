import type { AggregatedResult, TrialResult } from '../runner/types.js';
import type { BaselineScores, RegressionResult } from './types.js';
import { exceedsThreshold, resolveThreshold, hasVersionMismatch } from './threshold.js';
import type { ThresholdConfig } from './threshold.js';

/**
 * Enriches score-mode evaluators in a ScenarioResult with passAtK/passToTheK
 * derived from per-trial comparison against a baseline aggregate score.
 *
 * Returns a NEW aggregated record. The input ScenarioResult is not mutated.
 * Each evaluator is processed independently.
 *
 * Score-mode evaluators are left unchanged (passAtK remains undefined) when:
 * - The baseline has no entry for the evaluator.
 * - The baseline aggregateScore is undefined or non-finite.
 * - evalVersion differs between current run and baseline.
 * - All trials have verdict 'unknown' (no valid comparison data).
 * - The trials array is empty (result.trials.length === 0).
 * - The evaluator is absent from every trial (no trial contains a matching evalResult).
 *
 * Pass-rate evaluators are copied unchanged.
 */
/**
 * Builds a map of evaluator name → TOST nonInferiorityProven for evaluators
 * where TOST ran (statistical metadata present on the compared result).
 * Evaluators that went through the threshold fallback path are excluded so
 * they continue to use threshold-based enrichment below.
 */
function buildTostResultMap(regressionResult: RegressionResult | undefined): Map<string, boolean> {
  if (!regressionResult) return new Map();
  const map = new Map<string, boolean>();
  for (const evalResult of regressionResult.evaluators) {
    if (evalResult.type === 'compared' && evalResult.statistical !== undefined) {
      map.set(evalResult.evaluator, !evalResult.exceeded);
    }
  }
  return map;
}

export function enrichScoreModePassRates(
  result: { trials: TrialResult[]; aggregated: Record<string, AggregatedResult> },
  baseline: BaselineScores,
  config: ThresholdConfig,
  regressionResult?: RegressionResult,
): { aggregated: Record<string, AggregatedResult>; trials: TrialResult[] } {
  const enriched: Record<string, AggregatedResult> = {};
  const verdictUpdates = new Map<number, Map<string, { verdict: 'pass' | 'fail'; baselineComparison: string }>>();

  const tostResults = buildTostResultMap(regressionResult);

  for (const [name, agg] of Object.entries(result.aggregated)) {
    if (agg.regressionMode !== 'score') {
      enriched[name] = agg;
      continue;
    }

    // TOST path: TOST ran for this evaluator — use its distribution-level result.
    // Per-trial verdicts stay 'observed'; gating is expressed through passAtK/passToTheK.
    const tostNonInferior = tostResults.get(name);
    if (tostNonInferior !== undefined) {
      const validTrials = result.trials.filter((t) => {
        const er = t.evalResults.find((e) => e.evaluator === name);
        return er !== undefined && er.verdict !== 'unknown';
      }).length;
      enriched[name] = {
        ...agg,
        passAtK: tostNonInferior,
        passToTheK: tostNonInferior,
        baselinePassingTrials: tostNonInferior ? validTrials : 0,
      };
      continue;
    }

    const baselineEntry = baseline.scores[name];
    const baselineAggregate = baselineEntry?.aggregateScore;

    if (baselineAggregate === undefined || !Number.isFinite(baselineAggregate)) {
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
      const trialVerdict: 'pass' | 'fail' = (
        Number.isFinite(evalResult.score) &&
        !exceedsThreshold(evalResult.score, baselineAggregate, threshold, lowerIsBetter)
      ) ? 'pass' : 'fail';

      const baselineComparison = `${name}: ${evalResult.score} vs baseline ${baselineAggregate} (threshold ${(threshold * 100).toFixed(0)}%) → ${trialVerdict}`;

      if (!verdictUpdates.has(trial.trialIndex)) {
        verdictUpdates.set(trial.trialIndex, new Map());
      }
      verdictUpdates.get(trial.trialIndex)!.set(name, { verdict: trialVerdict, baselineComparison });

      if (trialVerdict === 'pass') passingTrials++;
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

  const updatedTrials: TrialResult[] = result.trials.map((trial) => {
    const updates = verdictUpdates.get(trial.trialIndex);
    if (!updates) return trial;
    return {
      ...trial,
      evalResults: trial.evalResults.map((r) => {
        const entry = updates.get(r.evaluator);
        if (!entry) return r;
        return { ...r, verdict: entry.verdict, baselineComparison: entry.baselineComparison };
      }),
    };
  });

  return { aggregated: enriched, trials: updatedTrials };
}
