import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvalStore } from '../../store/eval-store.js';

const { mockSuiteRunnerRun } = vi.hoisted(() => ({
  mockSuiteRunnerRun: vi.fn(),
}));

vi.mock('../../runner/suite-runner.js', () => ({
  SuiteRunner: vi.fn().mockImplementation(() => ({
    run: mockSuiteRunnerRun,
  })),
}));

import { GraduationRunner } from '../graduation-runner.js';
import { SuiteRunner } from '../../runner/suite-runner.js';
import type {
  ScenarioResult,
  AggregatedResult,
  TrialResult,
} from '../../runner/types.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Config } from '../../../config/environments/types.js';
import type { Transcript } from '../../runner/transcript.js';
import type { EvalResult } from '../../evaluators/evaluator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgg(
  passingTrials: number,
  totalTrials: number,
): AggregatedResult {
  return {
    passAtK: passingTrials > 0,
    passToTheK:
      totalTrials > 0
      && passingTrials === totalTrials,
    passingTrials,
    totalTrials,
  };
}

function makeEvalResult(
  evaluator: string,
  verdict: EvalResult['verdict'],
): EvalResult {
  return {
    evaluator,
    score: verdict === 'pass' ? 1 : 0,
    verdict,
    reason: '',
  };
}

function makeTranscript(trialIndex = 0): Transcript {
  return {
    scenarioName: 'test-scenario',
    trialIndex,
    turns: [],
    snapshots: [],
    errors: [],
  };
}

function makeTrialResult(
  trialIndex: number,
  evalResults: EvalResult[],
): TrialResult {
  return {
    trialIndex,
    transcript: makeTranscript(trialIndex),
    evalResults,
  };
}

/**
 * Build a ScenarioResult where each verdict maps to one trial for
 * 'bug-hit-rate'. All verdicts count toward totalTrials (unknowns
 * are failures, not excluded).
 */
function makeScenarioResult(
  verdicts: EvalResult['verdict'][],
): ScenarioResult {
  const trials = verdicts.map((v, i) =>
    makeTrialResult(i, [makeEvalResult('bug-hit-rate', v)]),
  );
  const passing = verdicts.filter((v) => v === 'pass').length;
  return {
    scenarioName: 'test-scenario',
    stabilityLevel: 'medium',
    trials,
    aggregated: {
      'bug-hit-rate': makeAgg(passing, verdicts.length),
    },
  };
}

const mockScenario: Scenario = {
  name: 'test-scenario',
  persona: {
    name: 'tester',
    description: '',
    systemPrompt: '',
  },
  goals: [],
  evaluators: [],
  trials: 3,
};

const mockConfig: Config = {
  env: 'local.test',
  aab: {
    socketUrl: 'http://localhost:4000',
    bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
    controlPlaneUrl: 'http://localhost:4001',
  },
  gocode: { baseUrl: 'http://gc', apiKey: 'k', model: 'm' },
  eval: { defaultTrials: 3, maxTurns: 10, turnTimeoutMs: 60_000 },
  playwright: { ignoreHttpsErrors: true },
  regression: {
    thresholds: {},
    defaultThreshold: 0.1,
    graduationPassRateThreshold: 0.9,
  },
};

const mockBaselineStore = {
  save: vi.fn<
    (
      runId: string,
      result: ScenarioResult,
      options?: { defaultThreshold?: number },
    ) => Promise<void>
  >().mockResolvedValue(undefined),
};

// ── GraduationRunner ──────────────────────────────────────────────────────────

