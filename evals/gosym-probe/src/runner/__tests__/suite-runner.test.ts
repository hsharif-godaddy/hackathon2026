import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSimulationRun } = vi.hoisted(() => ({
  mockSimulationRun: vi.fn(),
}));

vi.mock('../simulation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../simulation.js')>();
  return {
    ...original,
    Simulation: vi.fn().mockImplementation(function () { return {
      run: mockSimulationRun,
    }; }),
  };
});

vi.mock('../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { SuiteRunner, runCapped } from '../suite-runner.js';
import { Simulation } from '../simulation.js';
import { sleep } from '../../util/sleep.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator, EvalResult } from '../../evaluators/evaluator.js';
import type { ResolvedConfig } from '../../../config/index.js';
import type { AgentClient } from '../../clients/agent-client.js';
import type { SyntheticUserAgent } from '../synthetic-user.js';
import type { Transcript } from '../transcript.js';
import type { BaselineScores } from '../../baselines/types.js';
import type { TrialLifecycle } from '../../clients/trial-lifecycle.js';

const mockClient = {
  configure: vi.fn(),
  send: vi.fn(),
  onMessage: vi.fn(),
  disconnect: vi.fn(),
};
const makeAgentClient = async (_scenario?: Scenario) => mockClient;

const mockSyntheticUser: SyntheticUserAgent = {
  nextMessage: vi.fn().mockResolvedValue(null),
};

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

const mockConfig: ResolvedConfig = {
  env: 'local.test',
  aab: {
    agentsUrl: 'http://localhost:4000',
    bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
    controlPlaneUrl: 'http://localhost:4001',
  },
  gocode: { baseUrl: 'http://gocode', apiKey: 'key', model: 'test-model' },
  eval: {
    defaultTrials: 3,
    maxTurns: 10,
    turnTimeoutMs: 5_000,
    firstTurnInactivityMs: 600_000,
    firstTurnRetryScheduleMs: [600_000, 120_000, 120_000, 120_000],
    maxFirstTurnRetries: 2,
    maxConcurrency: 1,
  },
  playwright: { ignoreHttpsErrors: true },
  capture: { concurrency: 2, maxConcurrency: 8, maxRoutes: 20, viewports: ['mobile', 'laptop'], gotoTimeoutMs: 30_000, appReadyTimeoutMs: 15_000 },
  regression: { alpha: 0.05, k: 2.0, minMarginFraction: 0.05, reportingK: [1, 2, 3, 5, 10], fallbackThresholds: { thresholds: {}, defaultThreshold: 0.1 } },
};

function makeTranscript(
  scenarioName = 'test-scenario',
  trialIndex = 0,
): Transcript {
  return { scenarioName, trialIndex, turns: [], snapshots: [], errors: [], captureErrors: [] };
}

function makePassResult(evalName: string): EvalResult {
  return { evaluator: evalName, score: 1.0, verdict: 'pass', reason: 'ok' };
}

function makeEvaluator(
  name: string,
  result: EvalResult,
): Evaluator {
  return {
    name,
    evaluate: vi.fn().mockResolvedValue(result),
  };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 3,
    ...overrides,
  };
}

describe('runCapped', () => {
  it('preserves result order', async () => {
    const results = await runCapped(3, 2, async (i) => i * 2);
    expect(results).toEqual([0, 2, 4]);
  });

  it('limits in-flight tasks to cap', async () => {
    let inFlight = 0;
    let maxObserved = 0;
    await runCapped(5, 2, async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await Promise.resolve();
      inFlight--;
      return 0;
    });
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it('cap >= count behaves like Promise.all', async () => {
    const started: number[] = [];
    const resolvers: Array<() => void> = [];
    const promise = runCapped(3, 10, (i) => {
      started.push(i);
      return new Promise<number>((resolve) => {
        resolvers.push(() => resolve(i));
      });
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    resolvers.forEach((r) => r());
    const results = await promise;
    expect(results).toEqual([0, 1, 2]);
  });
});

describe('runCapped — error resilience', () => {
  it('completes remaining tasks when one fn(i) rejects', async () => {
    const completed: number[] = [];
    await expect(
      runCapped(3, 2, async (i) => {
        if (i === 0) throw new Error('fail');
        completed.push(i);
        return i;
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(completed).toContain(1);
    expect(completed).toContain(2);
  });

  it('throws AggregateError with all errors after workers finish',
    async () => {
      const err0 = new Error('fail-0');
      const err2 = new Error('fail-2');
      let thrown: unknown;
      try {
        await runCapped(3, 3, async (i) => {
          if (i === 0) throw err0;
          if (i === 2) throw err2;
          return i;
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      const agg = thrown as AggregateError;
      expect(agg.errors).toContain(err0);
      expect(agg.errors).toContain(err2);
    },
  );

  it('attaches partialResults with completed task values', async () => {
    type ResultError = AggregateError & {
      partialResults: (number | undefined)[];
    };
    let thrown: unknown;
    try {
      await runCapped(3, 2, async (i) => {
        if (i === 0) throw new Error('fail');
        return i * 10;
      });
    } catch (e) {
      thrown = e;
    }
    const agg = thrown as ResultError;
    expect(agg.partialResults[0]).toBeUndefined();
    expect(agg.partialResults[1]).toBe(10);
    expect(agg.partialResults[2]).toBe(20);
  });
});

describe('SuiteRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs each scenario scenario.trials times', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenario = makeScenario({ trials: 3 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(3);
  });

  it('runs multiple scenarios independently', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const s1 = makeScenario({ name: 's1', trials: 2 });
    const s2 = makeScenario({ name: 's2', trials: 3 });

    await new SuiteRunner({
      scenarios: [s1, s2],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(5);
  });

  it('returns one ScenarioResult per scenario', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenarios = [
      makeScenario({ name: 'a' }),
      makeScenario({ name: 'b' }),
    ];

    const results = await new SuiteRunner({
      scenarios,
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.scenarioName)).toEqual(['a', 'b']);
  });

  it('trialsOverride replaces per-scenario trial count', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenario = makeScenario({ trials: 5 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialsOverride: 1,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(1);
  });

  it('calls evaluators once per trial', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const evaluator = makeEvaluator('ev', makePassResult('ev'));
    const scenario = makeScenario({ trials: 3, evaluators: [evaluator] });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(evaluator.evaluate).toHaveBeenCalledTimes(3);
  });

  it('calls evaluators with distinct transcripts per trial', async () => {
    const t0 = makeTranscript('test-scenario', 0);
    const t1 = makeTranscript('test-scenario', 1);
    const t2 = makeTranscript('test-scenario', 2);
    mockSimulationRun
      .mockResolvedValueOnce(t0)
      .mockResolvedValueOnce(t1)
      .mockResolvedValueOnce(t2);

    const evaluator = makeEvaluator('ev', makePassResult('ev'));
    const scenario = makeScenario({ trials: 3, evaluators: [evaluator] });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const receivedTranscripts = (evaluator.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
      (args) => args[0] as Transcript,
    );
    expect(receivedTranscripts).toHaveLength(3);
    expect(receivedTranscripts[0]).toBe(t0);
    expect(receivedTranscripts[1]).toBe(t1);
    expect(receivedTranscripts[2]).toBe(t2);
    expect(receivedTranscripts[0]).not.toBe(receivedTranscripts[1]);
    expect(receivedTranscripts[1]).not.toBe(receivedTranscripts[2]);
  });

  it('includes per-trial TrialResults with correct trialIndex', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenario = makeScenario({ trials: 2 });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(result.trials).toHaveLength(2);
    expect(result.trials[0].trialIndex).toBe(0);
    expect(result.trials[1].trialIndex).toBe(1);
  });

  it('trialConcurrency: 1 serializes trials', async () => {
    const order: string[] = [];
    mockSimulationRun
      .mockImplementationOnce(async function () {
        order.push('start:0');
        await Promise.resolve();
        order.push('end:0');
        return makeTranscript();
      })
      .mockImplementationOnce(async function () {
        order.push('start:1');
        return makeTranscript();
      });

    const scenario = makeScenario({
      trials: 2,
    });
    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
    }).run();

    expect(order).toEqual(['start:0', 'end:0', 'start:1']);
  });

  it('throws when a requiresSerialTrials scenario runs with concurrency > 1', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenario = makeScenario({ trials: 3, requiresSerialTrials: true });
    const concurrentConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxConcurrency: 2 },
    };

    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: concurrentConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
        trialConcurrency: 2,
      }).run(),
    ).rejects.toThrow(/requires serial trials/);
    expect(mockSimulationRun).not.toHaveBeenCalled();
  });

  it('allows a requiresSerialTrials scenario at concurrency 1', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenario = makeScenario({ trials: 2, requiresSerialTrials: true });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(2);
  });

  it('throws in fan-out mode when a requiresSerialTrials scenario runs with concurrency > 1', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());
    const scenario = makeScenario({ trials: 3, requiresSerialTrials: true });
    const concurrentConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxConcurrency: 2 },
    };

    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: concurrentConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
        suiteMode: 'parallel',
        scenarioConcurrency: 2,
      }).run(),
    ).rejects.toThrow(/requires serial trials/);
    expect(mockSimulationRun).not.toHaveBeenCalled();
  });

  it('parallel mode: all trials start before any complete', async () => {
    const order: string[] = [];
    const resolvers: (() => void)[] = [];

    // Factory creates a distinct client per call
    const createdClients: AgentClient[] = [];
    const clientFactory = vi.fn().mockImplementation(async function () {
      const client: AgentClient = {
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      };
      createdClients.push(client);
      return client;
    });

    mockSimulationRun
      .mockImplementationOnce(function () {
        order.push('start:0');
        return new Promise<Transcript>((r) =>
          resolvers.push(() => {
            order.push('end:0');
            r(makeTranscript());
          }),
        );
      })
      .mockImplementationOnce(function () {
        order.push('start:1');
        return new Promise<Transcript>((r) =>
          resolvers.push(() => {
            order.push('end:1');
            r(makeTranscript());
          }),
        );
      });

    const scenario = makeScenario({
      trials: 2,
    });
    const runPromise = new SuiteRunner({
      scenarios: [scenario],
      config: {
        ...mockConfig,
        eval: { ...mockConfig.eval, maxConcurrency: 2 },
      },
      makeAgentClient: clientFactory,
      syntheticUser: mockSyntheticUser,
    }).run();

    await Promise.resolve(); // flush: slot 0 starts + slot 1's stagger sleep resolves
    await Promise.resolve(); // flush: slot 1 starts (after stagger + makeAgentClient)
    resolvers.forEach((r) => r());
    await runPromise;

    // Both starts precede any completion
    const start0 = order.indexOf('start:0');
    const start1 = order.indexOf('start:1');
    const end0 = order.indexOf('end:0');
    expect(start0).toBeLessThan(end0);
    expect(start1).toBeLessThan(end0);

    // Factory called once per trial; each trial got a distinct client
    expect(clientFactory).toHaveBeenCalledTimes(2);
    expect(createdClients).toHaveLength(2);
    expect(createdClients[0]).not.toBe(createdClients[1]);
  });

  it('trialConcurrency is honored when within config.eval.maxConcurrency',
    async () => {
      let maxInFlight = 0;
      let inFlight = 0;

      mockSimulationRun.mockImplementation(async function () {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return makeTranscript();
      });

      // cap is 4, override restricts to 2 — override is the binding limit
      const scenario = makeScenario({
        trials: 4,
      });
      await new SuiteRunner({
        scenarios: [scenario],
        config: {
          ...mockConfig,
          eval: { ...mockConfig.eval, maxConcurrency: 4 },
        },
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
        trialConcurrency: 2,
      }).run();

      // Stagger spreads trial starts, so peak in-flight is 1 in mock timing.
      // The binding contract is the upper bound: trialConcurrency caps at 2.
      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(mockSimulationRun).toHaveBeenCalledTimes(4);
      // Prove parallel dispatch: with cap=2, slot 1 (index % 2 = 1) must sleep.
      // This only fires if runCapped spawned 2 workers.
      expect(sleep).toHaveBeenCalledWith(1_000);
    },
  );

  it('maxConcurrency: 2 with trials: 4 never exceeds 2 in-flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async function () {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenario = makeScenario({
      trials: 4,
    });
    const cappedConfig: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxConcurrency: 2 },
    };

    await new SuiteRunner({
      scenarios: [scenario],
      config: cappedConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe('SuiteRunner — processScenario guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('throws when makeAgentClient is not provided', async () => {
    const scenario = makeScenario({ trials: 1 });
    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        syntheticUser: mockSyntheticUser,
      }).run(),
    ).rejects.toThrow('makeAgentClient');
  });

  it('throws before any simulation runs when makeAgentClient is missing', async () => {
    const scenario = makeScenario({ trials: 1 });
    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        syntheticUser: mockSyntheticUser,
      }).run(),
    ).rejects.toThrow();
    expect(mockSimulationRun).not.toHaveBeenCalled();
  });

  it('throws when syntheticUser is not provided', async () => {
    const scenario = makeScenario({ trials: 1 });
    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
      }).run(),
    ).rejects.toThrow('syntheticUser');
  });

  it('throws before any simulation runs when syntheticUser is missing', async () => {
    const scenario = makeScenario({ trials: 1 });
    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
      }).run(),
    ).rejects.toThrow();
    expect(mockSimulationRun).not.toHaveBeenCalled();
  });
});

