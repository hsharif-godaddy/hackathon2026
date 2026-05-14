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

interface BaselineStore {
  load(scenarioName: string): Promise<BaselineScores | null>;
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
  concurrencyOverride?: number;
  maxTurnsOverride?: number;
  /** When provided, load baseline and attach regressionStatus. */
  baselineStore?: BaselineStore;
  /**
   * Controls how scenarios are executed relative to each other.
   * - `'sequential'` (default): scenarios run one after another;
   *   trial-level parallelism is governed by `config.eval.maxConcurrency`.
   * - `'parallel'`: all scenarios fan out concurrently, each forced
   *   to trial=1, capped by `config.eval.maxConcurrency`.
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
}

export class SuiteRunner {
  private readonly aggregator = new TrialAggregator();
  private readonly comparator = new RegressionComparator();

  constructor(private readonly options: SuiteRunnerOptions) {}

  async run(): Promise<ScenarioResult[]> {
    const { scenarios, config, trialsOverride, suiteMode } = this.options;

    if (suiteMode === 'parallel') {
      // Scenario-level fan-out uses config.eval.maxConcurrency (hard ceiling).
      // concurrencyOverride intentionally controls only trial-level parallelism
      // within each scenario, not the outer scenario fan-out.
      return runCapped(
        scenarios.length,
        config.eval.maxConcurrency ?? 1,
        (i) => this.processScenario(scenarios[i], 1),
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
      concurrencyOverride,
      makeAgentClient,
      syntheticUser,
      siteCapture,
      baselineStore,
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
        const transcript = await new Simulation({
          scenario,
          agentClient: client,
          syntheticUser,
          captureContext,
          config,
          maxTurnsOverride: this.options.maxTurnsOverride,
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
    const makeRunWithRetry = async (
      trialIndex: number,
    ): Promise<Transcript> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const transcript = await makeRun(trialIndex);
          if (attempt > 0) {
            transcript.retryCount = attempt;
          }
          return transcript;
        } catch (err) {
          if (
            err instanceof InactivityTimeoutError &&
            attempt < maxRetries
          ) {
            console.warn(
              'Trial retry: first-turn inactivity timeout.',
              {
                scenarioName: scenario.name,
                trialIndex,
                attempt: attempt + 1,
                maxAttempts: maxRetries + 1,
              },
            );
            continue;
          }
          throw err;
        }
      }
      throw new Error(
        `[${scenario.name}] Trial ${trialIndex}: retry loop exited unexpectedly`,
      );
    };

    const concurrency = effectiveConcurrency(concurrencyOverride, config.eval.maxConcurrency);
    try {
      const transcripts: Transcript[] =
        await runCapped(trialIndices.length, concurrency, function run(i) {
          return makeRunWithRetry(trialIndices[i]);
        });

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
        const baseline = await baselineStore.load(
          scenario.name,
        );
        if (baseline) {
          const regressionStatus = this.comparator.compare(
            result,
            baseline,
            config.regression,
          );
          const enrichedAggregated = enrichScoreModePassRates(
            result,
            baseline,
            config.regression,
          );
          result.regressionStatus = regressionStatus;
          result.aggregated = enrichedAggregated;
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
