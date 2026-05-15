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
import { sleep } from '../util/sleep.js';
import { staggeredRun } from '../util/stagger.js';

// Fallback wait when the server omits Retry-After. Promote to config
// if per-environment tuning becomes necessary (e.g. CI wants fewer retries).
const RATE_LIMIT_WAIT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 10;
const MAX_RETRY_WAIT_MS = 300_000; // 5 min cap per-sleep to guard against absurd server values

function parseRetryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

interface BaselineStore {
  load(scenarioName: string): Promise<{ scores: BaselineScores; filePath: string } | null>;
  loadByRunId(scenarioName: string, runId: string): Promise<{ scores: BaselineScores; filePath: string } | null>;
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
  /** Per-trial async factory; each Simulation owns its connection. */
  makeAgentClient?: () => Promise<AgentClient>;
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
   * Controls how scenarios are executed relative to each other.
   * - `'sequential'` (default): scenarios run one after another;
   *   trial-level parallelism is governed by `config.eval.maxConcurrency`.
   * - `'parallel'`: all scenarios fan out concurrently, each running its
   *   full trial count. Scenario concurrency is capped by
   *   `scenarioConcurrency` if provided, otherwise
   *   `config.eval.maxConcurrency`.
   */
  suiteMode?: 'sequential' | 'parallel';
  /** Fires after each trial is evaluated. */
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
}

export class SuiteRunner {
  private readonly aggregator = new TrialAggregator();
  private readonly comparator = new RegressionComparator();

  constructor(private readonly options: SuiteRunnerOptions) {}

  async run(): Promise<ScenarioResult[]> {
    const { scenarios, config, trialsOverride, suiteMode } = this.options;

    if (suiteMode === 'parallel') {
      // scenarioConcurrency (from --concurrency) caps scenario fan-out;
      // falls back to config.eval.maxConcurrency when omitted.
      const cap = effectiveConcurrency(
        this.options.scenarioConcurrency,
        config.eval.maxConcurrency,
      );
      return runCapped(
        scenarios.length,
        cap,
        (i) => staggeredRun(i, cap, () =>
          this.processScenario(scenarios[i], trialsOverride ?? scenarios[i].trials),
        ),
      );
    }

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      const k = trialsOverride ?? scenario.trials;
      results.push(await this.processScenario(scenario, k));
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
      siteCapture,
      baselineStore,
      baselineRunId,
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

    const makeRun = async (
      i: number,
      firstTurnInactivityMsOverride?: number,
    ): Promise<Transcript> => {
      const client = await makeAgentClient();
      try {
        scenario.beforeTrial?.(client, i);
        for (const ev of scenario.evaluators) {
          ev.hookClient?.(client, i);
        }
        const { getTrialOutputDir } = this.options;
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
        const captureContext: SimulationCaptureContext | undefined =
          siteCapture && getTrialOutputDir
            ? {
              siteCapture,
              getTrialOutputDir: (trialIndex: number) =>
                getTrialOutputDir(scenario.name, trialIndex),
            }
            : undefined;
        const { writePartialTrial } = this.options;
        const onConversationComplete = writePartialTrial
          ? async (trialIndex: number, partialTranscript: Transcript) => {
              try {
                await writePartialTrial(scenario.name, trialIndex, partialTranscript);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(
                  '[SuiteRunner] writePartialTrial failed for %s trial %d: %s',
                  scenario.name, trialIndex, msg,
                );
                this.options.onPartialWriteFailed?.(scenario.name, trialIndex, err);
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
        }).run(i);
        for (const ev of scenario.evaluators) {
          try {
            ev.afterSimulation?.(i);
          } catch (err) {
            console.warn(
              'afterSimulation failed.',
              {
                evaluator: ev.name,
                scenarioName: scenario.name,
                trialIndex: i,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }
        return transcript;
      } finally {
        client.disconnect();
      }
    };

    const maxRetries = config.eval.maxFirstTurnRetries;
    const retrySchedule = config.eval.firstTurnRetryScheduleMs;
    const makeRunWithRetry = async (
      trialIndex: number,
    ): Promise<Transcript> => {
      let inactivityAttempts = 0;
      let rateLimitAttempts = 0;
      let nextInactivityMsOverride: number | undefined;
      // Independent budgets: inactivity (AAB unresponsive) and rate-limit
      // (GoCode throttled) are orthogonal failure modes. Each gets its own
      // counter so one transient issue doesn't eat the other's budget.
      // Every iteration exits via return, continue, or throw err.
      for (;;) {
        try {
          const transcript = await makeRun(trialIndex, nextInactivityMsOverride);
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
    };

    const concurrency = effectiveConcurrency(trialConcurrency, config.eval.maxConcurrency);
    try {
      const transcripts: Transcript[] =
        await runCapped(trialIndices.length, concurrency, (i) =>
          staggeredRun(i, concurrency, () => makeRunWithRetry(trialIndices[i])),
        );

      const newTrialResults = await this.evaluateTrials(
        scenario,
        transcripts,
        trialIndices,
      );
      const trialResults = [
        ...(existingTrialsByScenario?.get(scenario.name) ?? []),
        ...newTrialResults,
      ].sort((a, b) => a.trialIndex - b.trialIndex);
      const result = this.aggregator.aggregate(
        scenario,
        trialResults,
      );

      // Ordering contract: the comparator reads result.aggregated FIRST to
      // detect score regressions, then enrichScoreModePassRates produces a
      // NEW aggregated record with passAtK/passToTheK derived from per-trial
      // baseline comparison. The enriched record replaces result.aggregated
      // AFTER the comparator finishes. The comparator must see the raw
      // aggregated state (without passAtK), and downstream consumers
      // (reporter, store) see the enriched version.
      if (baselineStore) {
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
          const enrichedAggregated = enrichScoreModePassRates(
            result,
            loaded.scores,
            config.regression,
          );
          result.regressionStatus = regressionStatus;
          result.aggregated = enrichedAggregated;
          result.baselineFilePath = loaded.filePath;
        }
      }

      return result;
    } finally {
      for (const trialIndex of trialIndices) {
        for (const ev of scenario.evaluators) {
          ev.unhookTrial?.(trialIndex);
        }
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

  private async evaluateTrials(
    scenario: Scenario,
    transcripts: Transcript[],
    trialIndices: number[],
  ): Promise<TrialResult[]> {
    const trialResults: TrialResult[] = [];

    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      const trialIndex = trialIndices[i];

      const snaps = transcript.snapshots;
      const lastSnapshot = snaps.length > 0
        ? snaps[snaps.length - 1]
        : undefined;

      const evalResults = await Promise.all(
        scenario.evaluators.map((evaluator) =>
          this.safeEvaluate(evaluator, transcript, scenario, lastSnapshot),
        ),
      );

      const trialResult = { trialIndex, transcript, evalResults };
      trialResults.push(trialResult);
      this.options.onTrialEvaluated?.(scenario.name, trialResult);
    }

    return trialResults.sort((a, b) => a.trialIndex - b.trialIndex);
  }
}