describe('SuiteRunner — processScenario partial failure (non-fan-out)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('keeps completed trials and records droppedTrials when one trial fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    mockSimulationRun.mockImplementation(
      async function (trialIndex: number): Promise<Transcript> {
        if (trialIndex === 1) throw new Error('Turn 3 timed out after 1200000ms');
        return makeTranscript('s0', trialIndex);
      },
    );

    const scenario = makeScenario({ name: 's0', trials: 3 });
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(results).toHaveLength(1);
    expect(results[0].trials).toHaveLength(2);
    expect(results[0].droppedTrials).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Trials failed.',
      expect.objectContaining({
        scenarioName: 's0',
        dropped: 1,
        errors: ['Turn 3 timed out after 1200000ms'],
      }),
    );

    warnSpy.mockRestore();
  });

  it('re-throws a non-AggregateError without partials unchanged', async () => {
    // A scenario-level guard failure (not a per-trial AggregateError) must
    // still propagate — the recovery path only swallows runCapped partials.
    const results = new SuiteRunner({
      scenarios: [makeScenario({ name: 's0', trials: 1 })],
      config: mockConfig,
      syntheticUser: mockSyntheticUser,
    }).run();
    await expect(results).rejects.toThrow('makeAgentClient');
  });
});

describe('SuiteRunner — onTrialEvaluated callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('fires for each evaluated trial with correct args', async () => {
    const onTrialEvaluated = vi.fn();
    const ev = makeEvaluator('ev', makePassResult('ev'));
    const scenario = makeScenario({
      name: 'my-scenario',
      trials: 2,
      evaluators: [ev],
    });
    mockSimulationRun.mockResolvedValue(
      makeTranscript('my-scenario'),
    );

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      onTrialEvaluated,
    }).run();

    expect(onTrialEvaluated).toHaveBeenCalledTimes(2);
    expect(onTrialEvaluated).toHaveBeenCalledWith(
      'my-scenario',
      expect.objectContaining({ trialIndex: 0 }),
    );
    expect(onTrialEvaluated).toHaveBeenCalledWith(
      'my-scenario',
      expect.objectContaining({ trialIndex: 1 }),
    );
  });

  it('fires incrementally — delivers before all simulations complete', async () => {
    const onTrialEvaluated = vi.fn();
    const ev = makeEvaluator('ev', makePassResult('ev'));
    const scenario = makeScenario({
      name: 'my-scenario',
      trials: 3,
      evaluators: [ev],
    });

    type Resolver = (t: Transcript) => void;
    const resolvers: Resolver[] = [];
    // Each call parks in a deferred promise; resolvers are collected for
    // manual control in the test.
    mockSimulationRun.mockImplementation(
      function () { return new Promise<Transcript>((resolve) => {
          resolvers.push(resolve);
        }); },
    );

    const runPromise = new SuiteRunner({
      scenarios: [scenario],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 2 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      onTrialEvaluated,
    }).run();

    // Wait until both concurrent workers have parked in simulation.run().
    // runCapped spawns min(cap, count)=2 workers; each calls staggeredRun
    // (worker i=0 skips sleep, worker i=1 sleeps once — both mocked immediate),
    // makeRunWithRetry, makeAgentClient, then simulation.run() which registers
    // a resolver.
    await vi.waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(2));

    // Resolve the SECOND simulation (trial index 1) before the first, to
    // prove out-of-order delivery: the callback must fire immediately for
    // whichever trial completes first, regardless of trial index ordering.
    resolvers[1](makeTranscript('my-scenario', 1));

    // Flush through: transcript resolution → evaluateTrial → Promise.all
    // → onTrialEvaluated. Each await in the chain needs one tick.
    for (let tick = 0; tick < 10; tick++) {
      await Promise.resolve();
    }

    // onTrialEvaluated must have fired once — incremental, not burst.
    expect(onTrialEvaluated).toHaveBeenCalledTimes(1);
    // The first callback must carry trialIndex 1 (out-of-order delivery).
    expect(onTrialEvaluated.mock.calls[0][1].trialIndex).toBe(1);

    // Resolve remaining simulations and let the runner finish.
    // Wait for the third worker to park (it starts after trial 1 completes).
    await vi.waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(3));
    resolvers[0](makeTranscript('my-scenario', 0));
    resolvers[2](makeTranscript('my-scenario', 2));
    await runPromise;

    expect(onTrialEvaluated).toHaveBeenCalledTimes(3);
  });

  it('fires for successful trials even when another trial throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const onTrialEvaluated = vi.fn();
    const ev = makeEvaluator('ev', makePassResult('ev'));
    const scenario = makeScenario({
      name: 'my-scenario',
      trials: 2,
      evaluators: [ev],
    });

    mockSimulationRun
      .mockRejectedValueOnce(new Error('sim failed'))
      .mockResolvedValueOnce(makeTranscript('my-scenario', 1));

    // A single failed trial no longer aborts the scenario: the run resolves
    // with the completed trial and records the drop.
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 2 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      onTrialEvaluated,
    }).run();

    expect(results).toHaveLength(1);
    expect(results[0].trials).toHaveLength(1);
    expect(results[0].droppedTrials).toBe(1);
    expect(onTrialEvaluated).toHaveBeenCalledTimes(1);
    expect(onTrialEvaluated).toHaveBeenCalledWith(
      'my-scenario',
      expect.objectContaining({ trialIndex: 1 }),
    );

    warnSpy.mockRestore();
  });

  it('fires across multiple scenarios', async () => {
    const onTrialEvaluated = vi.fn();
    const s1 = makeScenario({ name: 's1', trials: 1 });
    const s2 = makeScenario({ name: 's2', trials: 1 });
    mockSimulationRun
      .mockResolvedValueOnce(makeTranscript('s1'))
      .mockResolvedValueOnce(makeTranscript('s2'));

    await new SuiteRunner({
      scenarios: [s1, s2],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      onTrialEvaluated,
    }).run();

    expect(onTrialEvaluated).toHaveBeenCalledTimes(2);
    expect(
      onTrialEvaluated.mock.calls[0][0],
    ).toBe('s1');
    expect(
      onTrialEvaluated.mock.calls[1][0],
    ).toBe('s2');
  });

  it('is optional — no error when unset', async () => {
    const scenario = makeScenario({ trials: 2 });

    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
      }).run(),
    ).resolves.toBeDefined();
  });
});

