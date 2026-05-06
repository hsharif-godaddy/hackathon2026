import { Simulation } from './simulation.js';
import { TrialAggregator } from './trial-aggregator.js';
import { RegressionComparator } from '../baselines/regression-comparator.js';
import type { Scenario } from '../scenarios/types.js';
import type { ScenarioResult, TrialResult } from './types.js';
import type { Config } from '../../config/environments/types.js';
import type { AgentClient } from '../clients/agent-client.js';
import type { SyntheticUserAgent } from './synthetic-user.js';
import type { DOMCapture } from '../clients/dom-capture.js';
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
  domCapture?: DOMCapture;
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
      domCapture,
      baselineStore,
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

    const mode =
      this.options.executionModeOverride
      ?? scenario.executionMode
      ?? 'sequential';

    const makeRun = async (
      i: number,
    ): Promise<Transcript> => {
       
      const client = await makeAgentClient();
      try {
        scenario.beforeTrial?.(client, i);
        for (const ev of scenario.evaluators) {
          ev.hookClient?.(client, i);
        }
        const transcript = await new Simulation({
          scenario,
          agentClient: client,
           
          syntheticUser,
          domCapture,
          config,
          maxTurnsOverride:
            this.options.maxTurnsOverride,
        }).run(i);
        for (const ev of scenario.evaluators) {
          try {
            ev.afterSimulation?.(i);
          } catch (err) {
            const msg: string = err instanceof Error ? err.message : String(err);
            // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
            console.warn(`afterSimulation failed for ${ev.name}: ${msg}`);
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
          ? await runCapped(k, concurrency, makeRun)
          : await this.runSequential(k, makeRun);

      const trialResults = await this.evaluateTrials(
        scenario,
        transcripts,
      );
      const result = this.aggregator.aggregate(
        scenario,
        trialResults,
      );

      if (baselineStore) {
        const baseline = await baselineStore.load(
          scenario.name,
        );
        result.regressionStatus =
          this.comparator.compare(
            result,
            baseline,
            config.regression,
          );
      }

      return result;
    } finally {
      for (let i = 0; i < k; i++) {
        for (const ev of scenario.evaluators) {
          ev.unhookTrial?.(i);
        }
      }
    }
  }

  private async runSequential(
    k: number,
    makeRun: (i: number) => Promise<Transcript>,
  ): Promise<Transcript[]> {
    const results: Transcript[] = [];
    for (let i = 0; i < k; i++) {
      results.push(await makeRun(i));
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
      const msg: string = err instanceof Error ? err.message : String(err);
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      console.warn(`safeEvaluate: evaluator "${evaluator.name}" threw: ${msg}`);
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
  ): Promise<TrialResult[]> {
    const trialResults: TrialResult[] = [];

    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];

      // Outer trial loop stays sequential: trial 0 must complete so
      // deterministic results are cached before later trials read them.
      const snaps = transcript.snapshots;
      const lastSnapshot = snaps.length > 0
        ? snaps[snaps.length - 1]
        : undefined;

      const evalResults = await Promise.all(
        scenario.evaluators.map((evaluator) => {
          if (evaluator.deterministic && i > 0) {
            const cached = trialResults[0].evalResults.find(
              (r) => r.evaluator === evaluator.name,
            );
            if (cached) return Promise.resolve(cached);
          }
          return this.safeEvaluate(
            evaluator, transcript, scenario, lastSnapshot,
          );
        }),
      );

      const trialResult = { trialIndex: i, transcript, evalResults };
      trialResults.push(trialResult);
      this.options.onTrialEvaluated?.(scenario.name, trialResult);
    }

    return trialResults;
  }
}
