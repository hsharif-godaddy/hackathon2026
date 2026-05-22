import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvalStore } from '../../store/eval-store.js';

const { mockGraduationRunnerRun } = vi.hoisted(() => ({
  mockGraduationRunnerRun: vi.fn(),
}));

vi.mock('../graduation-runner.js', () => ({
  GraduationRunner: vi.fn().mockImplementation(() => ({
    run: mockGraduationRunnerRun,
  })),
  isDeferredResult: (r: { scenarioResult?: unknown }) => r.scenarioResult !== undefined,
}));

const { mockRunCapped, mockSuiteRunnerRun } = vi.hoisted(() => ({
  mockRunCapped: vi.fn(),
  mockSuiteRunnerRun: vi.fn(),
}));

vi.mock('../../runner/suite-runner.js', () => ({
  runCapped: mockRunCapped,
  SuiteRunner: vi.fn().mockImplementation(() => ({
    run: mockSuiteRunnerRun,
  })),
}));

vi.mock('../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { GraduationSuiteRunner } from '../graduation-suite-runner.js';
import type { GraduationSuiteRunResult } from '../graduation-suite-runner.js';
import { GraduationRunner } from '../graduation-runner.js';
import { SuiteRunner } from '../../runner/suite-runner.js';
import { sleep } from '../../util/sleep.js';
import type { GraduationResult } from '../graduation-runner.js';
import type { RuncappedError, SuiteRunnerOptions } from '../../runner/suite-runner.js';
import type { Scenario } from '../../scenarios/types.js';
import type { ResolvedConfig } from '../../../config/index.js';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type { Transcript } from '../../runner/transcript.js';
import type { TrialLifecycle } from '../../clients/trial-lifecycle.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScenario(name: string, overrides?: Partial<Scenario>): Scenario {
  return {
    name,
    persona: { name: 'test', description: 'test persona', systemPrompt: 'test' },
    goals: [{ description: 'goal', assertion: 'positive' }],
    evaluators: [],
    trials: 3,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    env: 'local.dev',
    aab: { socketUrl: 'ws://localhost:4000', bffUrl: 'http://localhost:3000', controlPlaneUrl: 'http://localhost:4100' },
    gocode: { baseUrl: 'http://localhost', apiKey: 'key', model: 'test' },
    eval: { defaultTrials: 3, maxTurns: 30, turnTimeoutMs: 30000, maxConcurrency: 2, firstTurnInactivityMs: 600_000, firstTurnRetryScheduleMs: [600_000, 120_000, 120_000, 120_000], maxFirstTurnRetries: 2 },
    playwright: { ignoreHttpsErrors: true },
    regression: { defaultThreshold: 0.25, thresholds: {} },
    ...overrides,
  };
}

function makeGraduationResult(
  scenarioName: string,
  overrides?: Partial<GraduationResult>,
): GraduationResult {
  return {
    scenarioName,
    stabilityLevel: 'low',
    stabilityTrials: 3,
    baselineSaved: true,
    scenarioResult: {
      scenarioName,
      stabilityLevel: 'low',
      trials: [],
      aggregated: {},
    },
    ...overrides,
  };
}

function makeMockStore(): EvalStore {
  return {
    initRun: vi.fn().mockResolvedValue('20260513_abc123'),
    finalizeRun: vi.fn().mockResolvedValue('runs/20260513_abc123'),
    loadRunMetadataByDirName: vi.fn().mockResolvedValue(null),
    writeTrial: vi.fn().mockResolvedValue(undefined),
    writePartialTrial: vi.fn().mockResolvedValue(undefined),
    ensureTrialDir: vi.fn().mockResolvedValue('/tmp/trial'),
    prune: vi.fn().mockResolvedValue([]),
  } as unknown as EvalStore;
}

function makeTranscript(scenarioName = 'test', trialIndex = 0): Transcript {
  return { scenarioName, trialIndex, turns: [], snapshots: [], errors: [] };
}

function makeTrialResult(overrides?: Partial<TrialResult>): TrialResult {
  return {
    trialIndex: 0,
    transcript: makeTranscript(),
    evalResults: [{ evaluator: 'test', score: 1, verdict: 'pass', reason: 'ok' }],
    ...overrides,
  };
}