describe('SuiteRunner — score-mode enrichment', () => {
  const mockBaselineStore = {
    load: vi.fn<() => Promise<{ scores: BaselineScores; filePath: string } | null>>().mockResolvedValue(null),
    loadByRunId: vi.fn<() => Promise<{ scores: BaselineScores; filePath: string } | null>>().mockResolvedValue(null),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
    mockBaselineStore.load.mockResolvedValue(null);
  });

  it('enriches score-mode evaluator with passAtK when baseline has aggregateScore', async () => {
    const scoreEval: Evaluator = {
      name: 'token-count',
      regressionMode: 'score',
      lowerIsBetter: true,
      evaluate: vi.fn().mockResolvedValue({
        evaluator: 'token-count',
        score: 95,
        verdict: 'observed',
        reason: 'measured',
      }),
    };
    mockBaselineStore.load.mockResolvedValue({
      filePath: 'baselines/test-scenario/baseline.json',
      scores: {
        scenarioName: 'test-scenario',
        runId: 'baseline-run',
        createdAt: '2026-01-01T00:00:00Z',
        scores: {
          'token-count': {
            passingTrials: 0,
            totalTrials: 3,
            aggregateScore: 100,
          },
        },
      },
    });
    const scenario = makeScenario({ trials: 1, evaluators: [scoreEval] });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
    }).run();

    // (95 - 100) / 100 = -0.05 <= defaultThreshold 0.1 → passes
    // n=1 valid trial, c=1 passing; resolveReportingKs([1,2,3,5,10], 1) → [1]
    expect(result.aggregated['token-count'].passAt1).toBe(1);
    expect(result.aggregated['token-count'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(result.aggregated['token-count'].passHatK).toEqual([{ k: 1, value: 1 }]);
  });

  it('leaves score-mode passAtK undefined when no baseline exists', async () => {
    const scoreEval: Evaluator = {
      name: 'token-count',
      regressionMode: 'score',
      evaluate: vi.fn().mockResolvedValue({
        evaluator: 'token-count',
        score: 95,
        verdict: 'observed',
        reason: 'measured',
      }),
    };
    mockBaselineStore.load.mockResolvedValue(null);
    const scenario = makeScenario({ trials: 1, evaluators: [scoreEval] });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
    }).run();

    expect(result.aggregated['token-count'].passAt1).toBeUndefined();
  });
});

describe('SuiteRunner — baseline comparison', () => {
  const mockBaselineStore = {
    load: vi.fn<() => Promise<{ scores: BaselineScores; filePath: string } | null>>().mockResolvedValue(null),
    loadByRunId: vi.fn<() => Promise<{ scores: BaselineScores; filePath: string } | null>>().mockResolvedValue(null),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
    mockBaselineStore.load.mockResolvedValue(null);
  });

  it('regressionStatus is undefined when baseline load returns null', async () => {
    const scenario = makeScenario({ trials: 1 });
    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
    }).run();

    expect(result.regressionStatus).toBeUndefined();
  });

  it('regressionStatus is undefined when no baselineStore', async () => {
    const scenario = makeScenario({ trials: 1 });
    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(result.regressionStatus).toBeUndefined();
  });

  it('loads baseline using scenario name', async () => {
    const scenario = makeScenario({ name: 'my-scenario', trials: 1 });
    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
    }).run();

    expect(mockBaselineStore.load).toHaveBeenCalledWith('my-scenario');
  });

  it('does not call comparator when no baseline exists', async () => {
    mockBaselineStore.load.mockResolvedValue(null);
    const { RegressionComparator } = await import(
      '../../baselines/regression-comparator.js'
    );
    const compareSpy = vi.spyOn(
      RegressionComparator.prototype,
      'compare',
    );

    const scenario = makeScenario({ trials: 1 });
    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
    }).run();

    expect(compareSpy).not.toHaveBeenCalled();
    compareSpy.mockRestore();
  });

  it('populates regressionStatus when baseline exists', async () => {
    mockBaselineStore.load.mockResolvedValue({
      filePath: 'baselines/test-scenario/baseline.json',
      scores: {
        scenarioName: 'test-scenario',
        runId: 'baseline-run',
        createdAt: '2026-01-01T00:00:00Z',
        scores: {
          'test-eval': {
            passAt1: 1,
            passAtK: [{ k: 1, value: 1 }, { k: 2, value: 1 }],
            passHatK: [{ k: 1, value: 1 }, { k: 2, value: 1 }],
            passingTrials: 3,
            totalTrials: 3,
          },
        },
      },
    });
    const evaluator = makeEvaluator(
      'test-eval',
      makePassResult('test-eval'),
    );
    const scenario = makeScenario({
      trials: 1,
      evaluators: [evaluator],
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
    }).run();

    expect(result.regressionStatus).toBeDefined();
    expect(result.regressionStatus!.gate).toBe('pass');
    expect(result.regressionStatus!.scenarioName).toBe('test-scenario');
  });

  it('throws when baselineRunId is set but loadByRunId returns null', async () => {
    mockBaselineStore.loadByRunId.mockResolvedValue(null);
    const scenario = makeScenario({ name: 'my-scenario', trials: 1 });

    await expect(
      new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
        baselineStore: mockBaselineStore,
        baselineRunId: 'missing-run-id',
      }).run(),
    ).rejects.toThrow(
      'Baseline run "missing-run-id" not found for scenario "my-scenario".',
    );
  });

  it('uses loadByRunId when baselineRunId is set', async () => {
    const pinned = {
      filePath: 'baselines/my-scenario/20260101_pinned-run.json',
      scores: {
        scenarioName: 'my-scenario',
        runId: 'pinned-run',
        createdAt: '2026-01-01T00:00:00Z',
        scores: {
          'test-eval': {
            passAt1: 1,
            passAtK: [{ k: 1, value: 1 }, { k: 2, value: 1 }],
            passHatK: [{ k: 1, value: 1 }, { k: 2, value: 1 }],
            passingTrials: 3,
            totalTrials: 3,
          },
        },
      },
    };
    mockBaselineStore.loadByRunId.mockResolvedValue(pinned);
    const evaluator = makeEvaluator('test-eval', makePassResult('test-eval'));
    const scenario = makeScenario({
      name: 'my-scenario',
      trials: 1,
      evaluators: [evaluator],
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      baselineStore: mockBaselineStore,
      baselineRunId: 'pinned-run',
    }).run();

    expect(mockBaselineStore.loadByRunId).toHaveBeenCalledWith(
      'my-scenario',
      'pinned-run',
    );
    expect(mockBaselineStore.load).not.toHaveBeenCalled();
    expect(result.baselineFilePath).toBe(pinned.filePath);
  });
});