describe('GraduationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pass rate computation', () => {
    it('all trials pass → passRate = 1.0', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-all-pass');

      expect(result.passRates['bug-hit-rate']).toBe(1.0);
      expect(result.minPassRate).toBe(1.0);
    });

    it('mixed verdicts → fractional pass rate', async () => {
      // 3 pass, 2 fail → 3/5 = 0.6
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'fail', 'fail',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-mixed');

      expect(result.passRates['bug-hit-rate']).toBeCloseTo(0.6);
      expect(result.minPassRate).toBeCloseTo(0.6);
    });

    it('zero trials → NaN pass rate', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-zero-trials');

      expect(Number.isNaN(result.passRates['bug-hit-rate'])).toBe(true);
      expect(Number.isNaN(result.minPassRate)).toBe(true);
    });

    it('unknown verdicts count as failures toward pass rate', async () => {
      // 3 pass, 2 unknown → 3/5 = 0.6 (not 3/3 = 1.0)
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'unknown', 'unknown',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-unknowns');

      expect(result.passRates['bug-hit-rate']).toBeCloseTo(0.6);
    });
  });

  describe('score-mode evaluators excluded from pass rate', () => {
    it('score-mode evaluator with all-observed verdicts does not block promotion', async () => {
      // latency: regressionMode='score', passingTrials=0 → would give passRate=0
      // bug-hit-rate: 5/5 pass-rate evaluator
      // expected: latency is skipped, minPassRate=1.0, promoted=true
      const result: ScenarioResult = {
        scenarioName: 'test-scenario',
        stabilityLevel: 'medium',
        trials: [],
        aggregated: {
          'bug-hit-rate': makeAgg(5, 5),
          'latency': { ...makeAgg(0, 5), regressionMode: 'score' },
        },
      };
      mockSuiteRunnerRun.mockResolvedValue([result]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const r = await runner.run('run-score-excluded');

      expect(r.passRates['latency']).toBeUndefined();
      expect(r.passRates['bug-hit-rate']).toBe(1.0);
      expect(r.minPassRate).toBe(1.0);
      expect(r.promoted).toBe(true);
    });

    it('score-mode evaluator excluded; failing pass-rate evaluator still blocks', async () => {
      const result: ScenarioResult = {
        scenarioName: 'test-scenario',
        stabilityLevel: 'medium',
        trials: [],
        aggregated: {
          'bug-hit-rate': makeAgg(3, 5),
          'latency': { ...makeAgg(0, 5), regressionMode: 'score' },
        },
      };
      mockSuiteRunnerRun.mockResolvedValue([result]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const r = await runner.run('run-score-fail-other');

      expect(r.passRates['latency']).toBeUndefined();
      expect(r.passRates['bug-hit-rate']).toBeCloseTo(0.6);
      expect(r.promoted).toBe(false);
    });

    it('all evaluators score-mode → NaN minPassRate → not promoted', async () => {
      const result: ScenarioResult = {
        scenarioName: 'test-scenario',
        stabilityLevel: 'medium',
        trials: [],
        aggregated: {
          'latency': { ...makeAgg(0, 5), regressionMode: 'score' },
        },
      };
      mockSuiteRunnerRun.mockResolvedValue([result]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const r = await runner.run('run-all-score');

      expect(Object.keys(r.passRates)).toHaveLength(0);
      expect(Number.isNaN(r.minPassRate)).toBe(true);
      expect(r.promoted).toBe(false);
    });
  });

  describe('promotion gate', () => {
    it('all evaluators >= threshold → promoted', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-promoted');

      expect(result.promoted).toBe(true);
    });

    it('any evaluator below threshold → not promoted', async () => {
      // 3/5 = 0.6 < 0.9
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'fail', 'fail',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-not-promoted');

      expect(result.promoted).toBe(false);
    });

    it('reads graduationPassRateThreshold from config', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-threshold');

      expect(result.passRateThreshold).toBe(0.9);
    });

    it('defaults to 0.9 when absent from config', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const configNoGrad: Config = {
        ...mockConfig,
        regression: { thresholds: {}, defaultThreshold: 0.1 },
      };
      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: configNoGrad,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-default-threshold');

      expect(result.passRateThreshold).toBe(0.9);
    });

    it('not promoted when NaN minPassRate (zero trials)', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-nan-promoted');

      expect(result.promoted).toBe(false);
    });

    it('minPassRate is the lowest rate across all evaluators', async () => {
      // Build a result with two evaluators:
      //   eval-a: 5/5 = 1.0
      //   eval-b: 3/5 = 0.6
      // minPassRate should be 0.6 → not promoted
      const twoEvalResult: ScenarioResult = {
        scenarioName: 'test-scenario',
        stabilityLevel: 'medium',
        trials: [],
        aggregated: {
          'eval-a': makeAgg(5, 5),
          'eval-b': makeAgg(3, 5),
        },
      };
      mockSuiteRunnerRun.mockResolvedValue([twoEvalResult]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-multi-eval');

      expect(result.minPassRate).toBeCloseTo(0.6);
      expect(result.promoted).toBe(false);
    });
  });

  describe('baseline save gated on promotion', () => {
    it('saves baseline when promoted', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-save-promoted');

      expect(mockBaselineStore.save).toHaveBeenCalledWith(
        'run-save-promoted',
        expect.objectContaining({
          scenarioName: 'test-scenario',
        }),
        { defaultThreshold: 0.1 },
      );
    });

    it('does not save baseline when not promoted', async () => {
      // 3/5 = 0.6 < 0.9 → not promoted, baseline must not be overwritten
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'fail', 'fail',
        ]),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'medium' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-save-not-promoted');

      expect(mockBaselineStore.save).not.toHaveBeenCalled();
    });
  });

  describe('stability-based trial counts', () => {
    it('low stability → trialsOverride=3', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'low' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-low');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialsOverride: 3 }),
      );
      expect(result.stabilityLevel).toBe('low');
      expect(result.stabilityTrials).toBe(3);
    });

    it('medium stability → trialsOverride=5', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'medium' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-medium');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialsOverride: 5 }),
      );
    });

    it('high stability → trialsOverride=10', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'high' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-high');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialsOverride: 10 }),
      );
    });

    it('no stabilityLevel defaults to low → trialsOverride=3',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass',
          ]),
        ]);

        // mockScenario has no stabilityLevel field
        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
        });
        await runner.run('run-default');

        expect(SuiteRunner).toHaveBeenCalledWith(
          expect.objectContaining({ trialsOverride: 3 }),
        );
      },
    );

    it('GraduationResult includes stabilityLevel and stabilityTrials',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
            'pass', 'pass', 'pass', 'pass', 'pass',
          ]),
        ]);

        const scenario = {
          ...mockScenario,
          stabilityLevel: 'high' as const,
        };
        const runner = new GraduationRunner({
          scenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
        });
        const result = await runner.run('run-high-result');

        expect(result.stabilityLevel).toBe('high');
        expect(result.stabilityTrials).toBe(10);
      },
    );
  });

  describe('concurrency passthrough', () => {
    it('passes concurrencyOverride to SuiteRunner', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        concurrencyOverride: 4,
      });
      await runner.run('run-conc');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ concurrencyOverride: 4 }),
      );
    });
  });

  describe('execution mode override', () => {
    it('low stability → no executionModeOverride', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass']),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'low' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-low-mode');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ executionModeOverride: undefined }),
      );
    });

    it('medium stability → executionModeOverride: parallel', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'medium' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-medium-mode');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ executionModeOverride: 'parallel' }),
      );
    });

    it('high stability → executionModeOverride: parallel', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'high' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-high-mode');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ executionModeOverride: 'parallel' }),
      );
    });
  });

  describe('stabilityLevelOverride', () => {
    it('overrides the scenario stabilityLevel', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'medium' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        stabilityLevelOverride: 'high',
      });
      const result = await runner.run('run-override');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialsOverride: 10 }),
      );
      expect(result.stabilityLevel).toBe('high');
      expect(result.stabilityTrials).toBe(10);
    });

    it('overrides the default when scenario has no stabilityLevel',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult(['pass', 'pass', 'pass']),
        ]);

        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
          stabilityLevelOverride: 'low',
        });
        const result = await runner.run('run-override-default');

        expect(SuiteRunner).toHaveBeenCalledWith(
          expect.objectContaining({ trialsOverride: 3 }),
        );
        expect(result.stabilityLevel).toBe('low');
        expect(result.stabilityTrials).toBe(3);
      },
    );

    it('falls back to scenario level when override is undefined',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
            'pass', 'pass', 'pass', 'pass', 'pass',
          ]),
        ]);

        const scenario = {
          ...mockScenario,
          stabilityLevel: 'high' as const,
        };
        const runner = new GraduationRunner({
          scenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
          stabilityLevelOverride: undefined,
        });
        await runner.run('run-no-override');

        expect(SuiteRunner).toHaveBeenCalledWith(
          expect.objectContaining({ trialsOverride: 10 }),
        );
      },
    );

    it('result reflects override, not scenario stabilityLevel', async () => {
      // scenario.stabilityLevel = 'medium', override = 'high'
      // result.stabilityLevel must be 'high'
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
          'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const scenario = {
        ...mockScenario,
        stabilityLevel: 'medium' as const,
      };
      const runner = new GraduationRunner({
        scenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        stabilityLevelOverride: 'high',
      });
      const result = await runner.run('run-override-reflected');

      expect(result.stabilityLevel).toBe('high');
    });
  });

  describe('SuiteRunner is called without baselineStore', () => {
    it('never passes baselineStore so baseline comparison is skipped',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
          ]),
        ]);

        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
        });
        await runner.run('run-006');

        expect(SuiteRunner).toHaveBeenCalledWith(
          expect.not.objectContaining({
            baselineStore: expect.anything(),
          }),
        );
      },
    );
  });

  describe('EvalStore persistence', () => {
    it('saves with kind:graduation when store provided and stable',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass', 'pass',
          ]),
        ]);

        const mockStore = {
          save: vi.fn<EvalStore['save']>().mockResolvedValue('/path'),
          initRun: vi
            .fn<EvalStore['initRun']>()
            .mockResolvedValue('20260101_run-store-stable'),
          ensureTrialDir: vi
            .fn<EvalStore['ensureTrialDir']>()
            .mockResolvedValue('/tmp/trial'),
        };
        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
          store: mockStore as unknown as EvalStore,
        });
        await runner.run('run-store-stable');

        expect(mockStore.save).toHaveBeenCalledWith(
          'run-store-stable',
          [expect.objectContaining({ scenarioName: 'test-scenario' })],
          [mockScenario],
          mockConfig,
          expect.objectContaining({
            kind: 'graduation',
            dirName: '20260101_run-store-stable',
          }),
        );
      },
    );

    it('saves with kind:graduation when store provided and unstable',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'fail', 'fail', 'fail', 'pass', 'pass', 'pass',
          ]),
        ]);

        const mockStore = {
          save: vi.fn<EvalStore['save']>().mockResolvedValue('/path'),
          initRun: vi
            .fn<EvalStore['initRun']>()
            .mockResolvedValue('20260101_run-store-unstable'),
          ensureTrialDir: vi
            .fn<EvalStore['ensureTrialDir']>()
            .mockResolvedValue('/tmp/trial'),
        };
        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
          store: mockStore as unknown as EvalStore,
        });
        await runner.run('run-store-unstable');

        expect(mockStore.save).toHaveBeenCalledWith(
          'run-store-unstable',
          [expect.objectContaining({ scenarioName: 'test-scenario' })],
          [mockScenario],
          mockConfig,
          expect.objectContaining({
            kind: 'graduation',
            dirName: '20260101_run-store-unstable',
          }),
        );
      },
    );

    it('calls initRun exactly once — never twice (double-dir bug guard)',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass', 'pass',
          ]),
        ]);

        const mockStore = {
          save: vi.fn<EvalStore['save']>().mockResolvedValue('/path'),
          initRun: vi
            .fn<EvalStore['initRun']>()
            .mockResolvedValue('20260101_run-once'),
          ensureTrialDir: vi
            .fn<EvalStore['ensureTrialDir']>()
            .mockResolvedValue('/tmp/trial'),
        };
        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
          store: mockStore as unknown as EvalStore,
        });
        await runner.run('run-once');

        expect(mockStore.initRun).toHaveBeenCalledTimes(1);
      },
    );

    it('does not call store.save when store is not provided', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass', 'pass',
        ]),
      ]);

      const mockStore = {
        save: vi.fn<EvalStore['save']>().mockResolvedValue('/path'),
      };
      // Runner constructed without store
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-no-store');

      expect(mockStore.save).not.toHaveBeenCalled();
    });
  });

  describe('scenario file is never mutated', () => {
    it('only calls baselineStore.save — no other write operations',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
          ]),
        ]);

        const savespy = vi.spyOn(mockBaselineStore, 'save');

        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
        });
        await runner.run('run-007');

        expect(savespy).toHaveBeenCalledTimes(1);
        const [, savedResult] = savespy.mock.calls[0];
        expect(savedResult).toHaveProperty('aggregated');
        expect(savedResult).not.toHaveProperty('persona');
      },
    );
  });
});
