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
import type { BaselineSaveOptions } from './baseline-store.js';
import { pickGitFields } from './types.js';
import { assessBaselineEligibility } from './baseline-eligibility.js';
import type { TrialLifecycle } from '../clients/trial-lifecycle.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type { ProgressReporter } from '../util/progress-reporter.js';
import { downloadLogoSnapshots } from '../util/download-logo-snapshots.js';

interface BaselineStore {
  save(
    runId: string,
    result: ScenarioResult,
    options?: BaselineSaveOptions,
  ): Promise<void>;
}

interface GraduationRunnerOptionsBase {
  scenario: Scenario;
  config: ResolvedConfig;
  makeAgentClient?: (scenario?: Scenario) => Promise<AgentClient>;
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
  trialLifecycle?: TrialLifecycle;
  onTrialEvaluated?: (scenarioName: string, trial: TrialResult) => void;
  log?: (message: string, ...args: unknown[]) => void;
  gocode?: IGocodeClient;
  verbose?: boolean;
  progressReporter?: ProgressReporter | null;
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
  /** Trials that failed during execution and were dropped from aggregation.
   * Surfaced so callers can degrade the exit code on a thinned sample. */
  droppedTrials: number;
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

    let runMetadata: Awaited<ReturnType<EvalStore['loadRunMetadataByDirName']>> = null;
    if (store) {
      try {
        runMetadata = await store.loadRunMetadataByDirName(dirName!);
      } catch (err) {
        log(
          '[GraduationRunner] Failed to read run metadata for git fields, continuing without them',
          { dirName, error: (err as Error).message },
        );
      }
    }

    const pendingDownloads: Promise<void>[] = [];

    const runner = new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      trialsOverride: totalTrials,
      trialConcurrency: this.options.trialConcurrency,
      maxTurnsOverride: this.options.maxTurnsOverride,
      trialLifecycle: this.options.trialLifecycle,
      onTrialEvaluated: this.options.onTrialEvaluated,
      verbose: this.options.verbose,
      progressReporter: this.options.progressReporter,
      ...(store && dirName && {
        getTrialOutputDir: (scenarioName, trialIndex) =>
          store.ensureTrialDir(dirName, scenarioName, trialIndex),
        writePartialTrial: async (scenarioName, trialIndex, transcript, setupCtx) => {
          await store.writePartialTrial(dirName, scenarioName, trialIndex, transcript);
          if (setupCtx.previewUrl) {
            const trialDir = await store.ensureTrialDir(dirName, scenarioName, trialIndex);
            const p = downloadLogoSnapshots(
              transcript.turns,
              setupCtx.previewUrl,
              trialDir,
              config.playwright.ignoreHttpsErrors,
            ).catch((err: unknown) => {
              log('[logo-snapshots] Download failed for %s trial %d:', scenarioName, trialIndex,
                err instanceof Error ? err.message : String(err));
            });
            pendingDownloads.push(p);
          }
        },
      }),
    });

    const [result] = await runner.run();
    await Promise.allSettled(pendingDownloads);
    result.stabilityLevel = stabilityLevel;

    if (result.droppedTrials !== undefined && result.droppedTrials > 0) {
      log(
        `[GraduationRunner] ${result.droppedTrials} of ${totalTrials} trial(s) ` +
        `dropped for "${scenario.name}" (e.g. turn timeout); graduating on the ` +
        `${totalTrials - result.droppedTrials} completed trial(s).`,
      );
    }

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
          ...(this.options.gocode !== undefined && { gocode: this.options.gocode }),
        });
      }
    }

    const eligibility = assessBaselineEligibility(result);

    if (eligibility.eligible) {
      await baselineStore.save(runId, result, {
        defaultThreshold: config.regression.fallbackThresholds.defaultThreshold,
        ...pickGitFields(runMetadata),
      });
    } else {
      log(
        `[GraduationRunner] Skipping baseline save: ${eligibility.detail}.`,
        { scenarioName: scenario.name, runId, reason: eligibility.reason },
      );
    }

    const base: GraduationResultBase = {
      scenarioName: scenario.name,
      stabilityLevel,
      stabilityTrials: totalTrials,
      baselineSaved: eligibility.eligible,
      droppedTrials: result.droppedTrials ?? 0,
    };

    if (this.options.skipFinalize) {
      return { ...base, scenarioResult: result };
    }
    return base;
  }
}

