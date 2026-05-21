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
  /**
   * Pre-existing run directory. When provided, run() uses this dirName
   * instead of calling store.initRun(). Used for graduation resume.
   */
  dirName?: string;
  /**
   * Pre-loaded trials from a prior run. Merged with newly completed trials
   * in the inner SuiteRunner. Only used in parallel (fan-out) mode.
   */
  existingTrialsByScenario?: Map<string, TrialResult[]>;
  /**
   * Specific trial indices to execute. Empty array means the scenario is
   * fully complete (SuiteRunner will skip running new trials but can still
   * aggregate existing ones). Only used in parallel (fan-out) mode.
   */
  trialIndicesByScenario?: Map<string, number[]>;
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
    const sharedDirName = this.options.dirName ?? await this.options.store.initRun(
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
      existingTrialsByScenario,
      trialIndicesByScenario,
    } = this.options;

    // Override each scenario's trial count with its stability-derived value so
    // SuiteRunner.runFanOut builds the right round-robin queue.
    const scenariosWithStabilityTrials = scenarios.map((s) => ({
      ...s,
      trials: STABILITY_TRIALS[resolveStabilityLevel(stabilityLevelOverride, s)],
    }));

    // Track which trials have been successfully persisted by the fire-and-forget
    // path. Finalization skips trials in this set to avoid concurrent writes to
    // the same directory.
    const persistedTrials = new Set<string>();
    const pendingWrites: Promise<void>[] = [];

    // Wrap onTrialEvaluated to fire-and-forget writeTrial as each trial completes.
    // This persists eval results to disk before finalization, enabling resume to
    // find completed trials via listCompletedTrialIndices even if finalization
    // is never reached (e.g. on a partial fan-out failure).
    const onTrialEvaluatedWithPersistence = (scenarioName: string, trial: TrialResult): void => {
      const key = `${scenarioName}:${trial.trialIndex}`;
      const writePromise = store.writeTrial(sharedDirName, scenarioName, trial).then(() => {
        persistedTrials.add(key);
      }).catch((err) => {
        this.log('[GraduationSuiteRunner] writeTrial fire-and-forget failed', {
          scenarioName,
          trialIndex: trial.trialIndex,
          err,
        });
      });
      pendingWrites.push(writePromise);
      onTrialEvaluated?.(scenarioName, trial);
    };

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
      onTrialEvaluated: onTrialEvaluatedWithPersistence,
      existingTrialsByScenario,
      trialIndicesByScenario,
      getTrialOutputDir: (scenarioName, trialIndex) =>
        store.ensureTrialDir(sharedDirName, scenarioName, trialIndex),
      writePartialTrial: (scenarioName, trialIndex, transcript) =>
        store.writePartialTrial(sharedDirName, scenarioName, trialIndex, transcript),
    });

    // SuiteRunner returns partial results when a scenario has zero completed
    // trials — those scenarios are absent from the array. Detect them and
    // include a descriptive error so callers know which scenarios to resume.
    let scenarioResults: ScenarioResult[];
    try {
      scenarioResults = await suiteRunner.run();
    } finally {
      // Wait for all fire-and-forget writes to settle so persistedTrials is
      // fully populated before finalization begins — even if run() throws,
      // because the caller releases the lock immediately after us.
      await Promise.all(pendingWrites);
    }

    const completedNames = new Set(scenarioResults.map((r) => r.scenarioName));
    const missingScenarioErrors: Error[] = scenariosWithStabilityTrials
      .filter((s) => !completedNames.has(s.name))
      .map(
        (s) =>
          new Error(
            `[GraduationSuiteRunner] Scenario "${s.name}" produced zero completed trials`,
          ),
      );

    const gradResults: GraduationResult[] = [];
    const finalizationErrors: Error[] = [];
    for (const result of scenarioResults) {
      try {
        const gradResult = await this.finalizeScenarioGraduation(
          result, sharedDirName, runId, persistedTrials,
        );
        gradResults.push(gradResult);
      } catch (err) {
        finalizationErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    const finalizationError = await this.safeFinalize(gradResults, sharedDirName, runId);
    return {
      results: gradResults,
      errors: [...missingScenarioErrors, ...finalizationErrors],
      finalizationError,
    };
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
   *
   * @param persistedTrials - Set of `scenarioName:trialIndex` keys already
   *   written to disk by the fire-and-forget path. Trials in this set are
   *   skipped to avoid redundant concurrent writes. Omit for the sequential path.
   */
  private async finalizeScenarioGraduation(
    result: ScenarioResult,
    sharedDirName: string,
    runId: string,
    persistedTrials?: ReadonlySet<string>,
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

    const trialsToWrite = persistedTrials
      ? result.trials.filter(
          (trial) => !persistedTrials.has(`${result.scenarioName}:${trial.trialIndex}`),
        )
      : result.trials;

    await Promise.all(
      trialsToWrite.map((trial) =>
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
