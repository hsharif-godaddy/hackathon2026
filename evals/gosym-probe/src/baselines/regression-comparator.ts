import type { StabilityLevel } from '../scenarios/types.js';
import type { AggregatedResult, ScenarioResult } from '../runner/types.js';
import type {
  BaselineScores,
  RegressionEvalResult,
  RegressionResult,
  SkippedRegressionEvalResult,
} from './types.js';

interface RegressionConfig {
  thresholds: Record<string, number>;
  defaultThreshold: number;
}

const STABILITY_GATE: Record<StabilityLevel, RegressionResult['gate']> = {
  low: 'warning',
  medium: 'error',
  high: 'critical',
};

export class RegressionComparator {
  compare(
    result: ScenarioResult,
    baseline: BaselineScores | null,
    config: RegressionConfig,
  ): RegressionResult {
    const evaluators = this.buildEvalResults(result, baseline, config);
    const hasBaseline = baseline !== null;
    const stabilityLevel =
      baseline?.stabilityLevel ?? result.stabilityLevel;
    const gate = this.computeGate(
      result.category,
      hasBaseline,
      evaluators,
      stabilityLevel,
    );
    return {
      scenarioName: result.scenarioName,
      category: result.category,
      hasBaseline,
      gate,
      stabilityLevel,
      evaluators,
    };
  }

  private buildEvalResults(
    result: ScenarioResult,
    baseline: BaselineScores | null,
    config: RegressionConfig,
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
    baseline: BaselineScores | null,
    config: RegressionConfig,
  ): RegressionEvalResult {
    const versionMismatch = this.versionMismatch(name, agg, baseline);
    if (versionMismatch) return versionMismatch;

    const currentScore =
      agg.totalTrials > 0
        ? agg.passingTrials / agg.totalTrials
        : NaN;

    const baselineEntry = baseline?.scores[name];
    const baselineScore =
      baselineEntry && baselineEntry.totalTrials > 0
        ? baselineEntry.passingTrials / baselineEntry.totalTrials
        : NaN;

    const delta =
      Number.isNaN(currentScore) || Number.isNaN(baselineScore)
        ? NaN
        : currentScore - baselineScore;

    const threshold =
      config.thresholds[name] ?? config.defaultThreshold;

    const exceeded =
      !Number.isNaN(delta) &&
      baselineScore - currentScore > threshold;

    return { type: 'compared', evaluator: name, currentScore, baselineScore, delta, exceeded };
  }

  private buildScoreModeResult(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores | null,
    config: RegressionConfig,
  ): RegressionEvalResult {
    const versionMismatch = this.versionMismatch(name, agg, baseline);
    if (versionMismatch) return versionMismatch;

    const currentScore = agg.medianScore ?? NaN;

    const baselineEntry = baseline?.scores[name];
    const baselineScore = baselineEntry?.medianScore ?? NaN;

    const delta =
      Number.isNaN(currentScore) || Number.isNaN(baselineScore)
        ? NaN
        : currentScore - baselineScore;

    // Threshold: baseline JSON overrides config map overrides default
    const threshold =
      baseline?.regressionThresholds?.[name]
      ?? config.thresholds[name]
      ?? config.defaultThreshold;

    // Relative delta: for higher-is-better evaluators, regression = score drop.
    // For lowerIsBetter evaluators (e.g. token counts, cost), regression =
    // score increase. We achieve this by checking opposite numerators.
    // baselineScore > 0 guards against division by zero.
    // Note: we read lowerIsBetter from the live run's AggregatedResult (not
    // baselineEntry) because the current evaluator config is the source of truth.
    const exceededNumerator = agg.lowerIsBetter === true
      ? currentScore - baselineScore   // regression when score increased
      : baselineScore - currentScore;  // regression when score dropped

    const exceeded =
      !Number.isNaN(delta) && (
        agg.lowerIsBetter === true && baselineScore === 0
          ? currentScore > 0
          : baselineScore > 0 && exceededNumerator / baselineScore > threshold
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
    baseline: BaselineScores | null,
  ): SkippedRegressionEvalResult | null {
    const currentEvalVersion = agg.evalVersion;
    const baselineEvalVersion = baseline?.scores[name]?.evalVersion;
    if (baseline === null) return null;
    if (currentEvalVersion === undefined && baselineEvalVersion === undefined) return null;
    if (currentEvalVersion === baselineEvalVersion) {
      return null;
    }

    return {
      type: 'skipped',
      evaluator: name,
      skipReason: 'evaluator-version-mismatch',
      currentEvalVersion,
      ...(baselineEvalVersion !== undefined && { baselineEvalVersion }),
    };
  }


  private computeGate(
    category: 'capability' | 'regression',
    hasBaseline: boolean,
    evaluators: RegressionEvalResult[],
    stabilityLevel: StabilityLevel,
  ): RegressionResult['gate'] {
    if (category === 'capability') return 'informational';
    if (!hasBaseline) return 'missing-baseline';
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
