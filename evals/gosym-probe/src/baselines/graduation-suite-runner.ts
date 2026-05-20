import { runCapped, SuiteRunner } from '../runner/suite-runner.js';
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
import type { ScenarioResult, TrialResult } from '../runner/types.js';
import type { TrialLifecycle } from '../clients/trial-lifecycle.js';

export interface GraduationSuiteRunResult {
  results: GraduationResult[];
  errors: Error[];
  finalizationError?: Error;
}

export type Logger = (message: string, ...args: unknown[]) => void;

export interface GraduationSuiteRunnerOptions {
  scenarios: Scenario[];
  config: ResolvedConfig;
  makeAgentClient?: (scenario?: Scenario) => Promise<AgentClient>;
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
  trialLifecycle?: TrialLifecycle;
  onTrialEvaluated?: (scenarioName: string, trial: TrialResult) => void;
  store: EvalStore;
  log?: Logger;
  /**
   * When 'parallel', dispatches trials round-robin across a worker pool via
   * SuiteRunner (same as the regular fan-out eval path). scenarioConcurrency
   * caps the worker pool size. trialConcurrency is unused in this mode.
   */
  suiteMode?: 'parallel';
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

    if (this.options.suiteMode === 'parallel') {
      return this.runFanOut(sharedDirName, runId);
    }

    const maxConcurrency = this.options.scenarioConcurrency
      ?? this.options.config.eval.maxConcurrency;

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

  /**
   * Fan-out mode: dispatches trials round-robin across a worker pool via
   * SuiteRunner, then runs per-scenario graduation finalization (baseline
   * save, stability metadata) after all trials complete.
   */
  private async runFanOut(
    sharedDirName: string,
    runId: string,
  ): Promise<GraduationSuiteRunResult> {
    const {
      scenarios,
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      scenarioConcurrency,
      stabilityLevelOverride,
      maxTurnsOverride,
      trialLifecycle,
      onTrialEvaluated,
      store,
    } = this.options;

    // Override each scenario's trial count with its stability-derived value so
    // SuiteRunner.runFanOut builds the right round-robin queue.
    const scenariosWithStabilityTrials = scenarios.map((s) => ({
      ...s,
      trials: STABILITY_TRIALS[resolveStabilityLevel(stabilityLevelOverride, s)],
    }));

    const suiteRunner = new SuiteRunner({
      scenarios: scenariosWithStabilityTrials,
      config,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      scenarioConcurrency,
      suiteMode: 'parallel',
      maxTurnsOverride,
      trialLifecycle,
      onTrialEvaluated,
      getTrialOutputDir: (scenarioName, trialIndex) =>
        store.ensureTrialDir(sharedDirName, scenarioName, trialIndex),
      writePartialTrial: (scenarioName, trialIndex, transcript) =>
        store.writePartialTrial(sharedDirName, scenarioName, trialIndex, transcript),
    });

    let scenarioResults: ScenarioResult[];
    const errors: Error[] = [];
    try {
      scenarioResults = await suiteRunner.run();
    } catch (err) {
      // SuiteRunner.runFanOut re-throws when an entire scenario has zero
      // completed trials. Unlike the sequential path (which gets partial
      // GraduationResults from runCapped), the parallel path aborts before
      // evaluation, so no ScenarioResults are recoverable.
      //
      // TODO: Partial trial transcripts are persisted via writePartialTrial
      // during execution, so data is not lost on disk. Planned self-healing
      // resume will detect stalled/failed trials (e.g. locked resources) and
      // auto-trigger --resume to recover without discarding completed work.
      if (err instanceof AggregateError) {
        const validatedErrors: Error[] = err.errors.map((e: unknown) =>
          e instanceof Error ? e : new Error(String(e)),
        );
        console.warn(
          'Graduation parallel aborted: one or more scenarios had zero completed trials. ' +
            'Completed work from other scenarios was discarded. ' +
            'Partial transcripts are persisted on disk — use --resume to recover.',
          {
            scenarios: scenarios.map((s) => s.name),
            errorCount: validatedErrors.length,
            errors: validatedErrors.map((e) => e.message),
          },
        );
        const finalizationError = await this.safeFinalize([], sharedDirName, runId);
        return { results: [], errors: validatedErrors, finalizationError };
      }
      throw err;
    }

    const gradResults: GraduationResult[] = [];
    for (const result of scenarioResults) {
      const gradResult = await this.finalizeScenarioGraduation(result, sharedDirName, runId);
      gradResults.push(gradResult);
    }

    const finalizationError = await this.safeFinalize(gradResults, sharedDirName, runId);
    return { results: gradResults, errors, finalizationError };
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
      trialLifecycle: this.options.trialLifecycle,
      onTrialEvaluated: this.options.onTrialEvaluated,
      store: this.options.store,
      dirName: sharedDirName,
      skipFinalize: true,
      log: this.log,
    });
    return runner.run(runId);
  }

  /**
   * Persists trial data, saves baseline (if valid), and builds a GraduationResult
   * for a single scenario. Shared finalization logic for both sequential and
   * parallel graduation paths.
   */
  private async finalizeScenarioGraduation(
    result: ScenarioResult,
    sharedDirName: string,
    runId: string,
  ): Promise<GraduationResult> {
    const { scenarios, stabilityLevelOverride, store, config, baselineStoreFactory } = this.options;

    const scenario = scenarios.find((s) => s.name === result.scenarioName);
    if (!scenario) {
      throw new Error(
        `[GraduationSuiteRunner] No matching scenario for result "${result.scenarioName}"`,
      );
    }
    const stabilityLevel = resolveStabilityLevel(stabilityLevelOverride, scenario);
    result.stabilityLevel = stabilityLevel;

    await Promise.all(
      result.trials.map((trial) =>
        store.writeTrial(sharedDirName, result.scenarioName, trial),
      ),
    );

    const hasValidResults = result.trials.some((t) =>
      t.evalResults.some((e) => e.verdict !== 'unknown'),
    );

    if (hasValidResults) {
      const baselineStore = baselineStoreFactory?.() ?? new BaselineStore();
      await baselineStore.save(runId, result, {
        defaultThreshold: config.regression.defaultThreshold,
      });
    } else {
      this.log(
        '[GraduationSuiteRunner] All trials produced unknown verdicts; skipping baseline save.',
        { scenarioName: result.scenarioName, runId },
      );
    }

    return {
      scenarioName: result.scenarioName,
      stabilityLevel,
      stabilityTrials: STABILITY_TRIALS[stabilityLevel],
      baselineSaved: hasValidResults,
      scenarioResult: result,
    };
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

    const cap = this.options.scenarioConcurrency
      ?? this.options.config.eval.maxConcurrency;

    if (this.options.suiteMode === 'parallel') {
      const totalTrials = this.options.scenarios.reduce(
        (sum, s) => sum + STABILITY_TRIALS[resolveStabilityLevel(this.options.stabilityLevelOverride, s)],
        0,
      );
      const workerCount = Math.min(cap, totalTrials);
      this.log(
        `Fan-out: ${workerCount} workers, round-robin across ${this.options.scenarios.length} scenarios`,
      );
    } else if (this.options.scenarioConcurrency !== 1) {
      const actualParallelism = Math.min(cap, this.options.scenarios.length);
      // Legacy per-scenario fan-out (scenarioConcurrency > 1, no suiteMode).
      // scenarioConcurrency === 1 → sequential; anything else → fan-out.
      // See GraduationSuiteRunnerOptions.scenarioConcurrency for the full convention.
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