describe('SuiteRunner — suiteMode: parallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('runs full scenario.trials per scenario', async () => {
    const s0 = makeScenario({ name: 's0', trials: 3 });
    const s1 = makeScenario({ name: 's1', trials: 3 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
      suiteMode: 'parallel',
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(6);
  });

  it('respects trialsOverride per scenario', async () => {
    const s0 = makeScenario({ name: 's0', trials: 3 });
    const s1 = makeScenario({ name: 's1', trials: 3 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialsOverride: 5,
      trialConcurrency: 1,
      suiteMode: 'parallel',
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(10);
  });

  it('runs scenarios concurrently (both start before any complete)', async () => {
    const order: string[] = [];
    const resolvers: (() => void)[] = [];

    const clientFactory = vi.fn().mockImplementation(async function () { return {
      configure: vi.fn(),
      send: vi.fn(),
      onMessage: vi.fn(),
      disconnect: vi.fn(),
    }; });

    mockSimulationRun
      .mockImplementationOnce(function () {
        order.push('start:s0');
        return new Promise<Transcript>((resolve) =>
          resolvers.push(() => {
            order.push('end:s0');
            resolve(makeTranscript('s0'));
          }),
        );
      })
      .mockImplementationOnce(function () {
        order.push('start:s1');
        return new Promise<Transcript>((resolve) =>
          resolvers.push(() => {
            order.push('end:s1');
            resolve(makeTranscript('s1'));
          }),
        );
      });

    // 1 trial per scenario so the queue has exactly 2 items matching the 2 mock calls.
    // Round-robin with cap=2 starts both concurrently (staggered).
    const s0 = makeScenario({ name: 's0', trials: 1 });
    const s1 = makeScenario({ name: 's1', trials: 1 });

    const runPromise = new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 2 } },
      makeAgentClient: clientFactory,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    await Promise.resolve(); // flush: s0 starts + s1's stagger sleep resolves
    await Promise.resolve(); // flush: s1 starts (after stagger + makeAgentClient)
    resolvers.forEach((r) => r());
    await runPromise;

    expect(order.indexOf('start:s0')).toBeLessThan(order.indexOf('end:s0'));
    expect(order.indexOf('start:s1')).toBeLessThan(order.indexOf('end:s0'));
    expect(order.indexOf('start:s1')).toBeLessThan(order.indexOf('end:s1'));
  });

  it('respects maxConcurrency cap across scenarios', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async function () {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenarios = Array.from({ length: 5 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 3 }),
    );
    const cappedConfig: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxConcurrency: 2 },
    };

    await new SuiteRunner({
      scenarios,
      config: cappedConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
      suiteMode: 'parallel',
    }).run();

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('default suiteMode runs scenarios sequentially', async () => {
    const order: string[] = [];

    mockSimulationRun
      .mockImplementationOnce(async function () {
        order.push('start:s0');
        await Promise.resolve();
        order.push('end:s0');
        return makeTranscript('s0');
      })
      .mockImplementationOnce(function () {
        order.push('start:s1');
        return makeTranscript('s1');
      });

    const s0 = makeScenario({ name: 's0', trials: 1 });
    const s1 = makeScenario({ name: 's1', trials: 1 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(order).toEqual(['start:s0', 'end:s0', 'start:s1']);
  });
});

describe('SuiteRunner — evaluator error resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('returns verdict unknown when evaluator.evaluate rejects', async () => {
    const failingEval: Evaluator = {
      name: 'failing-eval',
      evaluate: vi.fn().mockRejectedValue(new Error('eval crashed')),
    };
    const scenario = makeScenario({
      trials: 1,
      evaluators: [failingEval],
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const evalResult = result.trials[0].evalResults[0];
    expect(evalResult.verdict).toBe('unknown');
    expect(evalResult.evaluator).toBe('failing-eval');
    expect(evalResult.score).toBe(0);
  });

  it('other evaluators still produce results when one fails', async () => {
    const failingEval: Evaluator = {
      name: 'failing',
      evaluate: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const passingEval = makeEvaluator(
      'passing',
      makePassResult('passing'),
    );
    const scenario = makeScenario({
      trials: 1,
      evaluators: [failingEval, passingEval],
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const evalResults = result.trials[0].evalResults;
    expect(evalResults).toHaveLength(2);
    expect(
      evalResults.find((r) => r.evaluator === 'failing')?.verdict,
    ).toBe('unknown');
    expect(
      evalResults.find((r) => r.evaluator === 'passing')?.verdict,
    ).toBe('pass');
  });

  it('captures error message in reason field', async () => {
    const failingEval: Evaluator = {
      name: 'failing',
      evaluate: vi.fn().mockRejectedValue(
        new Error('specific error message'),
      ),
    };
    const scenario = makeScenario({
      trials: 1,
      evaluators: [failingEval],
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const evalResult = result.trials[0].evalResults[0];
    expect(evalResult.reason).toContain('specific error message');
  });
});

describe('SuiteRunner -- beforeTrial lifecycle', () => {
  beforeEach(() => {
    mockSimulationRun.mockReset();
    mockClient.configure.mockClear();
    mockClient.disconnect.mockClear();
    mockClient.onMessage.mockClear();
  });

  it(
    'calls beforeTrial before simulation runs',
    async () => {
      const order: string[] = [];
      mockSimulationRun.mockImplementation(
        async function (i: number) {
          order.push(`sim:${i}`);
          return makeTranscript('test', i);
        },
      );
      const scenario = makeScenario({
        trials: 2,
        evaluators: [
          makeEvaluator(
            'e',
            makePassResult('e'),
          ),
        ],
        beforeTrial: vi.fn(function (_client, i) {
          order.push(`beforeTrial:${i}`);
        }),
      });

      await new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
      }).run();

      expect(order).toEqual([
        'beforeTrial:0',
        'sim:0',
        'beforeTrial:1',
        'sim:1',
      ]);
    },
  );

  it(
    'calls evaluator.hookClient for evaluators' +
      ' that implement it',
    async () => {
      mockSimulationRun.mockImplementation(
        async function (i: number) { return makeTranscript('test', i); },
      );
      const hookClient = vi.fn();
      const evaluator = {
        ...makeEvaluator(
          'hooked',
          makePassResult('hooked'),
        ),
        hookClient,
      };
      const scenario = makeScenario({
        trials: 1,
        evaluators: [evaluator],
      });

      await new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
      }).run();

      expect(hookClient).toHaveBeenCalledOnce();
      expect(hookClient).toHaveBeenCalledWith(
        mockClient,
        0,
      );
    },
  );

  it(
    'calls evaluator.unhookTrial after evaluation',
    async () => {
      mockSimulationRun.mockImplementation(
        async function (i: number) { return makeTranscript('test', i); },
      );
      const unhookTrial = vi.fn();
      const evaluator = {
        ...makeEvaluator(
          'with-unhook',
          makePassResult('with-unhook'),
        ),
        unhookTrial,
      };
      const scenario = makeScenario({
        trials: 2,
        evaluators: [evaluator],
      });

      await new SuiteRunner({
        scenarios: [scenario],
        config: mockConfig,
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
      }).run();

      expect(unhookTrial).toHaveBeenCalledTimes(2);
      expect(unhookTrial).toHaveBeenCalledWith(0);
      expect(unhookTrial).toHaveBeenCalledWith(1);
    },
  );
});

