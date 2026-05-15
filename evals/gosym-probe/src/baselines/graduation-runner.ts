import { SuiteRunner } from '../runner/suite-runner.js';
import {
  resolveStabilityLevel,
  STABILITY_TRIALS,
} from '../scenarios/types.js';
import type {
  Scenario,
  StabilityLevel,
} from '../scenarios/types.js';
import type { ResolvedConfig } from '../../config/index.js';
import type { AgentClient } from '../clients/agent-client.js';
import type { SyntheticUserAgent } from '../runner/synthetic-user.js';
import type { SiteCapture } from '../clients/dom-capture.js';
import type { ScenarioResult, TrialResult } from '../runner/types.js';
import type { EvalStore } from '../store/eval-store.js';
import type { ThresholdOptions } from './baseline-store.js';

interface BaselineStore {
  save(
    runId: string,
    result: ScenarioResult,
    options?: ThresholdOptions,
  ): Promise<void>;
}

interface GraduationRunnerOptionsBase {
  scenario: Scenario;
  config: ResolvedConfig;
  makeAgentClient?: () => Promise<AgentClient>;
  syntheticUser?: SyntheticUserAgent;
  siteCapture?: SiteCapture;
  baselineStore: BaselineStore;
  stabilityLevelOverride?: StabilityLevel;
  /**
   * Trial-level concurrency cap passed to the inner SuiteRunner.
   * Clamped to config.eval.maxConcurrency.
   */
  trialConcurrency?: number;
  maxTurnsOverride?: number;
  onTrialEvaluated?: (scenarioName: string, trial: TrialResult) => void;
  log?: (message: string, ...args: unknown[]) => void;
}

export type GraduationRunnerOptions = GraduationRunnerOptionsBase & (
  | { skipFinalize?: false; dirName?: string; store?: EvalStore }
  | { skipFinalize: true; dirName: string; store: EvalStore }
);

/**
 * Result of a graduation run. The baseline is saved after N stability trials
 * complete unless all trials produced only unknown verdicts (indicating
 * infrastructure failure rather than meaningful eval data).
 */
interface GraduationResultBase {
  scenarioName: string;
  stabilityLevel: StabilityLevel;
  stabilityTrials: number;
  baselineSaved: boolean;
}

export interface DeferredGraduationResult extends GraduationResultBase {
  scenarioResult: ScenarioResult;
}

export interface StandaloneGraduationResult extends GraduationResultBase {
  scenarioResult?: undefined;
}

export type GraduationResult = DeferredGraduationResult | StandaloneGraduationResult;

export function isDeferredResult(r: GraduationResult): r is DeferredGraduationResult {
  return r.scenarioResult !== undefined;
}

export class GraduationRunner {
  constructor(private readonly options: GraduationRunnerOptions) {
    if (options.skipFinalize === true && !options.dirName) {
      throw new Error('skipFinalize requires dirName to be provided');
    }
  }

  async run(runId: string): Promise<GraduationResult> {
    const {
      scenario,
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      baselineStore,
      store,
    } = this.options;
    const log = this.options.log ?? console.warn;

    const stabilityLevel = resolveStabilityLevel(
      this.options.stabilityLevelOverride,
      scenario,
    );
    const totalTrials = STABILITY_TRIALS[stabilityLevel];

    const dirName = this.options.dirName
      ?? (store
        ? await store.initRun(runId, [scenario], config, {
          concurrencyOverride: this.options.trialConcurrency,
          maxTurnsOverride: this.options.maxTurnsOverride,
          kind: 'graduation',
        })
        : undefined);

    const runner = new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      trialsOverride: totalTrials,
      trialConcurrency: this.options.trialConcurrency,
      maxTurnsOverride: this.options.maxTurnsOverride,
      onTrialEvaluated: this.options.onTrialEvaluated,
      ...(store && dirName && {
        getTrialOutputDir: (scenarioName, trialIndex) =>
          store.ensureTrialDir(dirName, scenarioName, trialIndex),
        writePartialTrial: (scenarioName, trialIndex, transcript) =>
          store.writePartialTrial(dirName, scenarioName, trialIndex, transcript),
      }),
    });

    const [result] = await runner.run();
    result.stabilityLevel = stabilityLevel;

    if (store && dirName) {
      if (this.options.skipFinalize) {
        await Promise.all(
          result.trials.map((trial) =>
            store.writeTrial(dirName, result.scenarioName, trial),
          ),
        );
      } else {
        await store.save(runId, [result], [scenario], config, {
          concurrencyOverride: this.options.trialConcurrency,
          maxTurnsOverride: this.options.maxTurnsOverride,
          kind: 'graduation',
          dirName,
        });
      }
    }

    const hasValidResults = result.trials.some((trial) =>
      trial.evalResults.some((e) => e.verdict !== 'unknown'),
    );

    if (hasValidResults) {
      await baselineStore.save(runId, result, {
        defaultThreshold: config.regression.defaultThreshold,
      });
    } else {
      log(
        '[GraduationRunner] All trials produced unknown verdicts; skipping baseline save.',
        { scenarioName: scenario.name, runId },
      );
    }

    const base: GraduationResultBase = {
      scenarioName: scenario.name,
      stabilityLevel,
      stabilityTrials: totalTrials,
      baselineSaved: hasValidResults,
    };

    if (this.options.skipFinalize) {
      return { ...base, scenarioResult: result };
    }
    return base;
  }
}

