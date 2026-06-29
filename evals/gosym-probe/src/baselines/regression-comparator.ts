import type { StabilityLevel } from '../scenarios/types.js';
import type { AggregatedResult, ScenarioResult, TrialResult } from '../runner/types.js';
import type {
  BaselineScores,
  ComparedRegressionEvalResult,
  RegressionEvalResult,
  RegressionResult,
  SkippedRegressionEvalResult,
  StatisticalMetadata,
} from './types.js';
import { exceedsThreshold, resolveThreshold, hasVersionMismatch } from './threshold.js';
import {
  computeMargin,
  tostProportions,
  tostPermutation,
  computePower,
} from './statistical-tests.js';
import { extractTrialScoresForEvaluator } from './trial-scores.js';
import type { StatisticalRegressionConfig } from '../../config/environments/types.js';
import { REGRESSION_DEFAULTS } from '../../config/environments/defaults.js';

function isBinaryScores(scores: readonly number[]): boolean {
  return scores.every((s) => s === 0 || s === 1);
}

export class RegressionComparator {
  compare(
    result: ScenarioResult,
    baseline: BaselineScores,
    config: StatisticalRegressionConfig,
  ): RegressionResult {
    const evaluators = this.buildEvalResults(result, baseline, config);
    const stabilityLevel = baseline.stabilityLevel ?? result.stabilityLevel;
    const gate = this.computeGate(evaluators);
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
    config: StatisticalRegressionConfig,
  ): RegressionEvalResult[] {
    return Object.entries(result.aggregated).map(([name, agg]) => {
      if (agg.regressionMode === 'score') {
        return this.buildScoreModeResult(name, agg, baseline, config, result.trials);
      }
      return this.buildPassRateResult(name, agg, baseline, config, result.trials);
    });
  }

  private buildPassRateResult(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores,
    config: StatisticalRegressionConfig,
    trials: TrialResult[],
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

    const baselineTrialScores = baselineEntry?.trialScores;
    if (baselineTrialScores && baselineTrialScores.length > 0) {
      const currentTrialScores = extractTrialScoresForEvaluator(name, trials);
      if (currentTrialScores.length > 0) {
        const k = this.resolveK(name, config);
        const { margin, floored } = computeMargin(baselineTrialScores, k, config.minMarginFraction);

        // margin === 0 only when both k*SD and the fractional floor are 0, i.e. a
        // constant-zero baseline (mean=0 AND SD=0). The relative floor cannot lift a
        // zero mean, so such baselines route to a strict uniform-match check.
        if (margin === 0) {
          const baselineConstant = baselineTrialScores[0];
          const allMatch = currentTrialScores.every((s) => s === baselineConstant);
          return {
            type: 'compared',
            evaluator: name,
            currentScore,
            baselineScore,
            delta,
            exceeded: !allMatch,
            statistical: {
              method: 'uniform-match',
              margin: 0,
              baselineSD: 0,
              k,
              n: { baseline: baselineTrialScores.length, current: currentTrialScores.length },
              confidenceInterval: { lower: 0, upper: 0 },
              nonInferiorityProven: allMatch,
            },
          };
        }

        const allBinary = isBinaryScores(baselineTrialScores) && isBinaryScores(currentTrialScores);
        const tostResult = allBinary
          ? tostProportions(baselineTrialScores, currentTrialScores, {
              alpha: config.alpha,
              margin,
              seed: config.seed,
            })
          : tostPermutation(baselineTrialScores, currentTrialScores, {
              alpha: config.alpha,
              margin,
              seed: config.seed,
            });
        const statistical: StatisticalMetadata = {
          method: tostResult.method,
          margin: tostResult.margin,
          baselineSD: tostResult.baselineSD,
          k,
          n: { baseline: baselineTrialScores.length, current: currentTrialScores.length },
          confidenceInterval: tostResult.confidenceInterval,
          nonInferiorityProven: tostResult.nonInferiorityProven,
          ...(floored && { marginFloored: true }),
          power: this.buildPower(baselineTrialScores, currentTrialScores, config, false),
        };
        return {
          type: 'compared',
          evaluator: name,
          currentScore,
          baselineScore,
          delta,
          exceeded: !tostResult.nonInferiorityProven,
          statistical,
        };
      }
    }

    // Fallback: pass-rate baselines predate per-baseline threshold overrides,
    // so only config-level thresholds apply here (unlike score-mode below).
    const threshold = resolveThreshold(name, config.fallbackThresholds);
    const exceeded =
      !Number.isNaN(delta) && baselineScore - currentScore > threshold;

    return { type: 'compared', evaluator: name, currentScore, baselineScore, delta, exceeded };
  }

