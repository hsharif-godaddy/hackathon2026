import type { StabilityLevel } from '../scenarios/types.js';
import type { AggregatedResult, ScenarioResult } from '../runner/types.js';
import type {
  BaselineScores,
  RegressionEvalResult,
  RegressionResult,
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

    return { evaluator: name, currentScore, baselineScore, delta, exceeded };
  }

  private buildScoreModeResult(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores | null,
    config: RegressionConfig,
  ): RegressionEvalResult {
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

    // Relative delta: (baseline - current) / baseline > threshold.
    // baselineScore > 0 guards against division by zero. LatencyEvaluator
    // cannot produce score: 0 for an observed verdict (2^(-x) > 0 always),
    // but a score-mode evaluator with a zero baseline will silently produce
    // exceeded: false.
    const exceeded =
      !Number.isNaN(delta) &&
      baselineScore > 0 &&
      (baselineScore - currentScore) / baselineScore > threshold;

    return { evaluator: name, currentScore, baselineScore, delta, exceeded };
  }

  private computeGate(
    category: 'capability' | 'regression',
    hasBaseline: boolean,
    evaluators: RegressionEvalResult[],
    stabilityLevel: StabilityLevel,
  ): RegressionResult['gate'] {
    if (category === 'capability') return 'informational';
    if (!hasBaseline) return 'missing-baseline';
    if (!evaluators.some((e) => e.exceeded)) return 'pass';
    return STABILITY_GATE[stabilityLevel];
  }
}
