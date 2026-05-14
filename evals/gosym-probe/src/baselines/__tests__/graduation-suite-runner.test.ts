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

const { mockRunCapped } = vi.hoisted(() => ({
  mockRunCapped: vi.fn(),
}));

vi.mock('../../runner/suite-runner.js', () => ({
  runCapped: mockRunCapped,
}));

import { GraduationSuiteRunner } from '../graduation-suite-runner.js';
import type { GraduationSuiteRunResult } from '../graduation-suite-runner.js';
import { GraduationRunner } from '../graduation-runner.js';
import type { GraduationResult } from '../graduation-runner.js';
import type { RuncappedError } from '../../runner/suite-runner.js';
import type { Scenario } from '../../scenarios/types.js';
import type { ResolvedConfig } from '../../../config/index.js';
import type { ScenarioResult } from '../../runner/types.js';

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
    eval: { defaultTrials: 3, maxTurns: 30, turnTimeoutMs: 30000, maxConcurrency: 2, firstTurnInactivityMs: 600_000, maxFirstTurnRetries: 2 },
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
    prune: vi.fn().mockResolvedValue([]),
  } as unknown as EvalStore;
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

  it('uses explicit maxScenarioConcurrency=1 over config.eval.maxConcurrency', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const results = scenarios.map((s) => makeGraduationResult(s.name));
    mockRunCapped.mockResolvedValue(results);

    const runner = new GraduationSuiteRunner({
      scenarios,
      config,
      store,
      maxScenarioConcurrency: 1,
    });

    await runner.run('run-seq');

    expect(mockRunCapped).toHaveBeenCalledWith(
      2,
      1, // explicit maxScenarioConcurrency takes precedence
      expect.any(Function),
    );
  });

  it('falls back to config.eval.maxConcurrency when maxScenarioConcurrency is undefined', async () => {
    const scenarios = [makeScenario('alpha'), makeScenario('beta')];
    const results = scenarios.map((s) => makeGraduationResult(s.name));
    mockRunCapped.mockResolvedValue(results);

    const customConfig = makeConfig({
      eval: { defaultTrials: 3, maxTurns: 30, turnTimeoutMs: 30000, firstTurnInactivityMs: 30000, maxFirstTurnRetries: 2, maxConcurrency: 5 },
    });

    const runner = new GraduationSuiteRunner({
      scenarios,
      config: customConfig,
      store,
      maxScenarioConcurrency: undefined,
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

  it('passes trialConcurrency as concurrencyOverride to GraduationRunner', async () => {
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
        concurrencyOverride: 1,
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
});
