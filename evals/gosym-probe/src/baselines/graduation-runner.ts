import { SuiteRunner } from '../runner/suite-runner.js';
import {
  DEFAULT_STABILITY_LEVEL,
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
import type { ScenarioResult } from '../runner/types.js';
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
  config: ResolvedConfig;
  makeAgentClient?: () => Promise<AgentClient>;
  syntheticUser?: SyntheticUserAgent;
  siteCapture?: SiteCapture;
  baselineStore: BaselineStore;
  stabilityLevelOverride?: StabilityLevel;
  concurrencyOverride?: number;
  maxTurnsOverride?: number;
  store?: EvalStore;
}

/**
 * Result of a graduation run. The baseline is saved after N stability trials
 * complete unless all trials produced only unknown verdicts (indicating
 * infrastructure failure rather than meaningful eval data).
 */
export interface GraduationResult {
  scenarioName: string;
  stabilityLevel: StabilityLevel;
  stabilityTrials: number;
  baselineSaved: boolean;
}

export class GraduationRunner {
  constructor(private readonly options: GraduationRunnerOptions) {}

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

    const stabilityLevel =
      this.options.stabilityLevelOverride
      ?? scenario.stabilityLevel
      ?? DEFAULT_STABILITY_LEVEL;
    const totalTrials = STABILITY_TRIALS[stabilityLevel];

    const dirName = store
      ? await store.initRun(runId, [scenario], config, {
        concurrencyOverride: this.options.concurrencyOverride,
        maxTurnsOverride: this.options.maxTurnsOverride,
        kind: 'graduation',
      })
      : undefined;

    const runner = new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      trialsOverride: totalTrials,
      concurrencyOverride: this.options.concurrencyOverride,
      maxTurnsOverride: this.options.maxTurnsOverride,
      ...(store && dirName && {
        getTrialOutputDir: (scenarioName, trialIndex) =>
          store.ensureTrialDir(dirName, scenarioName, trialIndex),
      }),
    });

    const [result] = await runner.run();
    result.stabilityLevel = stabilityLevel;

    if (this.options.store && dirName) {
      await this.options.store.save(runId, [result], [scenario], config, {
        concurrencyOverride: this.options.concurrencyOverride,
        maxTurnsOverride: this.options.maxTurnsOverride,
        kind: 'graduation',
        dirName,
      });
    }

    const hasValidResults = result.trials.some((trial) =>
      trial.evalResults.some((e) => e.verdict !== 'unknown'),
    );

    if (hasValidResults) {
      await baselineStore.save(runId, result, {
        defaultThreshold: config.regression.defaultThreshold,
      });
    } else {
      console.warn(
        '[GraduationRunner] All trials produced unknown verdicts; skipping baseline save.',
        { scenarioName: scenario.name, runId },
      );
    }

    return {
      scenarioName: scenario.name,
      stabilityLevel,
      stabilityTrials: totalTrials,
      baselineSaved: hasValidResults,
    };
  }
}