function makeScenarioResult(
  scenarioName: string,
  overrides?: Partial<ScenarioResult>,
): ScenarioResult {
  return {
    scenarioName,
    stabilityLevel: 'low',
    trials: [makeTrialResult()],
    aggregated: {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GraduationSuiteRunner', () => {
  let store: ReturnType<typeof makeMockStore>;
  let config: ResolvedConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeMockStore();
    config = makeConfig();
  });

  it('calls store.initRun once with correct arguments', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    mockRunCapped.mockResolvedValue([
      makeGraduationResult('alpha'),
      makeGraduationResult('beta'),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const runId = 'run-123';
    await runner.run(runId);

    expect(store.initRun).toHaveBeenCalledOnce();
    expect(store.initRun).toHaveBeenCalledWith(
      runId,
      scenarios,
      config,
      {
        concurrencyOverride: 1,
        maxTurnsOverride: undefined,
        kind: 'graduation',
      },
    );
  });

  it('fans out scenarios concurrently via runCapped', async () => {
    const scenarios = [
      makeScenario('alpha'),
      makeScenario('beta'),
      makeScenario('gamma'),
    ];
    const results = scenarios.map((s) => makeGraduationResult(s.name));
    mockRunCapped.mockResolvedValue(results);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    await runner.run('run-456');

    expect(mockRunCapped).toHaveBeenCalledOnce();
    expect(mockRunCapped).toHaveBeenCalledWith(
      3,
      2, // config.eval.maxConcurrency
      expect.any(Function),
    );
  });

  it('uses explicit scenarioConcurrency=1 over config.eval.maxConcurrency', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const results = scenarios.map((s) => makeGraduationResult(s.name));
    mockRunCapped.mockResolvedValue(results);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      scenarioConcurrency: 1,
    });

    await runner.run('run-seq');

    expect(mockRunCapped).toHaveBeenCalledWith(
      2,
      1, // explicit scenarioConcurrency takes precedence
      expect.any(Function),
    );
  });

  it('falls back to config.eval.maxConcurrency when scenarioConcurrency is undefined', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const results = scenarios.map((s) => makeGraduationResult(s.name));
    mockRunCapped.mockResolvedValue(results);

    const customConfig = makeConfig({
      eval: { defaultTrials: 3, maxTurns: 30, turnTimeoutMs: 30000, firstTurnInactivityMs: 30000, firstTurnRetryScheduleMs: [600_000, 120_000, 120_000, 120_000], maxFirstTurnRetries: 2, maxConcurrency: 5 },
    });

    const runner = new GraduationSuiteRunner({
      scenarios,
      config: customConfig,
      store,
      scenarioConcurrency: undefined,
    });

    await runner.run('run-fallback');

    expect(mockRunCapped).toHaveBeenCalledWith(
      2,
      5, // falls back to config.eval.maxConcurrency
      expect.any(Function),
    );
  });

  it('calls store.finalizeRun on success with all scenarioResults', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const scenarioResultAlpha: ScenarioResult = {
      scenarioName: 'alpha',
      stabilityLevel: 'low',
      trials: [],
      aggregated: {},
    };
    const scenarioResultBeta: ScenarioResult = {
      scenarioName: 'beta',
      stabilityLevel: 'low',
      trials: [],
      aggregated: {},
    };
    const results = [
      makeGraduationResult('alpha', { scenarioResult: scenarioResultAlpha }),
      makeGraduationResult('beta', { scenarioResult: scenarioResultBeta }),
    ];
    mockRunCapped.mockResolvedValue(results);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    await runner.run('run-789');

    expect(store.finalizeRun).toHaveBeenCalledOnce();
    expect(store.finalizeRun).toHaveBeenCalledWith(
      '20260513_abc123',
      'run-789',
      [scenarioResultAlpha, scenarioResultBeta],
      'graduation',
    );
  });

  it('returns all GraduationResults on success with empty errors', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const results = [
      makeGraduationResult('alpha'),
      makeGraduationResult('beta'),
    ];
    mockRunCapped.mockResolvedValue(results);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-abc');
    expect(output.results).toEqual(results);
    expect(output.errors).toEqual([]);
  });

  it('on partial failure: finalizes completed scenarios and returns structured result', async () => {
    const scenarios = [
      makeScenario('alpha'),
      makeScenario('beta'),
      makeScenario('gamma'),
    ];

    const completedResult = makeGraduationResult('alpha', {
      scenarioResult: { scenarioName: 'alpha', stabilityLevel: 'low', trials: [], aggregated: {} },
    });
    const gammaResult = makeGraduationResult('gamma', {
      scenarioResult: { scenarioName: 'gamma', stabilityLevel: 'low', trials: [], aggregated: {} },
    });

    const partialResults: (GraduationResult | undefined)[] = [
      completedResult,
      undefined, // beta failed
      gammaResult,
    ];

    const betaError = new Error('beta scenario exploded');
    const aggError = new AggregateError(
      [betaError],
      '1 of 3 tasks failed',
    ) as RuncappedError<GraduationResult>;
    aggError.partialResults = partialResults;

    mockRunCapped.mockRejectedValue(aggError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-partial');

    expect(output.results).toEqual([completedResult, gammaResult]);
    expect(output.errors).toEqual([betaError]);

    expect(store.finalizeRun).toHaveBeenCalledOnce();
    expect(store.finalizeRun).toHaveBeenCalledWith(
      '20260513_abc123',
      'run-partial',
      [completedResult.scenarioResult, gammaResult.scenarioResult],
      'graduation',
    );
  });

  it('on partial failure: skips finalizeRun when no scenarios completed', async () => {
    const scenarios = [makeScenario('alpha')];

    const partialResults: (GraduationResult | undefined)[] = [undefined];
    const alphaError = new Error('alpha failed');
    const aggError = new AggregateError(
      [alphaError],
      '1 of 1 tasks failed',
    ) as RuncappedError<GraduationResult>;
    aggError.partialResults = partialResults;

    mockRunCapped.mockRejectedValue(aggError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-empty');

    expect(output.results).toEqual([]);
    expect(output.errors).toEqual([alphaError]);
    expect(store.finalizeRun).not.toHaveBeenCalled();
  });

  it('re-throws non-AggregateError without finalizing', async () => {
    const scenarios = [makeScenario('alpha')];
    const genericError = new Error('unexpected failure');
    mockRunCapped.mockRejectedValue(genericError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    await expect(runner.run('run-err')).rejects.toThrow('unexpected failure');
    expect(store.finalizeRun).not.toHaveBeenCalled();
  });

  it('passes trialConcurrency to GraduationRunner', async () => {
    const scenarios = [makeScenario('alpha')];
    mockRunCapped.mockImplementation(
      async (_count: number, _cap: number, fn: (i: number) => Promise<GraduationResult>) => {
        return [await fn(0)];
      },
    );
    mockGraduationRunnerRun.mockResolvedValue(makeGraduationResult('alpha'));

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      trialConcurrency: 1,
    });

    await runner.run('run-conc');

    expect(GraduationRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        trialConcurrency: 1,
        dirName: '20260513_abc123',
        skipFinalize: true,
      }),
    );
  });

  it('passes stabilityLevelOverride and maxTurnsOverride through', async () => {
    const scenarios = [makeScenario('alpha')];
    mockRunCapped.mockImplementation(
      async (_count: number, _cap: number, fn: (i: number) => Promise<GraduationResult>) => {
        return [await fn(0)];
      },
    );
    mockGraduationRunnerRun.mockResolvedValue(makeGraduationResult('alpha'));

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      stabilityLevelOverride: 'high',
      maxTurnsOverride: 15,
    });

    await runner.run('run-opts');

    expect(GraduationRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        stabilityLevelOverride: 'high',
        maxTurnsOverride: 15,
      }),
    );
  });

  it('creates a new BaselineStore for each scenario', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    mockRunCapped.mockImplementation(
      async (count: number, _cap: number, fn: (i: number) => Promise<GraduationResult>) => {
        const results: GraduationResult[] = [];
        for (let i = 0; i < count; i++) {
          results.push(await fn(i));
        }
        return results;
      },
    );
    mockGraduationRunnerRun
      .mockResolvedValueOnce(makeGraduationResult('alpha'))
      .mockResolvedValueOnce(makeGraduationResult('beta'));

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    await runner.run('run-stores');

    // GraduationRunner constructed twice, each with distinct baselineStore
    expect(GraduationRunner).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(GraduationRunner).mock.calls[0][0];
    const secondCall = vi.mocked(GraduationRunner).mock.calls[1][0];
    expect(firstCall.baselineStore).not.toBe(secondCall.baselineStore);
  });

  it('does not call finalizeRun when all scenarioResults are undefined', async () => {
    const scenarios = [makeScenario('alpha')];
    const resultWithoutScenarioResult = makeGraduationResult('alpha', {
      scenarioResult: undefined,
    });
    mockRunCapped.mockResolvedValue([resultWithoutScenarioResult]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    await runner.run('run-no-scen');
    expect(store.finalizeRun).not.toHaveBeenCalled();
  });

  it('returns completed results and errors on partial failure', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const completedResult = makeGraduationResult('alpha', {
      scenarioResult: { scenarioName: 'alpha', stabilityLevel: 'low', trials: [], aggregated: {} },
    });
    const partialResults: (GraduationResult | undefined)[] = [
      completedResult,
      undefined,
    ];

    const betaError = new Error('beta failed');
    const aggError = new AggregateError(
      [betaError],
      '1 of 2 tasks failed',
    ) as RuncappedError<GraduationResult>;
    aggError.partialResults = partialResults;

    mockRunCapped.mockRejectedValue(aggError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-attach');
    expect(output.results).toEqual([completedResult]);
    expect(output.errors).toEqual([betaError]);
  });

  it('returns finalizationError when finalizeRun rejects on success path', async () => {
    const scenarios = [makeScenario('alpha')];
    const result = makeGraduationResult('alpha', {
      scenarioResult: { scenarioName: 'alpha', stabilityLevel: 'low', trials: [], aggregated: {} },
    });
    mockRunCapped.mockResolvedValue([result]);

    const finalizeError = new Error('finalize boom');
    store.finalizeRun = vi.fn().mockRejectedValue(finalizeError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-fin-err');

    expect(output.results).toEqual([result]);
    expect(output.errors).toEqual([]);
    expect(output.finalizationError).toEqual(finalizeError);
  });

  it('returns both errors and finalizationError on partial failure with finalize rejection', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const completedResult = makeGraduationResult('alpha', {
      scenarioResult: { scenarioName: 'alpha', stabilityLevel: 'low', trials: [], aggregated: {} },
    });
    const partialResults: (GraduationResult | undefined)[] = [completedResult, undefined];

    const betaError = new Error('beta failed');
    const aggError = new AggregateError(
      [betaError],
      '1 of 2 tasks failed',
    ) as RuncappedError<GraduationResult>;
    aggError.partialResults = partialResults;

    mockRunCapped.mockRejectedValue(aggError);

    const finalizeError = new Error('finalize also boom');
    store.finalizeRun = vi.fn().mockRejectedValue(finalizeError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-double-err');

    expect(output.results).toEqual([completedResult]);
    expect(output.errors).toEqual([betaError]);
    expect(output.finalizationError).toEqual(finalizeError);
  });

  it('returns undefined finalizationError on partial failure when finalize succeeds', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const completedResult = makeGraduationResult('alpha', {
      scenarioResult: { scenarioName: 'alpha', stabilityLevel: 'low', trials: [], aggregated: {} },
    });
    const partialResults: (GraduationResult | undefined)[] = [completedResult, undefined];

    const betaError = new Error('beta failed');
    const aggError = new AggregateError(
      [betaError],
      '1 of 2 tasks failed',
    ) as RuncappedError<GraduationResult>;
    aggError.partialResults = partialResults;

    mockRunCapped.mockRejectedValue(aggError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
    });

    const output: GraduationSuiteRunResult = await runner.run('run-partial-ok-fin');

    expect(output.results).toEqual([completedResult]);
    expect(output.errors).toEqual([betaError]);
    expect(output.finalizationError).toBeUndefined();
  });

  it('staggered init: sleep called with (i % maxConcurrency) * 1000 per scenario slot', async () => {
    // Un-mock runCapped for this test only so the real work-stealing loop
    // executes and the stagger sleeps are actually invoked. GraduationRunner
    // stays mocked so no real evals run.
    const { runCapped: realRunCapped } =
      await vi.importActual<typeof import('../../runner/suite-runner.js')>('../../runner/suite-runner.js');
    mockRunCapped.mockImplementation(realRunCapped);

    mockGraduationRunnerRun.mockResolvedValue(makeGraduationResult('scenario'));

    const scenarios = [
      makeScenario('alpha'),
      makeScenario('beta'),
      makeScenario('gamma'),
    ];
    const staggerConfig: ResolvedConfig = {
      ...config,
      eval: { ...config.eval, maxConcurrency: 3 },
    };

    const runner = new GraduationSuiteRunner({
      scenarios,
      config: staggerConfig,
      store,
    });

    await runner.run('run-stagger');

    // Slot 0 (delay=0) is guarded — sleep is not called for zero-delay slots.
    expect(sleep).not.toHaveBeenCalledWith(0);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  describe('onTrialEvaluated forwarding', () => {
    it('forwards onTrialEvaluated to GraduationRunner when provided', async () => {
      const scenarios = [makeScenario('alpha')];
      const onTrialEvaluated = vi.fn();
      mockRunCapped.mockImplementation(
        async (_count: number, _cap: number, fn: (i: number) => Promise<GraduationResult>) => {
          return [await fn(0)];
        },
      );
      mockGraduationRunnerRun.mockResolvedValue(makeGraduationResult('alpha'));

      const runner = new GraduationSuiteRunner({
        scenarios,
        config,
        store,
        onTrialEvaluated,
      });
      await runner.run('run-cb-suite');

      expect(GraduationRunner).toHaveBeenCalledWith(
        expect.objectContaining({ onTrialEvaluated }),
      );
    });

    it('does not pass onTrialEvaluated to GraduationRunner when omitted', async () => {
      const scenarios = [makeScenario('alpha')];
      mockRunCapped.mockImplementation(
        async (_count: number, _cap: number, fn: (i: number) => Promise<GraduationResult>) => {
          return [await fn(0)];
        },
      );
      mockGraduationRunnerRun.mockResolvedValue(makeGraduationResult('alpha'));

      const runner = new GraduationSuiteRunner({
        scenarios,
        config,
        store,
      });
      await runner.run('run-no-cb-suite');

      expect(GraduationRunner).toHaveBeenCalledWith(
        expect.not.objectContaining({ onTrialEvaluated: expect.anything() }),
      );
    });
  });
});

