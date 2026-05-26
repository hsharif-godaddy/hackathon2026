import { RateLimitError } from 'openai';
import { Simulation, InactivityTimeoutError } from './simulation.js';
import type { SimulationCaptureContext } from './simulation.js';
import { TrialAggregator } from './trial-aggregator.js';
import { RegressionComparator } from '../baselines/regression-comparator.js';
import { enrichScoreModePassRates } from '../baselines/score-mode-enricher.js';
import type { Scenario } from '../scenarios/types.js';
import type { ScenarioResult, TrialResult } from './types.js';
import type { ResolvedConfig } from '../../config/index.js';
import type { AgentClient } from '../clients/agent-client.js';
import type { SyntheticUserAgent } from './synthetic-user.js';
import type { SiteCapture } from '../clients/dom-capture.js';
import type { DOMSnapshot, Transcript } from './transcript.js';
import type { BaselineScores } from '../baselines/types.js';
import type { EvalResult, Evaluator } from '../evaluators/evaluator.js';
import { normalizeEvalResult } from '../evaluators/normalize-eval-result.js';
import { effectiveConcurrency } from '../util/concurrency.js';
import { parseRetryAfterMs } from '../util/retry-after.js';
import { sleep } from '../util/sleep.js';
import { staggeredRun, computeStaggerDelay } from '../util/stagger.js';
import type { TrialLifecycle } from '../clients/trial-lifecycle.js';

// Fallback wait when the server omits Retry-After. Promote to config
// if per-environment tuning becomes necessary (e.g. CI wants fewer retries).
const RATE_LIMIT_WAIT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 10;

interface BaselineStore {
  load(scenarioName: string): Promise<{ scores: BaselineScores; filePath: string } | null>;
  loadByRunId(scenarioName: string, runId: string): Promise<{ scores: BaselineScores; filePath: string } | null>;
}

interface WorkItem {
  scenarioIndex: number;
  trialIndex: number;
}

export type RuncappedError<T> = AggregateError & {
  partialResults: (T | undefined)[];
};

export async function runCapped<T>(
  count: number,
  cap: number,
  fn: (i: number) => Promise<T>,
): Promise<T[]> {
  if (count === 0 || cap <= 0) return [];
  const results: (T | undefined)[] = new Array(count);
  const errors = new Map<number, unknown>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < count) {
      const i = next++;
      try {
        results[i] = await fn(i);
      } catch (err) {
        errors.set(i, err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(cap, count) }, worker),
  );
  if (errors.size > 0) {
    const agg = new AggregateError(
      [...errors.values()],
      `${errors.size} of ${count} tasks failed`,
    ) as RuncappedError<T>;
    agg.partialResults = results;
    throw agg;
  }
  return results as T[];
}

export interface SuiteRunnerOptions {
  scenarios: Scenario[];
  config: ResolvedConfig;
  /** Per-trial async factory; each Simulation owns its connection.
   *  Receives the scenario so the factory can inject auth context
   *  (e.g. agentProfile) into the socket handshake. */
  makeAgentClient?: (scenario?: Scenario) => Promise<AgentClient>;
  syntheticUser?: SyntheticUserAgent;
  siteCapture?: SiteCapture;
  trialsOverride?: number;
  /**
   * Trial-level concurrency cap. Clamped to config.eval.maxConcurrency.
   * When omitted, defaults to config.eval.maxConcurrency.
   */
  trialConcurrency?: number;
  /**
   * When suiteMode is 'parallel', caps how many scenarios run concurrently.
   * Clamped to config.eval.maxConcurrency. Falls back to config.eval.maxConcurrency when omitted.
   */
  scenarioConcurrency?: number;
  maxTurnsOverride?: number;
  /** When provided, load baseline and attach regressionStatus. */
  baselineStore?: BaselineStore;
  /**
   * When set, pin baseline comparison to this specific runId instead of
   * loading the most recent baseline. Has no effect when `baselineStore`
   * is absent.
   */
  baselineRunId?: string;
  /**
   * When `'parallel'`, scenarios fan out as individual (scenario, trial) pairs
   * dispatched round-robin across a fixed worker pool. Worker pool size is
   * capped by `scenarioConcurrency` or `config.eval.maxConcurrency`.
   * When omitted, scenarios run sequentially with trial-level parallelism
   * governed by `config.eval.maxConcurrency`.
   */
  suiteMode?: 'parallel';
  /**
   * Fires incrementally as each trial completes, not in a burst at the end.
   * Delivery order matches worker completion order, which is non-deterministic
   * when more than one trial runs concurrently. Concurrency is the effective
   * value resolved from `trialConcurrency` (defaults to
   * `config.eval.maxConcurrency` when unset). Do not assume in-index-order
   * delivery.
   */
  onTrialEvaluated?: (
    scenarioName: string,
    trial: TrialResult,
  ) => void;
  existingTrialsByScenario?: Map<string, TrialResult[]>;
  trialIndicesByScenario?: Map<string, number[]>;
  /**
   * Resolves the on-disk trial output directory before the capture
   * step runs. Forwarded to `Simulation` so `SiteCapture` writes
   * snapshot/tile artifacts directly under that directory.
   */
  getTrialOutputDir?: (
    scenarioName: string,
    trialIndex: number,
  ) => Promise<string>;
  /**
   * Persists conversation data after the conversation loop and before capture.
   * Receives the scenario name, trial index, and partial transcript (no snapshot).
   * Fires whenever provided, regardless of capture configuration.
   */
  writePartialTrial?: (
    scenarioName: string,
    trialIndex: number,
    transcript: Transcript,
  ) => Promise<void>;
  /** Invoked when writePartialTrial fails, for failure tracking. */
  onPartialWriteFailed?: (
    scenarioName: string,
    trialIndex: number,
    error: unknown,
  ) => void;
  /**
   * Per-trial isolation lifecycle. When provided, trials are bracketed in
   * `runInScope()` and resources are released via `release()` in the
   * finally block.
   */
  trialLifecycle?: TrialLifecycle;
}

