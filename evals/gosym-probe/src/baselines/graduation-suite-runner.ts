import { runCapped } from '../runner/suite-runner.js';
import type { RuncappedError } from '../runner/suite-runner.js';
import { GraduationRunner, isDeferredResult } from './graduation-runner.js';
import type { GraduationResult } from './graduation-runner.js';
import { BaselineStore } from './baseline-store.js';
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
import type { EvalStore } from '../store/eval-store.js';
import type { TrialResult } from '../runner/types.js';

export interface GraduationSuiteRunResult {
  results: GraduationResult[];
  errors: Error[];
  finalizationError?: Error;
}

export type Logger = (message: string, ...args: unknown[]) => void;

export interface GraduationSuiteRunnerOptions {
  scenarios: Scenario[];
  config: ResolvedConfig;
  makeAgentClient?: () => Promise<AgentClient>;
  syntheticUser?: SyntheticUserAgent;
  siteCapture?: SiteCapture;
  stabilityLevelOverride?: StabilityLevel;
  trialConcurrency?: number;
  maxScenarioConcurrency?: number;
  baselineStoreFactory?: () => BaselineStore;
  maxTurnsOverride?: number;
  onTrialEvaluated?: (scenarioName: string, trial: TrialResult) => void;
  store: EvalStore;
  log?: Logger;
}

export class GraduationSuiteRunner {
  private readonly options: GraduationSuiteRunnerOptions;
  private readonly log: Logger;
  private readonly trialConcurrency: number;

  constructor(options: GraduationSuiteRunnerOptions) {
    this.options = options;
    this.log = options.log ?? console.log;
    this.trialConcurrency = options.trialConcurrency ?? 1;
  }

  async run(runId: string): Promise<GraduationSuiteRunResult> {
    const maxConcurrency = this.options.maxScenarioConcurrency
      ?? this.options.config.eval.maxConcurrency
      ?? 1;

    const sharedDirName = await this.options.store.initRun(
      runId,
      this.options.scenarios,
      this.options.config,
      {
        concurrencyOverride: this.trialConcurrency,
        maxTurnsOverride: this.options.maxTurnsOverride,
        kind: 'graduation',
      },
    );

    this.logRunHeader(runId);

    try {
      const results = await runCapped<GraduationResult>(
        this.options.scenarios.length,
        maxConcurrency,
        (i) => this.runScenario(i, runId, sharedDirName),
      );

      const finalizationError = await this.safeFinalize(results, sharedDirName, runId);
      return { results, errors: [], finalizationError };
    } catch (err) {
      if (err instanceof AggregateError && 'partialResults' in err) {
        const partial = (err as RuncappedError<GraduationResult>).partialResults;
        const completed = partial.filter(
          (r): r is GraduationResult => r !== undefined,
        );

        const finalizationError = await this.safeFinalize(completed, sharedDirName, runId);
        const validatedErrors: Error[] = err.errors.map((e: unknown) =>
          e instanceof Error ? e : new Error(String(e)),
        );
        return { results: completed, errors: validatedErrors, finalizationError };
      }
      throw err;
    }
  }

  private runScenario(
    index: number,
    runId: string,
    sharedDirName: string,
  ): Promise<GraduationResult> {
    const scenario = this.options.scenarios[index];
    const runner = new GraduationRunner({
      scenario,
      config: this.options.config,
      makeAgentClient: this.options.makeAgentClient,
      syntheticUser: this.options.syntheticUser,
      siteCapture: this.options.siteCapture,
      baselineStore: this.options.baselineStoreFactory?.() ?? new BaselineStore(),
      stabilityLevelOverride: this.options.stabilityLevelOverride,
      concurrencyOverride: this.trialConcurrency,
      maxTurnsOverride: this.options.maxTurnsOverride,
      onTrialEvaluated: this.options.onTrialEvaluated,
      store: this.options.store,
      dirName: sharedDirName,
      skipFinalize: true,
      log: this.log,
    });
    return runner.run(runId);
  }

  private async safeFinalize(
    results: GraduationResult[],
    sharedDirName: string,
    runId: string,
  ): Promise<Error | undefined> {
    try {
      await this.finalizeCompleted(results, sharedDirName, runId);
      return undefined;
    } catch (finalizeErr) {
      this.log(
        `[GraduationSuiteRunner] finalization failed for run ${runId}`,
        finalizeErr,
      );
      return finalizeErr instanceof Error ? finalizeErr : new Error(String(finalizeErr));
    }
  }

  private async finalizeCompleted(
    results: GraduationResult[],
    sharedDirName: string,
    runId: string,
  ): Promise<void> {
    const deferred = results.filter(isDeferredResult);

    if (deferred.length > 0) {
      await this.options.store.finalizeRun(
        sharedDirName,
        runId,
        deferred.map((r) => r.scenarioResult),
        'graduation',
      );
    }
  }

  private logRunHeader(runId: string): void {
    this.log(`\nGraduation run: ${runId}`);
    this.log(
      `Scenarios: ${this.options.scenarios.map((s) => s.name).join(', ')}`,
    );
    for (const s of this.options.scenarios) {
      const level = resolveStabilityLevel(this.options.stabilityLevelOverride, s);
      this.log(`  ${s.name}: ${level} (${STABILITY_TRIALS[level]} trials)`);
    }
  }
}
