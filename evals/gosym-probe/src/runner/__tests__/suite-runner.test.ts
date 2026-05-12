import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSimulationRun } = vi.hoisted(() => ({
  mockSimulationRun: vi.fn(),
}));

vi.mock('../simulation.js', () => ({
  Simulation: vi.fn().mockImplementation(() => ({
    run: mockSimulationRun,
  })),
}));

import { SuiteRunner, runCapped } from '../suite-runner.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator, EvalResult } from '../../evaluators/evaluator.js';
import type { Config } from '../../../config/environments/types.js';
import type { AgentClient } from '../../clients/agent-client.js';
import type { SyntheticUserAgent } from '../synthetic-user.js';
import type { Transcript } from '../transcript.js';
import type { BaselineScores } from '../../baselines/types.js';

const mockClient = {
  configure: vi.fn(),
  send: vi.fn(),
  onMessage: vi.fn(),
  disconnect: vi.fn(),
};
const makeAgentClient = async () => mockClient;

const mockSyntheticUser: SyntheticUserAgent = {
  nextMessage: vi.fn().mockResolvedValue(null),
};

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

const mockConfig: Config = {
  env: 'local.test',
  aab: {
    socketUrl: 'http://localhost:4000',
    bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
    controlPlaneUrl: 'http://localhost:4001',
  },
  gocode: { baseUrl: 'http://gocode', apiKey: 'key', model: 'test-model' },
  eval: { defaultTrials: 3, maxTurns: 10, turnTimeoutMs: 5_000 },
  playwright: { ignoreHttpsErrors: true },
  regression: { thresholds: {}, defaultThreshold: 0.1 },
};