describe('SuiteRunner — EvalResult normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('clamps NaN score to 0', async () => {
    const evaluator = makeEvaluator(
      'bad-score',
      { evaluator: 'bad-score', score: NaN, verdict: 'fail', reason: 'oops' },
    );
    const scenario = makeScenario({
      evaluators: [evaluator],
      trials: 1,
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(result.trials[0].evalResults[0].score).toBe(0);
  });

  it('clamps score above 1 to 1', async () => {
    const evaluator = makeEvaluator(
      'over-score',
      { evaluator: 'over-score', score: 2.5, verdict: 'pass', reason: 'ok' },
    );
    const scenario = makeScenario({
      evaluators: [evaluator],
      trials: 1,
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(result.trials[0].evalResults[0].score).toBe(1);
  });

  it('flattens multiline reason to single line', async () => {
    const evaluator = makeEvaluator(
      'multiline',
      {
        evaluator: 'multiline',
        score: 0.5,
        verdict: 'partial',
        reason: 'line1\nline2\r\nline3',
      },
    );
    const scenario = makeScenario({
      evaluators: [evaluator],
      trials: 1,
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(result.trials[0].evalResults[0].reason).toBe(
      'line1 line2 line3',
    );
  });

  it('normalizes catch-path result when evaluator throws', async () => {
    const failingEval: Evaluator = {
      name: 'throwing',
      evaluate: vi.fn().mockRejectedValue(
        new Error('line1\nline2\r\nline3'),
      ),
    };
    const scenario = makeScenario({
      evaluators: [failingEval],
      trials: 1,
    });

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const evalResult = result.trials[0].evalResults[0];
    expect(evalResult.reason).toBe('line1 line2 line3');
    expect(evalResult.verdict).toBe('unknown');
    expect(evalResult.score).toBe(0);
  });
});

describe('SuiteRunner — no-stacking invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trialConcurrency: 1 suppresses parallel trial execution', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async function () {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenario = makeScenario({
      trials: 4,
    });

    await new SuiteRunner({
      scenarios: [scenario],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 4 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
    }).run();

    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  it('trialConcurrency cannot exceed config.eval.maxConcurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async function () {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenario = makeScenario({
      trials: 6,
    });

    await new SuiteRunner({
      scenarios: [scenario],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 3 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 10,
    }).run();

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('fan-out: 5 scenarios cap 3 never exceeds 3 concurrent', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async function () {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenarios = Array.from({ length: 5 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 2 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 3 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
      suiteMode: 'parallel',
    }).run();

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('fan-out: 4 scenarios cap 12 dispatch concurrently with staggered init', async () => {
    mockSimulationRun.mockResolvedValue(makeTranscript());

    const scenarios = Array.from({ length: 4 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 3 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 12 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
      suiteMode: 'parallel',
    }).run();

    // All 4 scenarios × 3 trials = 12 total simulations
    expect(mockSimulationRun).toHaveBeenCalledTimes(12);
    // Prove parallel dispatch: with 4 scenarios and cap=12, slots 1-3
    // must sleep at stagger intervals. These only fire if runCapped
    // spawned multiple workers concurrently.
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(sleep).toHaveBeenCalledWith(3_000);
  });
});

describe('first-turn inactivity retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries on InactivityTimeoutError up to maxFirstTurnRetries', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockResolvedValue(makeTranscript());

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 2 },
    };
    const scenario = makeScenario({ trials: 1 });

    const results = await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]).toEqual([
      'Trial retry: first-turn inactivity timeout.',
      {
        scenarioName: 'test-scenario',
        trialIndex: 0,
        attempt: 1,
        maxAttempts: 2,
        nextInactivityMs: 600_000,
      },
    ]);
    expect(warnSpy.mock.calls[1]).toEqual([
      'Trial retry: first-turn inactivity timeout.',
      {
        scenarioName: 'test-scenario',
        trialIndex: 0,
        attempt: 2,
        maxAttempts: 2,
        nextInactivityMs: 120_000,
      },
    ]);
    warnSpy.mockRestore();
  });

  it('fails permanently after exhausting retries', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun.mockRejectedValue(
      new InactivityTimeoutError(600_000),
    );

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 2 },
    };
    const scenario = makeScenario({ trials: 1 });

    // The only trial fails permanently; the scenario resolves with zero
    // completed trials and droppedTrials=1 rather than aborting the run.
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(results[0].trials).toHaveLength(0);
    expect(results[0].droppedTrials).toBe(1);
    // 1 initial + 2 retries = 3 total attempts
    expect(mockSimulationRun).toHaveBeenCalledTimes(3);
    // 3 retry-budget warnings + 1 'Trials failed.' summary.
    expect(warnSpy).toHaveBeenCalledWith(
      'Trial failed: first-turn inactivity retry budget exhausted.',
      expect.objectContaining({ scenarioName: scenario.name }),
    );
    warnSpy.mockRestore();
  });

  it('does not retry on non-inactivity errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun.mockRejectedValue(
      new Error('some other failure'),
    );

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 2 },
    };
    const scenario = makeScenario({ trials: 1 });

    const results = await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(results[0].trials).toHaveLength(0);
    expect(results[0].droppedTrials).toBe(1);
    expect(mockSimulationRun).toHaveBeenCalledTimes(1);
    // No retry warning (non-inactivity error); only the 'Trials failed.' summary.
    expect(warnSpy).not.toHaveBeenCalledWith(
      'Trial failed: first-turn inactivity retry budget exhausted.',
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('creates a fresh AgentClient for each retry attempt', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockResolvedValue(makeTranscript());

    const clients: Array<ReturnType<typeof vi.fn>> = [];
    const makeAgentClientSpy = vi.fn(async function () {
      const client = {
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      };
      clients.push(client.disconnect);
      return client;
    });

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 2 },
    };
    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient: makeAgentClientSpy,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(makeAgentClientSpy).toHaveBeenCalledTimes(3);
    for (const disconnectFn of clients) {
      expect(disconnectFn).toHaveBeenCalledOnce();
    }
    warnSpy.mockRestore();
  });

  it('calls unhookTrial between retry attempts to release evaluator state', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockResolvedValue(makeTranscript());

    const unhookTrialSpy = vi.fn();
    const evaluator: Evaluator = {
      name: 'hook-tracker',
      evaluate: vi.fn().mockResolvedValue(makePassResult('hook-tracker')),
      hookClient: vi.fn(),
      unhookTrial: unhookTrialSpy,
    };

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 2 },
    };
    const scenario = makeScenario({ trials: 1, evaluators: [evaluator] });

    await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    // 2 failed attempts → 2 inter-retry unhooks + 1 final cleanup = 3
    expect(unhookTrialSpy).toHaveBeenCalledTimes(3);
    expect(unhookTrialSpy).toHaveBeenCalledWith(0);
    warnSpy.mockRestore();
  });
});