describe('GraduationSuiteRunner — suiteMode: parallel', () => {
  let store: ReturnType<typeof makeMockStore>;
  let config: ResolvedConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeMockStore();
    config = makeConfig();
    mockSuiteRunnerRun.mockResolvedValue([]);
  });

  it('uses SuiteRunner in parallel mode instead of GraduationRunner', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    mockSuiteRunnerRun.mockResolvedValue([
      makeScenarioResult('alpha'),
      makeScenarioResult('beta'),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      scenarioConcurrency: 2,
    });

    await runner.run('run-parallel');

    expect(SuiteRunner).toHaveBeenCalledWith(
      expect.objectContaining({ suiteMode: 'parallel' }),
    );
    expect(GraduationRunner).not.toHaveBeenCalled();
    expect(mockRunCapped).not.toHaveBeenCalled();
  });

  it('applies stability trial counts as scenario.trials overrides', async () => {
    const scenarios = [
      makeScenario('alpha', { stabilityLevel: 'low' }),   // 3 trials
      makeScenario('beta', { stabilityLevel: 'high' }),    // 10 trials
    ];
    mockSuiteRunnerRun.mockResolvedValue([
      makeScenarioResult('alpha'),
      makeScenarioResult('beta'),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    await runner.run('run-stability');

    const [call] = vi.mocked(SuiteRunner).mock.calls;
    const passedScenarios = (call[0] as { scenarios: Scenario[] }).scenarios;
    expect(passedScenarios.find((s) => s.name === 'alpha')?.trials).toBe(3);
    expect(passedScenarios.find((s) => s.name === 'beta')?.trials).toBe(10);
  });

  it('saves baseline for each scenario with valid results', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const mockBaselineStore = { save: vi.fn().mockResolvedValue(undefined) };
    mockSuiteRunnerRun.mockResolvedValue([
      makeScenarioResult('alpha'),
      makeScenarioResult('beta'),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      baselineStoreFactory: () => mockBaselineStore as never,
    });

    await runner.run('run-baseline');

    expect(mockBaselineStore.save).toHaveBeenCalledTimes(2);
    expect(mockBaselineStore.save).toHaveBeenCalledWith(
      'run-baseline',
      expect.objectContaining({ scenarioName: 'alpha' }),
      expect.objectContaining({ defaultThreshold: config.regression.defaultThreshold }),
    );
  });

  it('skips baseline save when all trial verdicts are unknown', async () => {
    const scenarios = [makeScenario('alpha')];
    const mockBaselineStore = { save: vi.fn() };
    mockSuiteRunnerRun.mockResolvedValue([
      makeScenarioResult('alpha', {
        trials: [makeTrialResult({ evalResults: [{ evaluator: 'test', score: 0, verdict: 'unknown', reason: '' }] })],
      }),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      baselineStoreFactory: () => mockBaselineStore as never,
    });

    await runner.run('run-unknown');

    expect(mockBaselineStore.save).not.toHaveBeenCalled();
  });

  it('writes trials to store for each scenario', async () => {
    const scenarios = [makeScenario('alpha')];
    const trial = makeTrialResult({ trialIndex: 0 });
    mockSuiteRunnerRun.mockResolvedValue([
      makeScenarioResult('alpha', { trials: [trial] }),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    await runner.run('run-write');

    expect(store.writeTrial).toHaveBeenCalledWith(
      '20260513_abc123',
      'alpha',
      trial,
    );
  });

  it('calls finalizeRun with all scenario results', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const alphaResult = makeScenarioResult('alpha');
    const betaResult = makeScenarioResult('beta');
    mockSuiteRunnerRun.mockResolvedValue([alphaResult, betaResult]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    await runner.run('run-finalize');

    expect(store.finalizeRun).toHaveBeenCalledWith(
      '20260513_abc123',
      'run-finalize',
      expect.arrayContaining([alphaResult, betaResult]),
      'graduation',
    );
  });

  it('returns GraduationResult[] with correct stabilityLevel and baselineSaved', async () => {
    const scenarios = [makeScenario('alpha', { stabilityLevel: 'medium' })];
    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha')]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    const output = await runner.run('run-result');

    expect(output.errors).toEqual([]);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({
      scenarioName: 'alpha',
      stabilityLevel: 'medium',
      stabilityTrials: 5,
      baselineSaved: true,
    });
  });

  it('logRunHeader shows round-robin banner for parallel mode', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta'), makeScenario('gamma')];
    mockSuiteRunnerRun.mockResolvedValue(scenarios.map((s) => makeScenarioResult(s.name)));

    const logSpy = vi.fn();
    const runner = new GraduationSuiteRunner({
      scenarios,
      config: makeConfig({ eval: { ...config.eval, maxConcurrency: 3 } }),
      store,
      suiteMode: 'parallel',
      scenarioConcurrency: 2,
      log: logSpy,
    });

    await runner.run('run-banner');

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string);
    expect(allLogs.some((m) => m.includes('round-robin'))).toBe(true);
    expect(allLogs.every((m) => !m.includes('1 trial at a time'))).toBe(true);
  });

  it('forwards trialLifecycle to SuiteRunner in parallel mode', async () => {
    const scenarios = [makeScenario('alpha')];
    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha')]);

    const trialLifecycle: TrialLifecycle = {
      runInScope: vi.fn().mockImplementation((_, __, fn: () => Promise<unknown>) => fn()),
      release: vi.fn(),
    };

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      trialLifecycle,
    });

    await runner.run('run-trial-lifecycle');

    expect(SuiteRunner).toHaveBeenCalledWith(
      expect.objectContaining({ trialLifecycle }),
    );
  });

  it('detects missing scenarios from partial SuiteRunner results and adds to errors', async () => {
    // SuiteRunner returns only alpha (beta had 0 trials — absent from results)
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const alphaResult = makeScenarioResult('alpha');
    mockSuiteRunnerRun.mockResolvedValue([alphaResult]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    const output = await runner.run('run-missing-beta');

    expect(output.results).toHaveLength(1);
    expect(output.results[0].scenarioName).toBe('alpha');
    expect(output.errors).toHaveLength(1);
    expect(output.errors[0].message).toContain('beta');
    expect(output.finalizationError).toBeUndefined();
  });

  it('all scenarios absent from SuiteRunner results: results empty, one error per scenario', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    mockSuiteRunnerRun.mockResolvedValue([]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    const output = await runner.run('run-all-fail');

    expect(output.results).toEqual([]);
    expect(output.errors).toHaveLength(2);
    expect(output.errors.some((e) => e.message.includes('alpha'))).toBe(true);
    expect(output.errors.some((e) => e.message.includes('beta'))).toBe(true);
    expect(store.finalizeRun).not.toHaveBeenCalled();
  });

  it('re-throws non-AggregateError from SuiteRunner.run() without finalizing', async () => {
    const scenarios = [makeScenario('alpha')];
    const genericError = new Error('unexpected crash');
    mockSuiteRunnerRun.mockRejectedValue(genericError);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    await expect(runner.run('run-generic-err')).rejects.toThrow('unexpected crash');
    expect(store.finalizeRun).not.toHaveBeenCalled();
  });

  it('per-scenario finalization failure isolated: sibling preserved, error in errors array', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const alphaResult = makeScenarioResult('alpha');
    const betaResult = makeScenarioResult('beta');
    mockSuiteRunnerRun.mockResolvedValue([alphaResult, betaResult]);

    const writeError = new Error('disk write failed');
    store.writeTrial = vi.fn()
      .mockResolvedValueOnce(undefined) // alpha finalization succeeds
      .mockRejectedValueOnce(writeError); // beta finalization throws

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    const output = await runner.run('run-finalize-isolated');

    expect(output.results).toHaveLength(1);
    expect(output.results[0].scenarioName).toBe('alpha');
    expect(output.errors).toHaveLength(1);
    expect(output.errors[0]).toBe(writeError);
    expect(output.finalizationError).toBeUndefined();
  });

  it('fire-and-forget writeTrial called via onTrialEvaluated before finalization', async () => {
    const scenarios = [makeScenario('alpha')];
    const trial = makeTrialResult({ trialIndex: 0 });

    let capturedCallback: ((scenarioName: string, trial: TrialResult) => void) | undefined;
    vi.mocked(SuiteRunner).mockImplementationOnce(((opts: SuiteRunnerOptions) => {
      capturedCallback = opts.onTrialEvaluated;
      return { run: mockSuiteRunnerRun };
    }) as never);
    mockSuiteRunnerRun.mockImplementation(async () => {
      capturedCallback?.('alpha', trial);
      return [makeScenarioResult('alpha', { trials: [trial] })];
    });

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    await runner.run('run-fanout-persist');

    // Called once in onTrialEvaluated (fire-and-forget). Finalization skips
    // because the trial is already in the persistedTrials set.
    expect(store.writeTrial).toHaveBeenCalledWith('20260513_abc123', 'alpha', trial);
    expect(store.writeTrial).toHaveBeenCalledTimes(1);
  });

  it('fire-and-forget writeTrial failure does not reject the run', async () => {
    const scenarios = [makeScenario('alpha')];
    const trial = makeTrialResult({ trialIndex: 0 });

    let capturedCallback: ((scenarioName: string, trial: TrialResult) => void) | undefined;
    vi.mocked(SuiteRunner).mockImplementationOnce(((opts: SuiteRunnerOptions) => {
      capturedCallback = opts.onTrialEvaluated;
      return { run: mockSuiteRunnerRun };
    }) as never);
    mockSuiteRunnerRun.mockImplementation(async () => {
      capturedCallback?.('alpha', trial);
      return [makeScenarioResult('alpha', { trials: [trial] })];
    });

    // First call (fire-and-forget) rejects, second call (finalization) succeeds
    store.writeTrial = vi.fn()
      .mockRejectedValueOnce(new Error('transient write error'))
      .mockResolvedValueOnce(undefined);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
    });

    const output = await runner.run('run-persist-fail');
    expect(output.results).toHaveLength(1);
    expect(output.errors).toHaveLength(0);
  });
});

