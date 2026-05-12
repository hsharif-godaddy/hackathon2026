import { Simulation } from './simulation.js';
import type { SimulationCaptureContext } from './simulation.js';
import { TrialAggregator } from './trial-aggregator.js';
import { RegressionComparator } from '../baselines/regression-comparator.js';
import type { Scenario } from '../scenarios/types.js';
import type { ScenarioResult, TrialResult } from './types.js';
import type { Config } from '../../config/environments/types.js';
import type { AgentClient } from '../clients/agent-client.js';
import type { SyntheticUserAgent } from './synthetic-user.js';
import type { SiteCapture } from '../clients/dom-capture.js';
import type { DOMSnapshot, Transcript } from './transcript.js';
import type { BaselineScores } from '../baselines/types.js';
import type { EvalResult, Evaluator } from '../evaluators/evaluator.js';
import { normalizeEvalResult } from '../evaluators/normalize-eval-result.js';

interface BaselineStore {
  load(scenarioName: string): Promise<BaselineScores | null>;
}

type RuncappedError<T> = AggregateError & {
  partialResults: (T | undefined)[];
};

export async function runCapped<T>(
  count: number,
  cap: number,
  fn: (i: number) => Promise<T>,
): Promise<T[]> {
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
  config: Config;
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
   *   per-scenario `executionMode` still governs trial-level parallelism.
   * - `'parallel'`: all scenarios fan out concurrently, each forced
   *   to trial=1, capped by `config.eval.maxConcurrency`.
   */
  suiteMode?: 'sequential' | 'parallel';
  /**
   * When provided, overrides per-scenario `executionMode` for all
   * scenarios. Useful for graduation to force parallel trial execution
   * regardless of how individual scenarios are configured.
   */
  executionModeOverride?: 'parallel' | 'sequential';
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

    const mode =
      this.options.executionModeOverride
      ?? scenario.executionMode
      ?? 'sequential';
    const trialIndices = trialIndicesByScenario?.get(scenario.name)
      ?? Array.from({ length: k }, function index(_, i) {
        return i;
      });

    const makeRun = async (
      i: number,
    ): Promise<Transcript> => {
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

    const concurrency =
      concurrencyOverride
      ?? config.eval.maxConcurrency
      ?? 1;
    try {
      const transcripts: Transcript[] =
        mode === 'parallel'
          ? await runCapped(trialIndices.length, concurrency, function run(i) {
            return makeRun(trialIndices[i]);
          })
          : await this.runSequential(trialIndices, makeRun);

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

      if (baselineStore) {
        const baseline = await baselineStore.load(
          scenario.name,
        );
        if (baseline) {
          result.regressionStatus =
            this.comparator.compare(
              result,
              baseline,
              config.regression,
            );
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

  private async runSequential(
    trialIndices: number[],
    makeRun: (i: number) => Promise<Transcript>,
  ): Promise<Transcript[]> {
    const results: Transcript[] = [];
    for (const trialIndex of trialIndices) {
      results.push(await makeRun(trialIndex));
    }
    return results;
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
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return normalizeEvalResult({
        evaluator: evaluator.name,
        score: 0,
        verdict: 'unknown',
        reason: err instanceof Error ? err.message : String(err),
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