describe('rate limit (429) retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function makeRateLimitError(): Promise<Error> {
    const { RateLimitError } = await import('openai');
    return new RateLimitError(
      429,
      { message: 'Too many tokens', type: 'throttling_error' },
      'Too many tokens, please wait before trying again.',
      new Headers(),
    );
  }

  it('retries on RateLimitError and succeeds on next attempt', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const rateLimitErr = await makeRateLimitError();

    mockSimulationRun
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue(makeTranscript());

    const scenario = makeScenario({ trials: 1 });

    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
    expect(results[0].trials[0].transcript.retryCount).toBe(1);
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(warnSpy).toHaveBeenCalledWith(
      'Trial retry: rate limit (429).',
      expect.objectContaining({
        scenarioName: 'test-scenario',
        trialIndex: 0,
        attempt: 1,
        maxAttempts: 10,
        waitSeconds: 30,
      }),
    );
    warnSpy.mockRestore();
  });

  it('exhausts MAX_RATE_LIMIT_RETRIES and throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const rateLimitErr = await makeRateLimitError();

    mockSimulationRun.mockRejectedValue(rateLimitErr);

    const scenario = makeScenario({ trials: 1 });

    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(results[0].trials).toHaveLength(0);
    expect(results[0].droppedTrials).toBe(1);
    // 1 initial + 10 retries = 11 total attempts
    expect(mockSimulationRun).toHaveBeenCalledTimes(11);
    expect(warnSpy).toHaveBeenCalledWith(
      'Trial failed: rate-limit retry budget exhausted.',
      expect.objectContaining({
        scenarioName: 'test-scenario',
        trialIndex: 0,
        totalAttempts: 11,
      }),
    );
    warnSpy.mockRestore();
  });

  it('uses independent budgets for inactivity and rate limit retries', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const rateLimitErr = await makeRateLimitError();

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue(makeTranscript());

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 2 },
    };
    const scenario = makeScenario({ trials: 1 });

    const results = await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(5);
    expect(results).toHaveLength(1);
    // Total retries: 2 inactivity + 2 rate limit = 4
    expect(results[0].trials[0].transcript.retryCount).toBe(4);
    warnSpy.mockRestore();
  });

  it('respects Retry-After header from server', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const { RateLimitError } = await import('openai');
    const errWithHeader = new RateLimitError(
      429,
      { message: 'Too many tokens', type: 'throttling_error' },
      'Too many tokens, please wait before trying again.',
      new Headers({ 'retry-after': '10' }),
    );

    mockSimulationRun
      .mockRejectedValueOnce(errWithHeader)
      .mockResolvedValue(makeTranscript());

    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(sleep).toHaveBeenCalledWith(10_000);
    expect(warnSpy).toHaveBeenCalledWith(
      'Trial retry: rate limit (429).',
      expect.objectContaining({ attempt: 1, waitSeconds: 10 }),
    );
    warnSpy.mockRestore();
  });

  it.each([
    ['zero', '0', 30_000],
    ['negative', '-5', 30_000],
    ['non-numeric', 'abc', 30_000],
    ['empty string', '', 30_000],
  ])('falls back to default when Retry-After is %s', async (_label, headerValue, expectedMs) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const { RateLimitError } = await import('openai');
    const headers = headerValue === ''
      ? new Headers({ 'retry-after': '' })
      : new Headers({ 'retry-after': headerValue });
    const err = new RateLimitError(
      429,
      { message: 'Too many tokens', type: 'throttling_error' },
      'Too many tokens, please wait before trying again.',
      headers,
    );

    mockSimulationRun
      .mockRejectedValueOnce(err)
      .mockResolvedValue(makeTranscript());

    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(sleep).toHaveBeenCalledWith(expectedMs);
    warnSpy.mockRestore();
  });

  it('caps Retry-After at 300s to prevent absurd waits', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const { RateLimitError } = await import('openai');
    const err = new RateLimitError(
      429,
      { message: 'Too many tokens', type: 'throttling_error' },
      'Too many tokens, please wait before trying again.',
      new Headers({ 'retry-after': '86400' }),
    );

    mockSimulationRun
      .mockRejectedValueOnce(err)
      .mockResolvedValue(makeTranscript());

    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(sleep).toHaveBeenCalledWith(300_000);
    warnSpy.mockRestore();
  });
});

describe('retry warning routing with progressReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes inactivity retry warning to progressReporter.log when provided', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const logSpy = vi.fn();
    const progressReporter = { log: logSpy } as unknown as import('../../util/progress-reporter.js').ProgressReporter;

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockResolvedValue(makeTranscript());

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxFirstTurnRetries: 1 },
    };
    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      progressReporter,
    }).run();

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith(
      'Trial retry: first-turn inactivity timeout.',
      expect.objectContaining({ scenarioName: 'test-scenario' }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('routes rate-limit retry warning to progressReporter.log when provided', async () => {
    const { RateLimitError } = await import('openai');
    const rateLimitErr = new RateLimitError(
      429,
      { message: 'Too many tokens', type: 'throttling_error' },
      'Too many tokens, please wait before trying again.',
      new Headers(),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const logSpy = vi.fn();
    const progressReporter = { log: logSpy } as unknown as import('../../util/progress-reporter.js').ProgressReporter;

    mockSimulationRun
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue(makeTranscript());

    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      progressReporter,
    }).run();

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith(
      'Trial retry: rate limit (429).',
      expect.objectContaining({ scenarioName: 'test-scenario' }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('SuiteRunner — staggered init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('parallel mode: sleep called with stagger values 1000 and 2000 for slots 1 and 2', async () => {
    const scenarios = Array.from({ length: 6 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 1 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 3 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
      suiteMode: 'parallel',
    }).run();

    // Slot 0 (delay=0) is guarded — sleep is not called for zero-delay slots.
    expect(sleep).not.toHaveBeenCalledWith(0);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('sequential trials (maxConcurrency: 1): no stagger sleep issued when cap is 1', async () => {
    const scenario = makeScenario({ trials: 3 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialConcurrency: 1,
    }).run();

    // With cap=1 all stagger delays are 0ms. The guard skips sleep entirely,
    // avoiding an extra microtask tick per trial.
    expect(vi.mocked(sleep)).not.toHaveBeenCalledWith(0);
  });

  it('scenarioConcurrency: 2 limits fan-out cap when maxConcurrency is 5', async () => {
    const scenarios = Array.from({ length: 4 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 1 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 5 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      scenarioConcurrency: 2,
      suiteMode: 'parallel',
    }).run();

    // cap=2: slot 1 sleeps 1000ms; slot 2 would sleep 2000ms if cap were ≥3
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).not.toHaveBeenCalledWith(2_000);
    expect(mockSimulationRun).toHaveBeenCalledTimes(4);
  });

  it('scenarioConcurrency exceeding maxConcurrency is clamped by effectiveConcurrency', async () => {
    const scenarios = Array.from({ length: 4 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 1 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 2 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      scenarioConcurrency: 10,
      suiteMode: 'parallel',
    }).run();

    // Effective cap is 2: slot 1 sleeps 1000ms; no 2s or higher stagger
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).not.toHaveBeenCalledWith(2_000);
    expect(mockSimulationRun).toHaveBeenCalledTimes(4);
  });

  it('omitting scenarioConcurrency uses maxConcurrency as cap', async () => {
    const scenarios = Array.from({ length: 4 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 1 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 3 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(sleep).not.toHaveBeenCalledWith(3_000);
    expect(mockSimulationRun).toHaveBeenCalledTimes(4);
  });
});

describe('SuiteRunner — tiered inactivity retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes correct firstTurnInactivityMsOverride from schedule to each retry attempt', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockResolvedValue(makeTranscript());

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: {
        ...mockConfig.eval,
        firstTurnRetryScheduleMs: [600_000, 120_000, 120_000],
        maxFirstTurnRetries: 3,
      },
    };
    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const calls = vi.mocked(Simulation).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[0][0].firstTurnInactivityMsOverride).toBeUndefined();
    expect(calls[1][0].firstTurnInactivityMsOverride).toBe(600_000);
    expect(calls[2][0].firstTurnInactivityMsOverride).toBe(120_000);
    expect(calls[3][0].firstTurnInactivityMsOverride).toBe(120_000);
    warnSpy.mockRestore();
  });

  it('falls back to firstTurnInactivityMs on all retries when no schedule is configured', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    mockSimulationRun
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockRejectedValueOnce(new InactivityTimeoutError(600_000))
      .mockResolvedValue(makeTranscript());

    // Empty firstTurnRetryScheduleMs → all retries fall back to firstTurnInactivityMs
    const config: ResolvedConfig = {
      ...mockConfig,
      eval: {
        ...mockConfig.eval,
        firstTurnRetryScheduleMs: [],
        maxFirstTurnRetries: 2,
      },
    };
    const scenario = makeScenario({ trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    const calls = vi.mocked(Simulation).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][0].firstTurnInactivityMsOverride).toBeUndefined();
    expect(calls[1][0].firstTurnInactivityMsOverride).toBe(600_000);
    expect(calls[2][0].firstTurnInactivityMsOverride).toBe(600_000);
    warnSpy.mockRestore();
  });
});

