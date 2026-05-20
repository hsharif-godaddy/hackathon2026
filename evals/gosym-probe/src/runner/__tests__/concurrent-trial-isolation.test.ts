/**
 * Integration seam tests: PerTrialGocodeClient isolation through the full SuiteRunner
 * execution path.
 *
 * Strategy: mock Simulation so .run(trialIndex) calls gocodeClient.complete() a
 * known number of times while inside runInScope(scenario, trialIndex, ...). Mock OpenAI
 * to return fixed usage. Assert that TokenUsageEvaluator probe deltas match the per-
 * trial call counts with no cross-trial leakage, both sequentially and concurrently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must precede all module imports
// ---------------------------------------------------------------------------

const { mockCreate, mockSimulationRun } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSimulationRun: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// Simulation is mocked to avoid real Socket.IO connections. The .run() mock
// calls gocodeClient.complete() inside the trial scope so token accumulation
// is exercised without a live AAB instance.
vi.mock('../simulation.js', () => ({
  Simulation: vi.fn().mockImplementation(() => ({
    run: mockSimulationRun,
  })),
  InactivityTimeoutError: class InactivityTimeoutError extends Error {
    constructor(ms: number) {
      super(`Inactivity timeout: ${ms}ms`);
      this.name = 'InactivityTimeoutError';
    }
  },
}));

// Remove stagger delays to keep tests fast and deterministic.
vi.mock('../../util/stagger.js', () => ({
  staggeredRun: vi.fn().mockImplementation(
    (_i: number, _cap: number, fn: () => Promise<unknown>) => fn(),
  ),
  computeStaggerDelay: vi.fn().mockReturnValue(0),
  STAGGER_INTERVAL_MS: 0,
}));

import { PerTrialGocodeClient } from '../../clients/per-trial-gocode-client.js';
import { TokenUsageEvaluator } from '../../evaluators/token-usage.js';
import { TokenUsageCollector } from '../../evaluators/token-usage-collector.js';
import { SuiteRunner } from '../suite-runner.js';
import type { ResolvedConfig } from '../../../config/index.js';
import type { ScenarioResult } from '../types.js';
import type { Scenario } from '../../scenarios/types.js';
import type { AgentClient } from '../../clients/agent-client.js';
import type { SyntheticUserAgent } from '../synthetic-user.js';
import type { Message } from '../../clients/gocode-client.js';
import type { Transcript } from '../transcript.js';
import type { Evaluator } from '../../evaluators/evaluator.js';
import type { TrialLifecycle } from '../../clients/trial-lifecycle.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GOCODE_CONFIG = {
  baseUrl: 'https://gocode.example.com/v1',
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
} as const;

const EVAL_CONFIG: ResolvedConfig = {
  env: 'test',
  aab: { socketUrl: '', bffUrl: '', controlPlaneUrl: '' },
  gocode: GOCODE_CONFIG,
  eval: {
    defaultTrials: 2,
    maxTurns: 5,
    turnTimeoutMs: 5_000,
    firstTurnInactivityMs: 5_000,
    firstTurnRetryScheduleMs: [],
    maxFirstTurnRetries: 0,
    maxConcurrency: 2,
  },
  playwright: { ignoreHttpsErrors: true },
  regression: { defaultThreshold: 0.25, thresholds: {} },
};

// OpenAI mock returns 15 tokens per complete() call.
const MOCK_USAGE_PER_CALL = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};

const MESSAGES: Message[] = [{ role: 'user', content: 'hi' }];

const MOCK_SYNTHETIC_USER: SyntheticUserAgent = {
  nextMessage: vi.fn().mockResolvedValue(null),
};

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let gocodeClient: PerTrialGocodeClient;

beforeEach(() => {
  vi.clearAllMocks();
  gocodeClient = new PerTrialGocodeClient(GOCODE_CONFIG);

  mockCreate.mockResolvedValue({
    choices: [{ message: { content: 'ok' } }],
    usage: MOCK_USAGE_PER_CALL,
  });

  // Trial 0 → 1 gocode call; Trial 1 → 2 gocode calls.
  // SuiteRunner wraps each makeRun in trialLifecycle.runInScope(scenario, trialIndex, ...), so
  // gocodeClient.complete() routes to the correct per-trial instance here.
  mockSimulationRun.mockImplementation(async (trialIndex: number): Promise<Transcript> => {
    const callCount = trialIndex === 0 ? 1 : 2;
    for (let i = 0; i < callCount; i++) {
      await gocodeClient.complete(MESSAGES);
    }
    return {
      scenarioName: 'test-scenario',
      trialIndex,
      turns: [],
      snapshots: [],
      errors: [],
    };
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunner(trialConcurrency: number): SuiteRunner {
  const collector = new TokenUsageCollector();
  const tokenEval = new TokenUsageEvaluator({ collector, gocodeClient });

  const scenario: Scenario = {
    name: 'test-scenario',
    persona: { name: 'test', description: 'test user', systemPrompt: 'You are a test user.' },
    goals: [{ description: 'task done', assertion: 'positive' }],
    evaluators: [tokenEval],
    trials: 2,
  };

  return new SuiteRunner({
    scenarios: [scenario],
    config: EVAL_CONFIG,
    makeAgentClient: async (): Promise<AgentClient> => ({
      configure: vi.fn(),
      send: vi.fn(),
      onMessage: vi.fn(),
      disconnect: vi.fn(),
    }),
    syntheticUser: MOCK_SYNTHETIC_USER,
    trialConcurrency,
    trialLifecycle: gocodeClient,
  });
}

function probeDetails(result: ScenarioResult, trialIndex: number): Record<string, unknown> {
  const trial = result.trials.find((t) => t.trialIndex === trialIndex);
  const evalResult = trial?.evalResults.find((r) => r.evaluator === 'token-usage');
  return (evalResult?.details?.probe ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Integration seam: TokenUsageEvaluator probe delta isolation
// ---------------------------------------------------------------------------

describe('TokenUsageEvaluator probe delta isolation via SuiteRunner', () => {
  it('sequential trials report correct isolated probe deltas', async () => {
    const [result] = await makeRunner(1).run();

    const probe0 = probeDetails(result, 0);
    const probe1 = probeDetails(result, 1);

    // Trial 0 made 1 gocode call → 15 tokens, 1 call
    expect(probe0).toMatchObject({ calls: 1, totalTokens: 15 });
    // Trial 1 made 2 gocode calls → 30 tokens, 2 calls
    expect(probe1).toMatchObject({ calls: 2, totalTokens: 30 });
  });

  it('concurrent trials produce identical probe deltas to sequential execution', async () => {
    const [result] = await makeRunner(2).run();

    const probe0 = probeDetails(result, 0);
    const probe1 = probeDetails(result, 1);

    // Same expectations as sequential: concurrent execution must not contaminate deltas.
    // Without per-trial isolation, trial 0 would absorb trial 1's tokens or vice versa.
    expect(probe0).toMatchObject({ calls: 1, totalTokens: 15 });
    expect(probe1).toMatchObject({ calls: 2, totalTokens: 30 });
  });

  it('concurrent trial 0 delta does not include trial 1 tokens', async () => {
    const [result] = await makeRunner(2).run();

    const probe0 = probeDetails(result, 0);

    // If isolation were broken with a shared client, the delta would be
    // inflated by trial 1's 2 calls (30 tokens), making this 45 or 15+30=45.
    expect(probe0).not.toMatchObject({ totalTokens: 45 });
    expect(probe0).toMatchObject({ totalTokens: 15 });
  });

  it('concurrent trial 1 delta does not include trial 0 tokens', async () => {
    const [result] = await makeRunner(2).run();

    const probe1 = probeDetails(result, 1);

    // If isolation were broken, trial 1 might see trial 0's 1 call in its baseline or delta.
    expect(probe1).toMatchObject({ calls: 2, totalTokens: 30 });
  });

  it('trialLifecycle.release is called for each trial', async () => {
    const releasedKeys: string[] = [];
    const collector = new TokenUsageCollector();
    const tokenEval = new TokenUsageEvaluator({ collector, gocodeClient });

    const scenario: Scenario = {
      name: 'test-scenario',
      persona: { name: 'test', description: 'test', systemPrompt: 'test' },
      goals: [{ description: 'done', assertion: 'positive' }],
      evaluators: [tokenEval],
      trials: 2,
    };

    await new SuiteRunner({
      scenarios: [scenario],
      config: EVAL_CONFIG,
      makeAgentClient: async (): Promise<AgentClient> => ({
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      }),
      syntheticUser: MOCK_SYNTHETIC_USER,
      trialConcurrency: 2,
      trialLifecycle: {
        runInScope: <T>(s: string, i: number, fn: () => Promise<T>) => gocodeClient.runInScope(s, i, fn),
        release: (s: string, i: number) => {
          releasedKeys.push(`${s}:${i}`);
          gocodeClient.release(s, i);
        },
      } as TrialLifecycle,
    }).run();

    expect(releasedKeys).toHaveLength(2);
    expect(releasedKeys).toContain('test-scenario:0');
    expect(releasedKeys).toContain('test-scenario:1');
  });

  it('afterSimulationFailed flag annotates only the throwing evaluator', async () => {
    const collector = new TokenUsageCollector();
    const tokenEval = new TokenUsageEvaluator({ collector, gocodeClient });

    const throwingEvaluator: Evaluator = {
      name: 'throwing-eval',
      evaluate: async () => ({ evaluator: 'throwing-eval', score: 1, verdict: 'pass' as const, reason: 'ok' }),
      afterSimulation: () => { throw new Error('afterSim boom'); },
    };

    const scenario: Scenario = {
      name: 'test-scenario',
      persona: { name: 'test', description: 'test', systemPrompt: 'test' },
      goals: [{ description: 'done', assertion: 'positive' }],
      evaluators: [tokenEval, throwingEvaluator],
      trials: 2,
    };

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: EVAL_CONFIG,
      makeAgentClient: async (): Promise<AgentClient> => ({
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      }),
      syntheticUser: MOCK_SYNTHETIC_USER,
      trialConcurrency: 1,
      trialLifecycle: gocodeClient,
    }).run();

    // Trial completes despite the throwing evaluator.
    expect(result.trials).toHaveLength(2);

    for (const trial of result.trials) {
      const throwingResult = trial.evalResults.find((r) => r.evaluator === 'throwing-eval');
      const tokenResult = trial.evalResults.find((r) => r.evaluator === 'token-usage');

      // The throwing evaluator's result is annotated with afterSimulationFailed.
      expect(throwingResult?.details?.afterSimulationFailed).toBe(true);
      // The non-throwing evaluator does NOT have the flag.
      expect(tokenResult?.details?.afterSimulationFailed).toBeUndefined();
    }
  });

  it('suiteMode parallel: afterSimulationFailed flag set in fan-out path', async () => {
    const collector = new TokenUsageCollector();
    const tokenEval = new TokenUsageEvaluator({ collector, gocodeClient });

    const throwingEvaluator: Evaluator = {
      name: 'throwing-eval',
      evaluate: async () => ({ evaluator: 'throwing-eval', score: 1, verdict: 'pass' as const, reason: 'ok' }),
      afterSimulation: () => { throw new Error('afterSim boom'); },
    };

    const scenario: Scenario = {
      name: 'test-scenario',
      persona: { name: 'test', description: 'test', systemPrompt: 'test' },
      goals: [{ description: 'done', assertion: 'positive' }],
      evaluators: [tokenEval, throwingEvaluator],
      trials: 2,
    };

    const [result] = await new SuiteRunner({
      scenarios: [scenario],
      config: EVAL_CONFIG,
      makeAgentClient: async (): Promise<AgentClient> => ({
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      }),
      syntheticUser: MOCK_SYNTHETIC_USER,
      suiteMode: 'parallel',
      trialLifecycle: gocodeClient,
    }).run();

    // Both trials complete despite the throwing evaluator.
    expect(result.trials).toHaveLength(2);

    for (const trial of result.trials) {
      const throwingResult = trial.evalResults.find((r) => r.evaluator === 'throwing-eval');
      const tokenResult = trial.evalResults.find((r) => r.evaluator === 'token-usage');

      // Fan-out path: throwing evaluator's result is annotated with afterSimulationFailed.
      expect(throwingResult?.details?.afterSimulationFailed).toBe(true);
      // Non-throwing evaluator does NOT have the flag.
      expect(tokenResult?.details?.afterSimulationFailed).toBeUndefined();
    }
  });

  it('release is still called on trial failure', async () => {
    const releasedKeys: string[] = [];
    const collector = new TokenUsageCollector();
    const tokenEval = new TokenUsageEvaluator({ collector, gocodeClient });

    const scenario: Scenario = {
      name: 'test-scenario',
      persona: { name: 'test', description: 'test', systemPrompt: 'test' },
      goals: [{ description: 'done', assertion: 'positive' }],
      evaluators: [tokenEval],
      trials: 2,
    };

    // Trial 0 explodes; trial 1 succeeds normally.
    mockSimulationRun
      .mockRejectedValueOnce(new Error('trial exploded'))
      .mockImplementationOnce(async (trialIndex: number): Promise<Transcript> => {
        await gocodeClient.complete(MESSAGES);
        return {
          scenarioName: 'test-scenario',
          trialIndex,
          turns: [],
          snapshots: [],
          errors: [],
        };
      });

    const runner = new SuiteRunner({
      scenarios: [scenario],
      config: EVAL_CONFIG,
      makeAgentClient: async (): Promise<AgentClient> => ({
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      }),
      syntheticUser: MOCK_SYNTHETIC_USER,
      trialConcurrency: 1,
      trialLifecycle: {
        runInScope: <T>(s: string, i: number, fn: () => Promise<T>) => gocodeClient.runInScope(s, i, fn),
        release: (s: string, i: number) => {
          releasedKeys.push(`${s}:${i}`);
          gocodeClient.release(s, i);
        },
      } as TrialLifecycle,
    });

    try {
      await runner.run();
    } catch {
      // Expected: AggregateError from runCapped because trial 0 threw.
    }

    // release() must be called for BOTH trials regardless of failure.
    expect(releasedKeys).toContain('test-scenario:0');
    expect(releasedKeys).toContain('test-scenario:1');
  });

  it('suiteMode parallel: cross-scenario isolation prevents token contamination', async () => {
    const callMap: Record<string, number> = {
      'scenario-a:0': 1,
      'scenario-a:1': 2,
      'scenario-b:0': 3,
      'scenario-b:1': 4,
    };

    // Override mockSimulationRun to route based on scenario name captured
    // from the Simulation constructor.
    let lastConstructedScenarioName = '';
    const { Simulation } = await import('../simulation.js');
    vi.mocked(Simulation).mockImplementation((opts: unknown) => {
      const { scenario } = opts as { scenario: { name: string } };
      lastConstructedScenarioName = scenario.name;
      return {
        run: async (trialIndex: number): Promise<Transcript> => {
          const key = `${lastConstructedScenarioName}:${trialIndex}`;
          const callCount = callMap[key] ?? 1;
          for (let j = 0; j < callCount; j++) {
            await gocodeClient.complete(MESSAGES);
          }
          return {
            scenarioName: lastConstructedScenarioName,
            trialIndex,
            turns: [],
            snapshots: [],
            errors: [],
          };
        },
      } as unknown as InstanceType<typeof Simulation>;
    });

    const collectorA = new TokenUsageCollector();
    const tokenEvalA = new TokenUsageEvaluator({ collector: collectorA, gocodeClient });
    const scenarioA: Scenario = {
      name: 'scenario-a',
      persona: { name: 'test', description: 'test', systemPrompt: 'test' },
      goals: [{ description: 'done', assertion: 'positive' }],
      evaluators: [tokenEvalA],
      trials: 2,
    };

    const collectorB = new TokenUsageCollector();
    const tokenEvalB = new TokenUsageEvaluator({ collector: collectorB, gocodeClient });
    const scenarioB: Scenario = {
      name: 'scenario-b',
      persona: { name: 'test', description: 'test', systemPrompt: 'test' },
      goals: [{ description: 'done', assertion: 'positive' }],
      evaluators: [tokenEvalB],
      trials: 2,
    };

    const results = await new SuiteRunner({
      scenarios: [scenarioA, scenarioB],
      config: EVAL_CONFIG,
      makeAgentClient: async (): Promise<AgentClient> => ({
        configure: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        disconnect: vi.fn(),
      }),
      syntheticUser: MOCK_SYNTHETIC_USER,
      trialConcurrency: 1,
      scenarioConcurrency: 2,
      suiteMode: 'parallel',
      trialLifecycle: gocodeClient,
    }).run();

    const resultA = results.find((r) => r.scenarioName === 'scenario-a')!;
    const resultB = results.find((r) => r.scenarioName === 'scenario-b')!;

    // Scenario A: trial 0 = 1 call (15 tokens), trial 1 = 2 calls (30 tokens)
    const probeA0 = probeDetails(resultA, 0);
    const probeA1 = probeDetails(resultA, 1);
    expect(probeA0).toMatchObject({ calls: 1, totalTokens: 15 });
    expect(probeA1).toMatchObject({ calls: 2, totalTokens: 30 });

    // Scenario B: trial 0 = 3 calls (45 tokens), trial 1 = 4 calls (60 tokens)
    const probeB0 = probeDetails(resultB, 0);
    const probeB1 = probeDetails(resultB, 1);
    expect(probeB0).toMatchObject({ calls: 3, totalTokens: 45 });
    expect(probeB1).toMatchObject({ calls: 4, totalTokens: 60 });

    // All per-trial instances must be released after the run completes.
    expect(gocodeClient['instances'].size).toBe(0);
  });
});