  private buildScoreModeResult(
    name: string,
    agg: AggregatedResult,
    baseline: BaselineScores,
    config: StatisticalRegressionConfig,
    trials: TrialResult[],
  ): RegressionEvalResult {
    const versionMismatch = this.versionMismatch(name, agg, baseline);
    if (versionMismatch) return versionMismatch;

    const currentScore = agg.aggregateScore ?? NaN;

    if (Number.isNaN(currentScore)) {
      return { type: 'skipped', evaluator: name, skipReason: 'no-score-data' };
    }

    const baselineEntry = baseline.scores[name];
    const baselineScore = baselineEntry?.aggregateScore ?? NaN;

    const delta =
      Number.isNaN(currentScore) || Number.isNaN(baselineScore)
        ? NaN
        : currentScore - baselineScore;

    const baselineTrialScores = baselineEntry?.trialScores;
    if (baselineTrialScores && baselineTrialScores.length > 0) {
      const currentTrialScores = extractTrialScoresForEvaluator(name, trials);
      if (currentTrialScores.length > 0) {
        const k = this.resolveK(name, config);
        const { margin, floored } = computeMargin(baselineTrialScores, k, config.minMarginFraction);

        // margin === 0 only when both k*SD and the fractional floor are 0, i.e. a
        // constant-zero baseline (mean=0 AND SD=0). The relative floor cannot lift a
        // zero mean, so such baselines route to a strict uniform-match check.
        if (margin === 0) {
          const baselineConstant = baselineTrialScores[0];
          const allMatch = currentTrialScores.every((s) => s === baselineConstant);
          return {
            type: 'compared',
            evaluator: name,
            currentScore,
            baselineScore,
            delta,
            exceeded: !allMatch,
            statistical: {
              method: 'uniform-match',
              margin: 0,
              baselineSD: 0,
              k,
              n: { baseline: baselineTrialScores.length, current: currentTrialScores.length },
              confidenceInterval: { lower: 0, upper: 0 },
              nonInferiorityProven: allMatch,
            },
          };
        }

        const tostResult = tostPermutation(baselineTrialScores, currentTrialScores, {
          alpha: config.alpha,
          margin,
          lowerIsBetter: agg.lowerIsBetter === true,
          seed: config.seed,
        });
        const statistical: StatisticalMetadata = {
          method: tostResult.method,
          margin: tostResult.margin,
          baselineSD: tostResult.baselineSD,
          k,
          n: { baseline: baselineTrialScores.length, current: currentTrialScores.length },
          confidenceInterval: tostResult.confidenceInterval,
          nonInferiorityProven: tostResult.nonInferiorityProven,
          ...(floored && { marginFloored: true }),
          power: this.buildPower(
            baselineTrialScores,
            currentTrialScores,
            config,
            agg.lowerIsBetter === true,
          ),
        };
        return {
          type: 'compared',
          evaluator: name,
          currentScore,
          baselineScore,
          delta,
          exceeded: !tostResult.nonInferiorityProven,
          statistical,
        };
      }
    }

    // Fallback: threshold-based comparison when no trial scores available.
    const threshold = resolveThreshold(name, config.fallbackThresholds, baseline.regressionThresholds);
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

  /** Resolves the k multiplier for a named evaluator, applying per-evaluator overrides. */
  private resolveK(name: string, config: StatisticalRegressionConfig): number {
    return config.evaluatorKOverrides?.[name] ?? config.k;
  }

  /**
   * Builds the report-only power summary attached to StatisticalMetadata.
   * Does not influence the gate — it lets the reporter distinguish an
   * underpowered TOST result from a genuine regression. `lowerIsBetter` is
   * forwarded so a regression reads as a negative cohensD on lower-is-better
   * metrics (token-usage, cost, latency), matching the TOST orientation.
   */
  private buildPower(
    baselineTrialScores: readonly number[],
    currentTrialScores: readonly number[],
    config: StatisticalRegressionConfig,
    lowerIsBetter: boolean,
  ): StatisticalMetadata['power'] {
    const result = computePower(baselineTrialScores, currentTrialScores, {
      alpha: config.alpha,
      targetPower: config.targetPower ?? REGRESSION_DEFAULTS.targetPower,
      lowerIsBetter,
    });
    return {
      cohensD: result.cohensD,
      achievedPower: result.achievedPower,
      mdeScore: result.mdeScore,
      targetPower: result.targetPower,
    };
  }

  private computeGate(evaluators: RegressionEvalResult[]): RegressionResult['gate'] {
    if (evaluators.length > 0 && evaluators.every((e) => e.type === 'skipped')) {
      const hasVersionMismatch = evaluators.some(
        (e) => e.type === 'skipped' && e.skipReason === 'evaluator-version-mismatch',
      );
      if (hasVersionMismatch) return 'fail';
      return 'warning';
    }

    const compared = evaluators.filter(
      (e): e is ComparedRegressionEvalResult => e.type === 'compared',
    );

    if (compared.some((e) => e.exceeded && e.statistical !== undefined)) {
      // Statistical evidence of regression: TOST failed to prove non-inferiority.
      return 'fail';
    }

    if (compared.some((e) => e.exceeded && e.statistical === undefined)) {
      // Fallback threshold breach only — no statistical backing, treat as warning.
      return 'warning';
    }

    return 'pass';
  }
}