describe('SuiteRunner — writePartialTrial error handling', () => {
  beforeEach(() => {
    mockSimulationRun.mockReset();
    mockClient.configure.mockClear();
    mockClient.disconnect.mockClear();
    mockClient.onMessage.mockClear();
  });

  it('writePartialTrial failure invokes onPartialWriteFailed and run completes', async () => {
    const { Simulation } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const writeErr = new Error('ENOSPC: no space left');
    const writePartialTrial = vi.fn().mockRejectedValue(writeErr);
    const onPartialWriteFailed = vi.fn();

    // Override Simulation mock to invoke onConversationComplete during run
    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { onConversationComplete?: (idx: number, t: Transcript, ctx: object) => Promise<void> }) { return {
        run: async (trialIndex: number) => {
          if (opts.onConversationComplete) {
            await opts.onConversationComplete(trialIndex, makeTranscript(), {});
          }
          return makeTranscript();
        },
      }; },
    );

    const scenario = makeScenario({ trials: 1 });
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      writePartialTrial,
      onPartialWriteFailed,
    }).run();

    expect(results).toHaveLength(1);
    expect(writePartialTrial).toHaveBeenCalledWith(
      'test-scenario', 0, expect.any(Object), expect.any(Object),
    );
    expect(onPartialWriteFailed).toHaveBeenCalledWith(
      'test-scenario', 0, writeErr,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('writePartialTrial failed'),
      expect.anything(), expect.anything(), expect.anything(),
    );

    // Restore default mock behavior for subsequent tests
    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () { return {
      run: mockSimulationRun,
    }; });
    warnSpy.mockRestore();
  });
});

describe('SuiteRunner — fan-out round-robin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  afterEach(() => {
    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () { return {
      run: mockSimulationRun,
    }; });
  });

  it('builds queue in trial-ordinal order across 4 scenarios', async () => {
    const callOrder: Array<{ scenarioName: string; trialIndex: number }> = [];

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          callOrder.push({ scenarioName: opts.scenario.name, trialIndex });
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const scenarios = [
      makeScenario({ name: 's0', trials: 2 }),
      makeScenario({ name: 's1', trials: 2 }),
      makeScenario({ name: 's2', trials: 2 }),
      makeScenario({ name: 's3', trials: 2 }),
    ];

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(callOrder).toEqual([
      { scenarioName: 's0', trialIndex: 0 },
      { scenarioName: 's1', trialIndex: 0 },
      { scenarioName: 's2', trialIndex: 0 },
      { scenarioName: 's3', trialIndex: 0 },
      { scenarioName: 's0', trialIndex: 1 },
      { scenarioName: 's1', trialIndex: 1 },
      { scenarioName: 's2', trialIndex: 1 },
      { scenarioName: 's3', trialIndex: 1 },
    ]);
  });

  it('keeps all workers busy until the queue drains (4 scenarios × 10 trials, cap 3)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    // Track via mockSimulationRun to avoid extra Promise ticks from Simulation constructor.
    mockSimulationRun.mockImplementation(async function () {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenarios = Array.from({ length: 4 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 10 }),
    );

    const results = await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 3 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(maxInFlight).toBeGreaterThanOrEqual(2); // concurrency is happening
    expect(maxInFlight).toBeLessThanOrEqual(3);    // cap is respected
    expect(mockSimulationRun).toHaveBeenCalledTimes(40);
    expect(results.flatMap((r) => r.trials)).toHaveLength(40);
  });

  it('unequal trial counts — shorter scenario exhausted, tail dispatches solo', async () => {
    const callOrder: Array<{ scenarioName: string; trialIndex: number }> = [];

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          callOrder.push({ scenarioName: opts.scenario.name, trialIndex });
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 5 });
    const s1 = makeScenario({ name: 's1', trials: 2 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(callOrder).toEqual([
      { scenarioName: 's0', trialIndex: 0 },
      { scenarioName: 's1', trialIndex: 0 },
      { scenarioName: 's0', trialIndex: 1 },
      { scenarioName: 's1', trialIndex: 1 },
      { scenarioName: 's0', trialIndex: 2 },
      { scenarioName: 's0', trialIndex: 3 },
      { scenarioName: 's0', trialIndex: 4 },
    ]);
  });

  it('partial failure — scenarios with completed trials produce results', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          if (opts.scenario.name === 's0' && trialIndex === 0) {
            throw new Error('trial failed');
          }
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 2 });
    const s1 = makeScenario({ name: 's1', trials: 2 });

    const results = await new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(results).toHaveLength(2);
    const s0Result = results.find((r) => r.scenarioName === 's0');
    const s1Result = results.find((r) => r.scenarioName === 's1');
    expect(s0Result?.trials).toHaveLength(1); // only trial 1 succeeded
    expect(s1Result?.trials).toHaveLength(2); // both trials succeeded
    expect(warnSpy).toHaveBeenCalledWith(
      'Fan-out trials failed.',
      expect.objectContaining({
        failedTrials: [{ scenarioName: 's0', trialIndex: 0 }],
        errors: ['trial failed'],
      }),
    );

    warnSpy.mockRestore();
  });

  it('resume: trialIndicesByScenario sparse indices produce correct round-robin order', async () => {
    const callOrder: Array<{ scenarioName: string; trialIndex: number }> = [];

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          callOrder.push({ scenarioName: opts.scenario.name, trialIndex });
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 5 });
    const s1 = makeScenario({ name: 's1', trials: 5 });

    const trialIndicesByScenario = new Map<string, number[]>([
      ['s0', [2, 4]],
      ['s1', [1, 3]],
    ]);

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
      trialIndicesByScenario,
    }).run();

    expect(callOrder).toEqual([
      { scenarioName: 's0', trialIndex: 2 },
      { scenarioName: 's1', trialIndex: 1 },
      { scenarioName: 's0', trialIndex: 4 },
      { scenarioName: 's1', trialIndex: 3 },
    ]);
  });

  it('stagger applied only to first cap items — subsequent items dispatch without sleep', async () => {
    // 4 scenarios × 3 trials = 12 queue items; cap=3
    // Items 0–2 get stagger delays 0ms (guard skips), 1000ms, 2000ms.
    // Items 3–11 get delay=0 (i >= cap) — guard skips sleep entirely.
    const scenarios = Array.from({ length: 4 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 3 }),
    );

    await new SuiteRunner({
      scenarios,
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 3 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(vi.mocked(sleep)).toHaveBeenCalledWith(1_000);
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(2_000);
    expect(vi.mocked(sleep)).not.toHaveBeenCalledWith(0);
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(2);
  });

  it('completely failed scenario returns partial results without aborting', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          if (opts.scenario.name === 's0') {
            throw new Error('s0 always fails');
          }
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 2 });
    const s1 = makeScenario({ name: 's1', trials: 2 });

    const results = await new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    // s0 absent (0 completed trials), s1 present with both trials
    expect(results).toHaveLength(1);
    expect(results[0].scenarioName).toBe('s1');
    expect(results[0].trials).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('droppedTrials populated for partial failures alongside a completely failed scenario', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          if (opts.scenario.name === 's0') {
            throw new Error('s0 always fails');
          }
          if (opts.scenario.name === 's1' && trialIndex === 0) {
            throw new Error('s1 trial 0 fails');
          }
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 2 });
    const s1 = makeScenario({ name: 's1', trials: 2 });
    const s2 = makeScenario({ name: 's2', trials: 2 });

    const results = await new SuiteRunner({
      scenarios: [s0, s1, s2],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    // s0 absent, s1 and s2 present
    expect(results).toHaveLength(2);
    const s1Result = results.find((r) => r.scenarioName === 's1');
    const s2Result = results.find((r) => r.scenarioName === 's2');
    expect(s1Result?.droppedTrials).toBe(1);
    expect(s2Result?.droppedTrials).toBeFalsy();

    warnSpy.mockRestore();
  });

  it('droppedTrials is populated on partial failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          if (opts.scenario.name === 's0' && trialIndex === 0) {
            throw new Error('trial failed');
          }
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 3 });
    const s1 = makeScenario({ name: 's1', trials: 2 });

    const results = await new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(results).toHaveLength(2);
    const s0Result = results.find((r) => r.scenarioName === 's0');
    const s1Result = results.find((r) => r.scenarioName === 's1');
    expect(s0Result?.droppedTrials).toBe(1);
    expect(s1Result?.droppedTrials).toBeFalsy();

    warnSpy.mockRestore();
  });

  it('retry-exhaustion in fan-out classifies the trial as droppedTrials', async () => {
    const { InactivityTimeoutError } = await import('../simulation.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    // s0 trial 1 always throws InactivityTimeoutError (exhausts retries).
    // All other trials succeed.
    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          if (opts.scenario.name === 's0' && trialIndex === 1) {
            throw new InactivityTimeoutError(600_000);
          }
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const s0 = makeScenario({ name: 's0', trials: 2 });
    const s1 = makeScenario({ name: 's1', trials: 2 });

    const config: ResolvedConfig = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxConcurrency: 1, maxFirstTurnRetries: 1 },
    };

    const results = await new SuiteRunner({
      scenarios: [s0, s1],
      config,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(results).toHaveLength(2);

    const s0Result = results.find((r) => r.scenarioName === 's0')!;
    const s1Result = results.find((r) => r.scenarioName === 's1')!;

    // s0 trial 1 exhausted retries and was dropped
    expect(s0Result.droppedTrials).toBe(1);
    // s0 trial 0 succeeded and is present
    expect(s0Result.trials).toHaveLength(1);
    expect(s0Result.trials[0].trialIndex).toBe(0);

    // s1 is unaffected
    expect(s1Result.droppedTrials).toBeFalsy();
    expect(s1Result.trials).toHaveLength(2);

    warnSpy.mockRestore();
  });
});

