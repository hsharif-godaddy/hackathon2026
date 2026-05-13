import type { StabilityLevel } from '../scenarios/types.js';
import type { AggregatedResult, ScenarioResult } from '../runner/types.js';
import type {
  BaselineScores,
  RegressionEvalResult,
  RegressionResult,
  SkippedRegressionEvalResult,
} from './types.js';
import { exceedsThreshold, resolveThreshold, hasVersionMismatch } from './threshold.js';
import type { ThresholdConfig } from './threshold.js';

const STABILITY_GATE: Record<StabilityLevel, RegressionResult['gate']> = {
  low: 'warning',
  medium: 'error',
  high: 'critical',
};

export class RegressionComparator {
  compare(
    result: ScenarioResult,
    baseline: BaselineScores,
    config: ThresholdConfig,
  ): RegressionResult {
    const evaluators = this.buildEvalResults(result, baseline, config);
    const stabilityLevel =
      baseline.stabilityLevel ?? result.stabilityLevel;
    const gate = this.computeGate(evaluators, stabilityLevel);
    return {
      scenarioName: result.scenarioName,
      gate,
      stabilityLevel,
      evaluators,
    };
  }

  private buildEvalResults(
    result: ScenarioResult,
    baseline: BaselineScores,
    config: ThresholdConfig,
  ): RegressionEvalResult[] {
    return Object.entries(result.aggregated).map(([name, agg]) => {
      if (agg.regressionMode === 'score') {
        return this.buildScoreModeResult(name, agg, baseline, config);
      }
      return this.buildPassRateResult(name, agg, baseline, config);
    });
  }

  private buildPassRateResult(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores,
    config: ThresholdConfig,
  ): RegressionEvalResult {
    const versionMismatch = this.versionMismatch(name, agg, baseline);
    if (versionMismatch) return versionMismatch;

    if (agg.totalTrials === 0) {
      return { type: 'skipped', evaluator: name, skipReason: 'no-trial-data' };
    }

    const currentScore = agg.passingTrials / agg.totalTrials;

    const baselineEntry = baseline.scores[name];
    const baselineScore =
      baselineEntry && baselineEntry.totalTrials > 0
        ? baselineEntry.passingTrials / baselineEntry.totalTrials
        : NaN;

    const delta =
      Number.isNaN(currentScore) || Number.isNaN(baselineScore)
        ? NaN
        : currentScore - baselineScore;

    const threshold = resolveThreshold(name, config);

    // Pass-rate uses absolute difference: threshold of 0.1 means "flag when
    // pass-rate drops by more than 10 percentage points." This differs from
    // score-mode's percentage-relative detection (via exceedsThreshold()) because
    // pass-rates are bounded [0,1] where absolute thresholds are more intuitive.
    const exceeded =
      !Number.isNaN(delta) &&
      baselineScore - currentScore > threshold;

    return { type: 'compared', evaluator: name, currentScore, baselineScore, delta, exceeded };
  }

  private buildScoreModeResult(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores,
    config: ThresholdConfig,
  ): RegressionEvalResult {
    const versionMismatch = this.versionMismatch(name, agg, baseline);
    if (versionMismatch) return versionMismatch;

    const currentScore = agg.medianScore ?? NaN;

    if (Number.isNaN(currentScore)) {
      return { type: 'skipped', evaluator: name, skipReason: 'no-score-data' };
    }

    const baselineEntry = baseline.scores[name];
    const baselineScore = baselineEntry?.medianScore ?? NaN;

    const delta =
      Number.isNaN(currentScore) || Number.isNaN(baselineScore)
        ? NaN
        : currentScore - baselineScore;

    const threshold = resolveThreshold(name, config, baseline.regressionThresholds);

    const exceeded = exceedsThreshold(
      currentScore, baselineScore, threshold, agg.lowerIsBetter === true,
    );

    return { type: 'compared', evaluator: name, currentScore, baselineScore, delta, exceeded };
  }

  /**
   * Detects evaluator version changes between current run and baseline.
   * Returns a skip-result when versions differ (forces re-baselining).
   * NOTE: Adding evalVersion to an evaluator that previously lacked one
   * is a breaking change — the baseline must be regenerated.
   */
  private versionMismatch(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores,
  ): SkippedRegressionEvalResult | null {
    const currentEvalVersion = agg.evalVersion;
    const baselineEvalVersion = baseline.scores[name]?.evalVersion;
    if (!hasVersionMismatch(currentEvalVersion, baselineEvalVersion)) return null;

    return {
      type: 'skipped',
      evaluator: name,
      skipReason: 'evaluator-version-mismatch',
      currentEvalVersion,
      ...(baselineEvalVersion !== undefined && { baselineEvalVersion }),
    };
  }


  private computeGate(
    evaluators: RegressionEvalResult[],
    stabilityLevel: StabilityLevel,
  ): RegressionResult['gate'] {
    if (
      evaluators.length > 0 &&
      evaluators.every((e) => e.type === 'skipped')
    ) {
      return 'version-skipped';
    }
    if (!evaluators.some((e) => e.type === 'compared' && e.exceeded)) return 'pass';
    return STABILITY_GATE[stabilityLevel];
  }

}