describe('GraduationSuiteRunner — resume support', () => {
  let store: ReturnType<typeof makeMockStore>;
  let config: ResolvedConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeMockStore();
    config = makeConfig();
    mockSuiteRunnerRun.mockResolvedValue([]);
  });

  it('skips store.initRun when dirName is provided (parallel mode)', async () => {
    const scenarios = [makeScenario('alpha')];
    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha')]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      dirName: 'existing-run-dir',
    });

    await runner.run('run-resume');

    expect(store.initRun).not.toHaveBeenCalled();
  });

  it('skips store.initRun when dirName is provided (sequential mode)', async () => {
    const scenarios = [makeScenario('alpha')];
    mockRunCapped.mockResolvedValue([makeGraduationResult('alpha')]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      dirName: 'existing-run-dir',
    });

    await runner.run('run-resume-seq');

    expect(store.initRun).not.toHaveBeenCalled();
  });

  it('passes existingTrialsByScenario to inner SuiteRunner (parallel mode)', async () => {
    const scenarios = [makeScenario('alpha')];
    const existingTrial = makeTrialResult({ trialIndex: 0 });
    const existingTrialsByScenario = new Map([['alpha', [existingTrial]]]);
    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha', { trials: [existingTrial] })]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      dirName: 'existing-run-dir',
      existingTrialsByScenario,
    });

    await runner.run('run-resume-existing');

    const [call] = vi.mocked(SuiteRunner).mock.calls;
    expect((call[0] as SuiteRunnerOptions).existingTrialsByScenario).toBe(existingTrialsByScenario);
  });

  it('passes trialIndicesByScenario to inner SuiteRunner (parallel mode)', async () => {
    const scenarios = [makeScenario('alpha')];
    const trialIndicesByScenario = new Map([['alpha', [1, 2]]]);
    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha')]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      dirName: 'existing-run-dir',
      trialIndicesByScenario,
    });

    await runner.run('run-resume-indices');

    const [call] = vi.mocked(SuiteRunner).mock.calls;
    expect((call[0] as SuiteRunnerOptions).trialIndicesByScenario).toBe(trialIndicesByScenario);
  });

  it('all scenarios already complete: SuiteRunner receives maps, finalization runs for all', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const existingAlpha = makeTrialResult({ trialIndex: 0 });
    const existingBeta = makeTrialResult({ trialIndex: 0 });
    const existingTrialsByScenario = new Map([
      ['alpha', [existingAlpha]],
      ['beta', [existingBeta]],
    ]);
    const trialIndicesByScenario = new Map<string, number[]>([
      ['alpha', []],
      ['beta', []],
    ]);

    // SuiteRunner returns results for both scenarios from existing trials
    mockSuiteRunnerRun.mockResolvedValue([
      makeScenarioResult('alpha', { trials: [existingAlpha] }),
      makeScenarioResult('beta', { trials: [existingBeta] }),
    ]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      dirName: 'existing-run-dir',
      existingTrialsByScenario,
      trialIndicesByScenario,
    });

    const output = await runner.run('run-all-done');

    expect(output.results).toHaveLength(2);
    expect(output.errors).toHaveLength(0);
    expect(store.initRun).not.toHaveBeenCalled();
  });

  it('finalization isolation preserved when dirName provided', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const alphaResult = makeScenarioResult('alpha');
    const betaResult = makeScenarioResult('beta');
    mockSuiteRunnerRun.mockResolvedValue([alphaResult, betaResult]);

    const writeError = new Error('disk write failed on beta');
    store.writeTrial = vi.fn()
      .mockResolvedValueOnce(undefined) // alpha finalization writeTrial succeeds
      .mockRejectedValueOnce(writeError); // beta finalization writeTrial throws

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      dirName: 'existing-run-dir',
    });

    const output = await runner.run('run-resume-isolated');

    expect(output.results).toHaveLength(1);
    expect(output.results[0].scenarioName).toBe('alpha');
    expect(output.errors).toHaveLength(1);
    expect(output.errors[0]).toBe(writeError);
    expect(store.initRun).not.toHaveBeenCalled();
  });
});