describe('SuiteRunner — trialLifecycle integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  afterEach(() => {
    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () { return {
      run: mockSimulationRun,
    }; });
  });

  it('calls runInScope with correct scenario name and trial index', async () => {
    const calls: Array<{ scenario: string; trialIndex: number }> = [];
    const trialLifecycle: TrialLifecycle = {
      runInScope: <T>(scenario: string, trialIndex: number, fn: () => Promise<T>): Promise<T> => {
        calls.push({ scenario, trialIndex });
        return fn();
      },
      release: vi.fn(),
    };

    const scenario = makeScenario({ name: 'scoped-scenario', trials: 2 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialLifecycle,
    }).run();

    // runInScope is called twice per trial: once for the trial bracket
    // (executeTrialWithCleanup) and once for evaluator execution (evaluateTrial).
    expect(calls).toHaveLength(4);
    expect(calls).toContainEqual({ scenario: 'scoped-scenario', trialIndex: 0 });
    expect(calls).toContainEqual({ scenario: 'scoped-scenario', trialIndex: 1 });
  });

  it('executes the fn argument passed to runInScope (simulation runs inside scope)', async () => {
    const executionOrder: string[] = [];
    let callCount = 0;
    const trialLifecycle: TrialLifecycle = {
      runInScope: <T>(_scenario: string, _trialIndex: number, fn: () => Promise<T>): Promise<T> => {
        callCount++;
        // Only trace the outer (trial-bracket) scope, not the nested evaluator scope
        if (callCount === 1) executionOrder.push('scope-enter');
        const p = fn();
        if (callCount === 1) {
          return p.then((result) => {
            executionOrder.push('scope-exit');
            return result;
          });
        }
        return p;
      },
      release: vi.fn(),
    };

    mockSimulationRun.mockImplementation(async function () {
      executionOrder.push('simulation-run');
      return makeTranscript();
    });

    const scenario = makeScenario({ name: 'exec-scenario', trials: 1 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialLifecycle,
    }).run();

    expect(executionOrder).toEqual(['scope-enter', 'simulation-run', 'scope-exit']);
  });

  it('calls release after trial completes successfully', async () => {
    const release = vi.fn();
    const trialLifecycle: TrialLifecycle = {
      runInScope: <T>(_s: string, _i: number, fn: () => Promise<T>): Promise<T> => fn(),
      release,
    };

    const scenario = makeScenario({ name: 'release-scenario', trials: 2 });

    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialLifecycle,
    }).run();

    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith('release-scenario', 0);
    expect(release).toHaveBeenCalledWith('release-scenario', 1);
  });

  it('calls release even when the simulation throws (finally semantics)', async () => {
    const release = vi.fn();
    const trialLifecycle: TrialLifecycle = {
      runInScope: <T>(_s: string, _i: number, fn: () => Promise<T>): Promise<T> => fn(),
      release,
    };

    mockSimulationRun.mockRejectedValue(new Error('simulation exploded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    const scenario = makeScenario({ name: 'failing-scenario', trials: 1 });

    // The scenario no longer rejects on a failed trial, but release must
    // still fire (finally semantics) before the drop is recorded.
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialLifecycle,
    }).run();

    expect(results[0].droppedTrials).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('failing-scenario', 0);
    warnSpy.mockRestore();
  });

  it('calls release in fan-out mode even when a trial fails', async () => {
    const release = vi.fn();
    const trialLifecycle: TrialLifecycle = {
      runInScope: <T>(_s: string, _i: number, fn: () => Promise<T>): Promise<T> => fn(),
      release,
    };

    (Simulation as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function (opts: { scenario: Scenario }) { return {
        run: async (trialIndex: number): Promise<Transcript> => {
          if (opts.scenario.name === 's0' && trialIndex === 0) {
            throw new Error('fan-out trial exploded');
          }
          return makeTranscript(opts.scenario.name, trialIndex);
        },
      }; },
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    const s0 = makeScenario({ name: 's0', trials: 2 });
    const s1 = makeScenario({ name: 's1', trials: 1 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 1 } },
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialLifecycle,
      suiteMode: 'parallel',
    }).run();

    // All 3 trials should have release called (including the failed one)
    expect(release).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledWith('s0', 0);
    expect(release).toHaveBeenCalledWith('s0', 1);
    expect(release).toHaveBeenCalledWith('s1', 0);

    warnSpy.mockRestore();
  });
});

describe('SuiteRunner — afterSimFailures annotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('annotates evalResult with afterSimulationFailed when afterSimulation throws', async () => {
    const throwingEvaluator: Evaluator = {
      name: 'throwing-eval',
      evaluate: vi.fn().mockResolvedValue(makePassResult('throwing-eval')),
      afterSimulation: vi.fn().mockImplementation(function () {
        throw new Error('afterSim boom');
      }),
    };
    const scenario = makeScenario({ trials: 1, evaluators: [throwingEvaluator] });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();
    warnSpy.mockRestore();

    expect(results).toHaveLength(1);
    const evalResult = results[0].trials[0].evalResults[0];
    expect(evalResult.details?.afterSimulationFailed).toBe(true);
  });

  it('non-throwing evaluators are not annotated with afterSimulationFailed', async () => {
    const okEvaluator: Evaluator = {
      name: 'ok-eval',
      evaluate: vi.fn().mockResolvedValue(makePassResult('ok-eval')),
      afterSimulation: vi.fn(),
    };
    const throwingEvaluator: Evaluator = {
      name: 'throwing-eval',
      evaluate: vi.fn().mockResolvedValue(makePassResult('throwing-eval')),
      afterSimulation: vi.fn().mockImplementation(function () {
        throw new Error('afterSim boom');
      }),
    };
    const scenario = makeScenario({ trials: 1, evaluators: [okEvaluator, throwingEvaluator] });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    const results = await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();
    warnSpy.mockRestore();

    expect(results).toHaveLength(1);
    const [okResult, throwingResult] = results[0].trials[0].evalResults;
    expect(okResult.details?.afterSimulationFailed).toBeUndefined();
    expect(throwingResult.details?.afterSimulationFailed).toBe(true);
  });

  // Uses private-method cast intentionally: tests a defensive internal
  // contract (clear-before-populate on retry) that is not reachable through
  // the public run() API. Retries only trigger when the simulation itself
  // throws, at which point afterSimulation never ran, so no stale entry
  // exists. Keeping the cast ensures the invariant is locked in.
  it('clear-before-populate: successful retry clears stale failure entries', async () => {
    let callCount = 0;
    const flakyEvaluator: Evaluator = {
      name: 'flaky-eval',
      evaluate: vi.fn().mockResolvedValue(makePassResult('flaky-eval')),
      afterSimulation: vi.fn().mockImplementation(function () {
        callCount++;
        if (callCount === 1) {
          throw new Error('first attempt fails');
        }
      }),
    };
    const scenario = makeScenario({ trials: 1, evaluators: [flakyEvaluator] });
    const runner = new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    });

    const afterSimFailures = new Set<string>();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});

    // Attempt 1: afterSimulation throws, entry added
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (runner as any).runSingleTrial(scenario, 0, makeAgentClient, mockSyntheticUser, undefined, afterSimFailures);
    expect(afterSimFailures.has('flaky-eval:0')).toBe(true);

    // Attempt 2 (simulated retry): afterSimulation succeeds, stale entry cleared
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (runner as any).runSingleTrial(scenario, 0, makeAgentClient, mockSyntheticUser, undefined, afterSimFailures);
    expect(afterSimFailures.has('flaky-eval:0')).toBe(false);
    expect(afterSimFailures.size).toBe(0);

    warnSpy.mockRestore();
  });
});