export class SuiteRunner {
  private readonly aggregator = new TrialAggregator();
  private readonly comparator = new RegressionComparator();

  constructor(private readonly options: SuiteRunnerOptions) {}

  /**
   * Execute all scenarios and return aggregated results.
   *
   * **Fan-out partial-result contract:** In fan-out mode (`suiteMode: 'parallel'`),
   * scenarios are excluded from the returned array only when they have zero completed
   * trials in this run AND zero existing trials from a prior resume. Callers must
   * compare the returned scenario names against the expected set to detect
   * completely-failed scenarios. This preserves partial results for resume workflows
   * instead of discarding an entire run on isolated failures.
   */
  async run(): Promise<ScenarioResult[]> {
    const { scenarios, config, trialsOverride, suiteMode, siteCapture, getTrialOutputDir } = this.options;

    if (siteCapture && !getTrialOutputDir) {
      console.warn(
        '[SuiteRunner] siteCapture provided without getTrialOutputDir; snapshot capture will be disabled.',
      );
    }
    if (!siteCapture && getTrialOutputDir) {
      console.warn(
        '[SuiteRunner] getTrialOutputDir provided without siteCapture; snapshot capture will be disabled.',
      );
    }

    if (suiteMode === 'parallel') {
      return this.runFanOut();
    }

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      const k = trialsOverride ?? scenario.trials;
      results.push(await this.processScenario(scenario, k));
    }
    return results;
  }

  /**
   * Builds a round-robin WorkItem queue: trial ordinal first, then scenario.
   * A0, B0, C0, A1, B1, C1, ... Scenarios with fewer trials are exhausted
   * and dropped from subsequent ordinals.
   */
  private buildRoundRobinQueue(
    trialIndicesPerScenario: number[][],
  ): WorkItem[] {
    if (trialIndicesPerScenario.length === 0) return [];
    let maxTrials = 0;
    for (const t of trialIndicesPerScenario) {
      if (t.length > maxTrials) maxTrials = t.length;
    }
    const queue: WorkItem[] = [];
    for (let ordinal = 0; ordinal < maxTrials; ordinal++) {
      for (let scenarioIndex = 0; scenarioIndex < trialIndicesPerScenario.length; scenarioIndex++) {
        if (ordinal < trialIndicesPerScenario[scenarioIndex].length) {
          queue.push({
            scenarioIndex,
            trialIndex: trialIndicesPerScenario[scenarioIndex][ordinal],
          });
        }
      }
    }
    return queue;
  }

  /**
   * Loads baseline data for a scenario and attaches regression status + enriched
   * aggregated scores to the result. Shared between runFanOut and processScenario.
   */
  private async applyBaselineComparison(
    scenario: Scenario,
    result: ScenarioResult,
  ): Promise<void> {
    const { baselineStore, baselineRunId, config } = this.options;
    if (!baselineStore) return;

    const loaded = baselineRunId
      ? await baselineStore.loadByRunId(scenario.name, baselineRunId)
      : await baselineStore.load(scenario.name);
    if (loaded === null && baselineRunId) {
      throw new Error(
        `Baseline run "${baselineRunId}" not found for scenario "${scenario.name}".`,
      );
    }
    if (loaded) {
      const regressionStatus = this.comparator.compare(
        result,
        loaded.scores,
        config.regression,
      );
      const { aggregated: enrichedAggregated, trials: enrichedTrials } = enrichScoreModePassRates(
        result,
        loaded.scores,
        config.regression.fallbackThresholds,
        regressionStatus,
      );
      result.regressionStatus = regressionStatus;
      result.aggregated = enrichedAggregated;
      result.trials = enrichedTrials;
      result.baselineFilePath = loaded.filePath;
    }
  }

  /**
   * Fan-out mode: dispatches individual (scenario, trial) pairs in round-robin
   * trial-ordinal order across a fixed worker pool. All workers stay busy until
   * the queue drains. Partial failures are tolerated: scenarios with at least
   * one completed trial proceed to evaluation; only fully-failed scenarios abort.
   */
  private async runFanOut(): Promise<ScenarioResult[]> {
    const {
      scenarios,
      config,
      trialsOverride,
      scenarioConcurrency,
      existingTrialsByScenario,
      trialIndicesByScenario,
    } = this.options;

    if (scenarios.length === 0) return [];

    const { makeAgentClient, syntheticUser } = this.options;
    if (!makeAgentClient) {
      throw new Error('runFanOut: makeAgentClient is required');
    }
    if (!syntheticUser) {
      throw new Error('runFanOut: syntheticUser is required');
    }

    const cap = effectiveConcurrency(scenarioConcurrency, config.eval.maxConcurrency);

    const trialIndicesPerScenario: number[][] = scenarios.map((s) =>
      trialIndicesByScenario?.get(s.name)
        ?? Array.from({ length: trialsOverride ?? s.trials }, (_, i) => i),
    );

    const queue = this.buildRoundRobinQueue(trialIndicesPerScenario);

    // trialResultsByScenario[scenarioIndex][trialIndex] = TrialResult
    const trialResultsByScenario: Map<number, Map<number, TrialResult>> = new Map(
      scenarios.map((_, i) => [i, new Map<number, TrialResult>()]),
    );

    function getTrialMap(scenarioIndex: number): Map<number, TrialResult> {
      const map = trialResultsByScenario.get(scenarioIndex);
      if (!map) {
        throw new Error(`[SuiteRunner] No trial map for scenario index ${scenarioIndex}`);
      }
      return map;
    }

    // Tracks how many trials were dropped per scenario (scenarioIndex -> count).
    // Populated in the catch block when partial failures occur.
    const droppedByScenario = new Map<number, number>();

    try {
      const fanOutResults = await runCapped(
        queue.length,
        cap,
        async (i: number) => {
          const delay = computeStaggerDelay(i, cap);
          if (delay > 0) {
            await sleep(delay);
          }
          const item = queue[i];
          const scenario = scenarios[item.scenarioIndex];
          const { trialIndex } = item;
          const afterSimFailures = new Set<string>();
          return this.executeTrialWithCleanup(
            scenario, trialIndex, makeAgentClient, syntheticUser, afterSimFailures,
          );
        },
      );
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        getTrialMap(item.scenarioIndex).set(item.trialIndex, fanOutResults[i]);
      }
    } catch (err) {
      if (
        !(err instanceof AggregateError) ||
        !(err as RuncappedError<TrialResult>).partialResults
      ) {
        throw err;
      }
      const agg = err as RuncappedError<TrialResult>;
      const partial = agg.partialResults;

      const failedTrials: Array<{ scenarioName: string; trialIndex: number }> = [];
      for (let i = 0; i < queue.length; i++) {
        const trialResult = partial[i];
        const item = queue[i];
        if (trialResult !== undefined) {
          getTrialMap(item.scenarioIndex).set(item.trialIndex, trialResult);
        } else {
          failedTrials.push({
            scenarioName: scenarios[item.scenarioIndex].name,
            trialIndex: item.trialIndex,
          });
          const prev = droppedByScenario.get(item.scenarioIndex) ?? 0;
          droppedByScenario.set(item.scenarioIndex, prev + 1);
        }
      }

      if (failedTrials.length > 0) {
        console.warn('Fan-out trials failed.', {
          failedTrials,
          errors: agg.errors.map((e: unknown) =>
            e instanceof Error ? e.message : String(e),
          ),
        });
      }

      // Warn when a scenario has 0 completed trials; the aggregation loop below
      // skips those scenarios so callers receive partial results. Callers are
      // responsible for detecting which scenarios are missing.
      // Guard: scenarios with 0 queued trials (already complete during resume) are not failures.
      const completelyFailedScenarios = scenarios
        .filter(
          (s, i) =>
            trialIndicesPerScenario[i].length > 0 &&
            getTrialMap(i).size === 0 &&
            (existingTrialsByScenario?.get(s.name)?.length ?? 0) === 0,
        )
        .map((s) => s.name);
      if (completelyFailedScenarios.length > 0) {
        console.warn('Fan-out: scenario(s) had zero completed trials and will be absent from results.', {
          scenarios: completelyFailedScenarios,
        });
      }
    }

    const results: ScenarioResult[] = [];

    for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
      const scenario = scenarios[scenarioIndex];
      const completedMap = getTrialMap(scenarioIndex);
      const existingTrials = existingTrialsByScenario?.get(scenario.name) ?? [];

      if (completedMap.size === 0 && existingTrials.length === 0) continue;

      const pairs = [...completedMap.entries()].sort(([a], [b]) => a - b);
      const newTrialResults = pairs.map(([, t]) => t);

      const trialResults = [
        ...existingTrials,
        ...newTrialResults,
      ].sort((a, b) => a.trialIndex - b.trialIndex);

      const result = this.aggregator.aggregate(scenario, trialResults);
      const dropped = droppedByScenario.get(scenarioIndex);
      if (dropped !== undefined && dropped > 0) {
        result.droppedTrials = dropped;
      }
      await this.applyBaselineComparison(scenario, result);
      results.push(result);
    }

    return results;
  }

  private async processScenario(
    scenario: Scenario,
    k: number,
  ): Promise<ScenarioResult> {
    const {
      config,
      trialConcurrency,
      makeAgentClient,
      syntheticUser,
      existingTrialsByScenario,
      trialIndicesByScenario,
    } = this.options;

    if (!makeAgentClient) {
      throw new Error(
        `processScenario: makeAgentClient is required to run scenario "${scenario.name}"`,
      );
    }
    if (!syntheticUser) {
      throw new Error(
        `processScenario: syntheticUser is required to run scenario "${scenario.name}"`,
      );
    }

    const trialIndices = trialIndicesByScenario?.get(scenario.name)
      ?? Array.from({ length: k }, function index(_, i) {
        return i;
      });

    // Tracks evaluators whose afterSimulation hook threw, keyed by
    // `${evaluatorName}:${trialIndex}`. Propagated to eval results so
    // consumers can detect potentially degraded measurements.
    //
    // Shared across all concurrent trials within this scenario. Safe because
    // keys include trialIndex, preventing cross-trial collision. The fan-out
    // path (runFanOut) uses per-work-item isolated Sets for stronger isolation;
    // both approaches are correct given the key-scoped access pattern.
    const afterSimFailures = new Set<string>();

    const concurrency = effectiveConcurrency(trialConcurrency, config.eval.maxConcurrency);
    const newTrialResults = await runCapped(trialIndices.length, concurrency, (i) => {
      const trialIndex = trialIndices[i];
      return staggeredRun(i, concurrency, () =>
        this.executeTrialWithCleanup(
          scenario, trialIndex, makeAgentClient, syntheticUser, afterSimFailures,
        ),
      );
    });
    const trialResults = [
      ...(existingTrialsByScenario?.get(scenario.name) ?? []),
      ...newTrialResults,
    ].sort((a, b) => a.trialIndex - b.trialIndex);
    const result = this.aggregator.aggregate(
      scenario,
      trialResults,
    );

    await this.applyBaselineComparison(scenario, result);

    return result;
  }

  private runInScope<T>(
    scenarioName: string,
    trialIndex: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const { trialLifecycle } = this.options;
    if (trialLifecycle) {
      return trialLifecycle.runInScope(scenarioName, trialIndex, fn);
    }
    return fn();
  }

  /**
   * Executes a single trial: creates an agent client, runs lifecycle hooks,
   * runs the simulation, and tears down the client.
   */
  private async runSingleTrial(
    scenario: Scenario,
    trialIndex: number,
    makeAgentClient: (scenario?: Scenario) => Promise<AgentClient>,
    syntheticUser: SyntheticUserAgent,
    firstTurnInactivityMsOverride?: number,
    afterSimFailures?: Set<string>,
  ): Promise<Transcript> {
    const { siteCapture, config } = this.options;
    const client = await makeAgentClient(scenario);
    try {
      scenario.beforeTrial?.(client, trialIndex);
      for (const ev of scenario.evaluators) {
        ev.hookClient?.(client, trialIndex);
      }
      const { getTrialOutputDir } = this.options;
      const captureContext: SimulationCaptureContext | undefined =
        siteCapture && getTrialOutputDir
          ? {
            siteCapture,
            getTrialOutputDir: (idx: number) =>
              getTrialOutputDir(scenario.name, idx),
          }
          : undefined;
      const { writePartialTrial } = this.options;
      const onConversationComplete = writePartialTrial
        ? async (idx: number, partialTranscript: Transcript) => {
            try {
              await writePartialTrial(scenario.name, idx, partialTranscript);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                '[SuiteRunner] writePartialTrial failed for %s trial %d: %s',
                scenario.name, idx, msg,
              );
              this.options.onPartialWriteFailed?.(scenario.name, idx, err);
            }
          }
        : undefined;
      const transcript = await new Simulation({
        scenario,
        agentClient: client,
        syntheticUser,
        captureContext,
        config,
        maxTurnsOverride: this.options.maxTurnsOverride,
        firstTurnInactivityMsOverride,
        onConversationComplete,
      }).run(trialIndex);
      // Clear stale entries from prior retry attempts so a successful
      // retry does not inherit afterSimulation failures from earlier.
      for (const ev of scenario.evaluators) {
        afterSimFailures?.delete(`${ev.name}:${trialIndex}`);
      }
      for (const ev of scenario.evaluators) {
        try {
          ev.afterSimulation?.(trialIndex);
        } catch (err) {
          console.warn(
            'afterSimulation failed.',
            {
              evaluator: ev.name,
              scenarioName: scenario.name,
              trialIndex,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          afterSimFailures?.add(`${ev.name}:${trialIndex}`);
        }
      }
      return transcript;
    } finally {
      client.disconnect();
    }
  }

  /**
   * Runs a single trial inside its isolation scope, then unconditionally
   * unhooks evaluators and releases the trial lifecycle slot. Both
   * `runFanOut` and `processScenario` share this bracket.
   */
  private async executeTrialWithCleanup(
    scenario: Scenario,
    trialIndex: number,
    makeAgentClient: (scenario?: Scenario) => Promise<AgentClient>,
    syntheticUser: SyntheticUserAgent,
    afterSimFailures: Set<string>,
  ): Promise<TrialResult> {
    try {
      return await this.runInScope(scenario.name, trialIndex, async () => {
        const transcript = await this.runSingleTrialWithRetry(
          scenario,
          trialIndex,
          makeAgentClient,
          syntheticUser,
          afterSimFailures,
        );
        return this.evaluateTrial(scenario, transcript, trialIndex, afterSimFailures);
      });
    } finally {
      this.unhookAllEvaluators(scenario, trialIndex);
      this.options.trialLifecycle?.release(scenario.name, trialIndex);
    }
  }

  /**
   * Wraps runSingleTrial with retry logic for inactivity timeouts and
   * rate-limit (429) errors. Each failure mode has an independent budget.
   */
  private async runSingleTrialWithRetry(
    scenario: Scenario,
    trialIndex: number,
    makeAgentClient: (scenario?: Scenario) => Promise<AgentClient>,
    syntheticUser: SyntheticUserAgent,
    afterSimFailures?: Set<string>,
  ): Promise<Transcript> {
    const { config } = this.options;
    const maxRetries = config.eval.maxFirstTurnRetries;
    const retrySchedule = config.eval.firstTurnRetryScheduleMs;
    let inactivityAttempts = 0;
    let rateLimitAttempts = 0;
    let nextInactivityMsOverride: number | undefined;
    // Independent budgets: inactivity (AAB unresponsive) and rate-limit
    // (GoCode throttled) are orthogonal failure modes. Each gets its own
    // counter so one transient issue doesn't eat the other's budget.
    // Every iteration exits via return, continue, or throw err.
    for (;;) {
      try {
        const transcript = await this.runSingleTrial(scenario, trialIndex, makeAgentClient, syntheticUser, nextInactivityMsOverride, afterSimFailures);
        const totalRetries = inactivityAttempts + rateLimitAttempts;
        if (totalRetries > 0) {
          transcript.retryCount = totalRetries;
        }
        return transcript;
      } catch (err) {
        if (
          err instanceof InactivityTimeoutError &&
          inactivityAttempts < maxRetries
        ) {
          nextInactivityMsOverride =
            retrySchedule[inactivityAttempts]
            ?? config.eval.firstTurnInactivityMs;
          inactivityAttempts++;
          console.warn(
            'Trial retry: first-turn inactivity timeout.',
            {
              scenarioName: scenario.name,
              trialIndex,
              attempt: inactivityAttempts,
              maxAttempts: maxRetries,
              nextInactivityMs: nextInactivityMsOverride,
            },
          );
          this.unhookAllEvaluators(scenario, trialIndex);
          continue;
        }
        if (
          err instanceof RateLimitError &&
          rateLimitAttempts < MAX_RATE_LIMIT_RETRIES
        ) {
          rateLimitAttempts++;
          const waitMs = parseRetryAfterMs(err.headers) ?? RATE_LIMIT_WAIT_MS;
          console.warn(
            'Trial retry: rate limit (429).',
            {
              scenarioName: scenario.name,
              trialIndex,
              attempt: rateLimitAttempts,
              maxAttempts: MAX_RATE_LIMIT_RETRIES,
              waitSeconds: waitMs / 1000,
            },
          );
          await sleep(waitMs);
          this.unhookAllEvaluators(scenario, trialIndex);
          continue;
        }
        if (err instanceof RateLimitError) {
          console.warn(
            'Trial failed: rate-limit retry budget exhausted.',
            {
              scenarioName: scenario.name,
              trialIndex,
              totalAttempts: rateLimitAttempts + 1,
            },
          );
        }
        throw err;
      }
    }
  }

  private unhookFailures = 0;

  get unhookFailureCount(): number {
    return this.unhookFailures;
  }

  private unhookAllEvaluators(scenario: Scenario, trialIndex: number): void {
    for (const ev of scenario.evaluators) {
      try {
        ev.unhookTrial?.(trialIndex);
      } catch (err) {
        this.unhookFailures++;
        console.warn('unhookTrial threw.', {
          evaluator: ev.name,
          scenarioName: scenario.name,
          trialIndex,
          error: err instanceof Error ? err.message : String(err),
          totalUnhookFailures: this.unhookFailures,
        });
      }
    }
  }

  private async safeEvaluate(
    evaluator: Evaluator,
    transcript: Transcript,
    scenario: Scenario,
    snapshot: DOMSnapshot | undefined,
  ): Promise<EvalResult> {
    try {
      return normalizeEvalResult(
        await evaluator.evaluate(transcript, scenario, snapshot),
      );
    } catch (err) {
      console.error(
        'Evaluator threw during safe evaluation.',
        {
          evaluator: evaluator.name,
          error: err instanceof Error ? err : String(err),
        },
      );
      return normalizeEvalResult({
        evaluator: evaluator.name,
        score: 0,
        verdict: 'unknown',
        reason: err instanceof Error ? err.message : String(err),
        evaluatorFailed: true,
      });
    }
  }

  private async evaluateTrial(
    scenario: Scenario,
    transcript: Transcript,
    trialIndex: number,
    afterSimFailures?: Set<string>,
  ): Promise<TrialResult> {
    const snaps = transcript.snapshots;
    const lastSnapshot = snaps.length > 0
      ? snaps[snaps.length - 1]
      : undefined;

    const evalResults = await this.runInScope(scenario.name, trialIndex, () =>
      Promise.all(
        scenario.evaluators.map((evaluator) =>
          this.safeEvaluate(evaluator, transcript, scenario, lastSnapshot),
        ),
      ),
    );

    // Annotate eval results whose afterSimulation hook failed, signaling
    // potentially degraded measurements to downstream consumers.
    if (afterSimFailures && afterSimFailures.size > 0) {
      for (const result of evalResults) {
        if (afterSimFailures.has(`${result.evaluator}:${trialIndex}`)) {
          result.details = {
            ...result.details,
            afterSimulationFailed: true,
          };
        }
      }
    }

    const trialResult = { trialIndex, transcript, evalResults };
    try {
      this.options.onTrialEvaluated?.(scenario.name, trialResult);
    } catch (err) {
      console.error('onTrialEvaluated callback threw.', {
        scenarioName: scenario.name,
        trialIndex,
        error: err instanceof Error ? err : String(err),
      });
    }
    return trialResult;
  }
}