describe('GraduationSuiteRunner — git field propagation', () => {
  let store: ReturnType<typeof makeMockStore>;
  let config: ResolvedConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeMockStore();
    config = makeConfig();
    mockSuiteRunnerRun.mockResolvedValue([]);
  });

  it('passes git fields from run metadata through to baselineStore.save', async () => {
    const scenarios = [makeScenario('alpha')];
    const mockBaselineStore = { save: vi.fn().mockResolvedValue(undefined) };

    store.loadRunMetadataByDirName = vi.fn().mockResolvedValue({
      runId: 'run-git',
      timestamp: '2026-05-13T00:00:00Z',
      gitSha: 'abc1234',
      gitBranch: 'feat/test',
      scenarios: ['alpha'],
      config: {},
    });

    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha')]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      baselineStoreFactory: () => mockBaselineStore as never,
    });

    await runner.run('run-git');

    expect(mockBaselineStore.save).toHaveBeenCalledOnce();
    expect(mockBaselineStore.save).toHaveBeenCalledWith(
      'run-git',
      expect.objectContaining({ scenarioName: 'alpha' }),
      expect.objectContaining({
        defaultThreshold: config.regression.defaultThreshold,
        gitSha: 'abc1234',
        gitBranch: 'feat/test',
      }),
    );
  });

  it('omits git fields when run metadata is null', async () => {
    const scenarios = [makeScenario('alpha')];
    const mockBaselineStore = { save: vi.fn().mockResolvedValue(undefined) };

    store.loadRunMetadataByDirName = vi.fn().mockResolvedValue(null);

    mockSuiteRunnerRun.mockResolvedValue([makeScenarioResult('alpha')]);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      suiteMode: 'parallel',
      baselineStoreFactory: () => mockBaselineStore as never,
    });

    await runner.run('run-no-git');

    expect(mockBaselineStore.save).toHaveBeenCalledOnce();
    const saveOptions = mockBaselineStore.save.mock.calls[0][2];
    expect(saveOptions).toEqual({ defaultThreshold: config.regression.defaultThreshold });
    expect(saveOptions).not.toHaveProperty('gitSha');
    expect(saveOptions).not.toHaveProperty('gitBranch');
  });
});
