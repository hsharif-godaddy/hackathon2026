import { runCapped } from '../runner/suite-runner.js';
import type { RuncappedError } from '../runner/suite-runner.js';
import { staggeredRun } from '../util/stagger.js';
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
  /**
   * Trial-level concurrency cap passed to inner SuiteRunner.
   * Clamped to config.eval.maxConcurrency. Defaults to 1 when omitted.
   */
  trialConcurrency?: number;
  /**
   * Caps how many scenarios run concurrently during graduation.
   * Clamped to config.eval.maxConcurrency. Falls back to config.eval.maxConcurrency when omitted.
   *
   * Convention: pass `1` for sequential (non-fan-out) mode, `undefined` or a value > 1 for
   * fan-out mode. `logRunHeader` uses `scenarioConcurrency !== 1` to detect fan-out.
   * The edge case `--fan-out --concurrency 1` is treated as sequential — fan-out with
   * concurrency 1 is indistinguishable from non-fan-out anyway.
   */
  scenarioConcurrency?: number;
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
    const maxConcurrency = this.options.scenarioConcurrency
      ?? this.options.config.eval.maxConcurrency;

    const sharedDirName = await this.options.store.initRun(
      runId,
      this.options.scenarios,
      this.options.config,
      {
        concurrencyOverride: this.trialConcurrency,  // store metadata: raw CLI value
        maxTurnsOverride: this.options.maxTurnsOverride,
        kind: 'graduation',
      },
    );

    this.logRunHeader(runId);

    try {
      const results = await runCapped<GraduationResult>(
        this.options.scenarios.length,
        maxConcurrency,
        (i) => staggeredRun(i, maxConcurrency, () => this.runScenario(i, runId, sharedDirName)),
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
      trialConcurrency: this.trialConcurrency,
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

    // scenarioConcurrency === 1 → sequential (non-fan-out); anything else → fan-out.
    // See GraduationSuiteRunnerOptions.scenarioConcurrency for the full convention.
    const isFanOut = this.options.scenarioConcurrency !== 1;
    if (isFanOut) {
      const cap = this.options.scenarioConcurrency
        ?? this.options.config.eval.maxConcurrency;
      const actualParallelism = Math.min(cap, this.options.scenarios.length);
      this.log(
        `Fan-out: ${actualParallelism} of ${this.options.scenarios.length} scenarios concurrently (1 trial at a time per scenario)`,
      );
    }

    for (const s of this.options.scenarios) {
      const level = resolveStabilityLevel(this.options.stabilityLevelOverride, s);
      this.log(`  ${s.name}: ${level} (${STABILITY_TRIALS[level]} trials)`);
    }
  }
}