function makeTranscript(
  scenarioName = 'test-scenario',
  trialIndex = 0,
): Transcript {
  return { scenarioName, trialIndex, turns: [], snapshots: [], errors: [] };
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

  it('sequential mode: trial N+1 starts after trial N completes', async () => {
    const order: string[] = [];
    mockSimulationRun
      .mockImplementationOnce(async () => {
        order.push('start:0');
        await Promise.resolve();
        order.push('end:0');
        return makeTranscript();
      })
      .mockImplementationOnce(async () => {
        order.push('start:1');
        return makeTranscript();
      });

    const scenario = makeScenario({
      trials: 2,
      executionMode: 'sequential',
    });
    await new SuiteRunner({
      scenarios: [scenario],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
    }).run();

    expect(order).toEqual(['start:0', 'end:0', 'start:1']);
  });

  it('parallel mode: all trials start before any complete', async () => {
    const order: string[] = [];
    const resolvers: (() => void)[] = [];

    // Factory creates a distinct client per call
    const createdClients: AgentClient[] = [];
    const clientFactory = vi.fn().mockImplementation(async () => {
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
      .mockImplementationOnce(() => {
        order.push('start:0');
        return new Promise<Transcript>((r) =>
          resolvers.push(() => {
            order.push('end:0');
            r(makeTranscript());
          }),
        );
      })
      .mockImplementationOnce(() => {
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
      executionMode: 'parallel',
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

    await Promise.resolve(); // flush: both runs should be initiated
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

  it('concurrencyOverride takes precedence over config.eval.maxConcurrency',
    async () => {
      let maxInFlight = 0;
      let inFlight = 0;

      mockSimulationRun.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return makeTranscript();
      });

      // config says maxConcurrency: 1, but override says 3
      const scenario = makeScenario({
        trials: 4,
        executionMode: 'parallel',
      });
      await new SuiteRunner({
        scenarios: [scenario],
        config: {
          ...mockConfig,
          eval: { ...mockConfig.eval, maxConcurrency: 1 },
        },
        makeAgentClient,
        syntheticUser: mockSyntheticUser,
        concurrencyOverride: 3,
      }).run();

      expect(maxInFlight).toBeGreaterThan(1);
      expect(maxInFlight).toBeLessThanOrEqual(3);
    },
  );

  it('executionModeOverride: parallel overrides sequential executionMode',
    async () => {
      const order: string[] = [];
      const resolvers: (() => void)[] = [];

      const clientFactory = vi.fn().mockImplementation(async () => ({
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      }));

      mockSimulationRun
        .mockImplementationOnce(() => {
          order.push('start:0');
          return new Promise<Transcript>((r) =>
            resolvers.push(() => {
              order.push('end:0');
              r(makeTranscript());
            }),
          );
        })
        .mockImplementationOnce(() => {
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
        executionMode: 'sequential',
      });
      const runPromise = new SuiteRunner({
        scenarios: [scenario],
        config: {
          ...mockConfig,
          eval: { ...mockConfig.eval, maxConcurrency: 2 },
        },
        makeAgentClient: clientFactory,
        syntheticUser: mockSyntheticUser,
        executionModeOverride: 'parallel',
      }).run();

      await Promise.resolve();
      resolvers.forEach((r) => r());
      await runPromise;

      // Both trials start before any completes — proves parallel execution
      expect(order.indexOf('start:0')).toBeLessThan(
        order.indexOf('end:0'),
      );
      expect(order.indexOf('start:1')).toBeLessThan(
        order.indexOf('end:0'),
      );
    },
  );

  it('maxConcurrency: 2 with trials: 4 never exceeds 2 in-flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenario = makeScenario({
      trials: 4,
      executionMode: 'parallel',
    });
    const cappedConfig: Config = {
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
    expect(onTrialEvaluated).toHaveBeenNthCalledWith(
      1,
      'my-scenario',
      expect.objectContaining({ trialIndex: 0 }),
    );
    expect(onTrialEvaluated).toHaveBeenNthCalledWith(
      2,
      'my-scenario',
      expect.objectContaining({ trialIndex: 1 }),
    );
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

describe('SuiteRunner — baseline comparison', () => {
  const mockBaselineStore = {
    load: vi.fn<() => Promise<BaselineScores | null>>().mockResolvedValue(null),
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
      scenarioName: 'test-scenario',
      runId: 'baseline-run',
      createdAt: '2026-01-01T00:00:00Z',
      scores: {
        'test-eval': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 3,
          totalTrials: 3,
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
});

describe('SuiteRunner — suiteMode: parallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulationRun.mockResolvedValue(makeTranscript());
  });

  it('forces trials to 1 per scenario', async () => {
    const s0 = makeScenario({ name: 's0', trials: 3 });
    const s1 = makeScenario({ name: 's1', trials: 3 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(2);
  });

  it('forces trials to 1 even with trialsOverride', async () => {
    const s0 = makeScenario({ name: 's0', trials: 3 });
    const s1 = makeScenario({ name: 's1', trials: 3 });

    await new SuiteRunner({
      scenarios: [s0, s1],
      config: mockConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      trialsOverride: 5,
      suiteMode: 'parallel',
    }).run();

    expect(mockSimulationRun).toHaveBeenCalledTimes(2);
  });

  it('runs scenarios concurrently (both start before any complete)', async () => {
    const order: string[] = [];
    const resolvers: (() => void)[] = [];

    const clientFactory = vi.fn().mockImplementation(async () => ({
      configure: vi.fn(),
      send: vi.fn(),
      onMessage: vi.fn(),
      disconnect: vi.fn(),
    }));

    mockSimulationRun
      .mockImplementationOnce(() => {
        order.push('start:s0');
        return new Promise<Transcript>((resolve) =>
          resolvers.push(() => {
            order.push('end:s0');
            resolve(makeTranscript('s0'));
          }),
        );
      })
      .mockImplementationOnce(() => {
        order.push('start:s1');
        return new Promise<Transcript>((resolve) =>
          resolvers.push(() => {
            order.push('end:s1');
            resolve(makeTranscript('s1'));
          }),
        );
      });

    const s0 = makeScenario({ name: 's0', trials: 3 });
    const s1 = makeScenario({ name: 's1', trials: 3 });

    const runPromise = new SuiteRunner({
      scenarios: [s0, s1],
      config: { ...mockConfig, eval: { ...mockConfig.eval, maxConcurrency: 2 } },
      makeAgentClient: clientFactory,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    await Promise.resolve();
    resolvers.forEach((r) => r());
    await runPromise;

    expect(order.indexOf('start:s0')).toBeLessThan(order.indexOf('end:s0'));
    expect(order.indexOf('start:s1')).toBeLessThan(order.indexOf('end:s0'));
    expect(order.indexOf('start:s1')).toBeLessThan(order.indexOf('end:s1'));
  });

  it('respects maxConcurrency cap across scenarios', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockSimulationRun.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeTranscript();
    });

    const scenarios = Array.from({ length: 5 }, (_, i) =>
      makeScenario({ name: `s${i}`, trials: 3 }),
    );
    const cappedConfig: Config = {
      ...mockConfig,
      eval: { ...mockConfig.eval, maxConcurrency: 2 },
    };

    await new SuiteRunner({
      scenarios,
      config: cappedConfig,
      makeAgentClient,
      syntheticUser: mockSyntheticUser,
      suiteMode: 'parallel',
    }).run();

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('default suiteMode runs scenarios sequentially', async () => {
    const order: string[] = [];

    mockSimulationRun
      .mockImplementationOnce(async () => {
        order.push('start:s0');
        await Promise.resolve();
        order.push('end:s0');
        return makeTranscript('s0');
      })
      .mockImplementationOnce(() => {
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
        async (i: number) => {
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
        beforeTrial: vi.fn((_client, i) => {
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
        async (i: number) =>
          makeTranscript('test', i),
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
        async (i: number) =>
          makeTranscript('test', i),
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
