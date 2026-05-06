import { SuiteRunner } from '../runner/suite-runner.js';
import {
  STABILITY_TRIALS,
} from '../scenarios/types.js';
import type {
  Scenario,
  StabilityLevel,
} from '../scenarios/types.js';
import type { Config } from '../../config/environments/types.js';
import type { AgentClient } from '../clients/agent-client.js';
import type { SyntheticUserAgent } from '../runner/synthetic-user.js';
import type { DOMCapture } from '../clients/dom-capture.js';
import type {
  AggregatedResult,
  ScenarioResult,
} from '../runner/types.js';
import type { EvalStore } from '../store/eval-store.js';
import type { ThresholdOptions } from './baseline-store.js';

interface BaselineStore {
  save(
    runId: string,
    result: ScenarioResult,
    options?: ThresholdOptions,
  ): Promise<void>;
}

export interface GraduationRunnerOptions {
  scenario: Scenario;
  config: Config;
  makeAgentClient?: () => Promise<AgentClient>;
  syntheticUser?: SyntheticUserAgent;
  domCapture?: DOMCapture;
  baselineStore: BaselineStore;
  stabilityLevelOverride?: StabilityLevel;
  concurrencyOverride?: number;
  maxTurnsOverride?: number;
  store?: EvalStore;
}

export interface GraduationResult {
  scenarioName: string;
  promoted: boolean;
  stabilityLevel: StabilityLevel;
  stabilityTrials: number;
  /**
   * Per-evaluator pass rate for pass-rate evaluators only.
   * Score-mode evaluators (regressionMode === 'score') are excluded.
   * NaN when totalTrials === 0.
   */
  passRates: Record<string, number>;
  minPassRate: number;
  passRateThreshold: number;
}

export class GraduationRunner {
  constructor(private readonly options: GraduationRunnerOptions) {}

  async run(runId: string): Promise<GraduationResult> {
    const {
      scenario,
      config,
      makeAgentClient,
      syntheticUser,
      domCapture,
      baselineStore,
    } = this.options;

    const stabilityLevel =
      this.options.stabilityLevelOverride
      ?? scenario.stabilityLevel
      ?? 'medium';
    const threshold =
      config.regression.graduationPassRateThreshold ?? 0.9;
    const totalTrials = STABILITY_TRIALS[stabilityLevel];

    const executionModeOverride =
      stabilityLevel !== 'low' ? 'parallel' as const : undefined;

    const runner = new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser,
      domCapture,
      trialsOverride: totalTrials,
      concurrencyOverride: this.options.concurrencyOverride,
      maxTurnsOverride: this.options.maxTurnsOverride,
      executionModeOverride,
    });

    const [result] = await runner.run();
    result.stabilityLevel = stabilityLevel;

    const passRates = computePassRates(result.aggregated);
    const validRates = Object.values(passRates).filter(
      (r) => !Number.isNaN(r),
    );
    const minPassRate =
      validRates.length > 0 ? Math.min(...validRates) : NaN;
    // minPassRate is NaN when all evaluators are score-mode (computePassRates
    // skips them), which means this scenario cannot graduate. promoted: false.
    const promoted =
      !Number.isNaN(minPassRate) && minPassRate >= threshold;

    if (this.options.store) {
      await this.options.store.save(
        runId,
        [result],
        [scenario],
        config,
        undefined,
        this.options.concurrencyOverride,
        this.options.maxTurnsOverride,
        'graduation',
      );
    }

    if (promoted) {
      await baselineStore.save(runId, result, {
        defaultThreshold:
          config.regression.defaultThreshold,
      });
    }

    return {
      scenarioName: scenario.name,
      promoted,
      stabilityLevel,
      stabilityTrials: totalTrials,
      passRates,
      minPassRate,
      passRateThreshold: threshold,
    };
  }
}

/**
 * Computes pass rates for pass-rate evaluators only.
 *
 * Score-mode evaluators (`regressionMode === 'score'`) are excluded because
 * graduation is defined in terms of pass-rate consistency across trials.
 *
 * Known limitation: a scenario whose evaluators are exclusively score-mode
 * will produce an empty result map, causing `minPassRate` to be NaN and
 * `promoted` to be false. Designing a score-mode graduation gate (e.g. an
 * absolute score threshold or variance bound) is a separate feature.
 */
function computePassRates(
  aggregated: Record<string, AggregatedResult>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [name, agg] of Object.entries(aggregated)) {
    if (agg.regressionMode === 'score') continue;
    result[name] =
      agg.totalTrials > 0
        ? agg.passingTrials / agg.totalTrials
        : NaN;
  }
  return result;
}
