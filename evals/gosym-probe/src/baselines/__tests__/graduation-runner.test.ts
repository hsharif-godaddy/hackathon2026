import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvalStore } from '../../store/eval-store.js';

const { mockSuiteRunnerRun } = vi.hoisted(() => ({
  mockSuiteRunnerRun: vi.fn(),
}));

vi.mock('../../runner/suite-runner.js', () => ({
  SuiteRunner: vi.fn().mockImplementation(function () { return {
    run: mockSuiteRunnerRun,
  }; }),
}));

import { GraduationRunner, isDeferredResult } from '../graduation-runner.js';
import { SuiteRunner } from '../../runner/suite-runner.js';
import type {
  ScenarioResult,
  AggregatedResult,
  TrialResult,
} from '../../runner/types.js';
import type { Scenario } from '../../scenarios/types.js';
import type { ResolvedConfig } from '../../../config/index.js';
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
    captureErrors: [],
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

function makeMockStore() {
  return {
    save: vi.fn<EvalStore['save']>().mockResolvedValue('/path'),
    initRun: vi.fn<EvalStore['initRun']>().mockResolvedValue('mock-dir'),
    loadRunMetadataByDirName: vi.fn<EvalStore['loadRunMetadataByDirName']>().mockResolvedValue(null),
    ensureTrialDir: vi.fn<EvalStore['ensureTrialDir']>().mockResolvedValue('/tmp/trial'),
    writeTrial: vi.fn<EvalStore['writeTrial']>().mockResolvedValue(undefined),
    writePartialTrial: vi.fn<EvalStore['writePartialTrial']>().mockResolvedValue(undefined),
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

const mockConfig: ResolvedConfig = {
  env: 'local.test',
  aab: {
    socketUrl: 'http://localhost:4000',
    bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
    controlPlaneUrl: 'http://localhost:4001',
  },
  gocode: { baseUrl: 'http://gc', apiKey: 'k', model: 'm' },
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
  regression: {
    alpha: 0.05,
    k: 2.0,
    minMargin: 0.05,
    fallbackThresholds: { thresholds: {}, defaultThreshold: 0.1 },
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

  describe('stability-based trial counts', () => {
    it('low stability → trialsOverride=5', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass', 'pass', 'pass']),
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
        expect.objectContaining({ trialsOverride: 5 }),
      );
      expect(result.stabilityLevel).toBe('low');
      expect(result.stabilityTrials).toBe(5);
    });

    it('medium stability → trialsOverride=10', async () => {
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
      });
      await runner.run('run-medium');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialsOverride: 10 }),
      );
    });

    it('high stability → trialsOverride=20', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
          'pass', 'pass', 'pass', 'pass', 'pass',
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
        expect.objectContaining({ trialsOverride: 20 }),
      );
    });

    it('no stabilityLevel defaults to low → trialsOverride=5',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
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
          expect.objectContaining({ trialsOverride: 5 }),
        );
      },
    );

    it('GraduationResult includes stabilityLevel and stabilityTrials',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
            'pass', 'pass', 'pass', 'pass', 'pass',
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
        expect(result.stabilityTrials).toBe(20);
      },
    );
  });

  describe('concurrency passthrough', () => {
    it('passes trialConcurrency to SuiteRunner', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        trialConcurrency: 4,
      });
      await runner.run('run-conc');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialConcurrency: 4 }),
      );
    });

    it('without trialConcurrency, does not force parallelism', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'high' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
        // no trialConcurrency
      });
      await runner.run('run-no-forced-conc');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ trialConcurrency: undefined }),
      );
    });
  });

  describe('stabilityLevelOverride', () => {
    it('overrides the scenario stabilityLevel', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult([
          'pass', 'pass', 'pass', 'pass', 'pass',
          'pass', 'pass', 'pass', 'pass', 'pass',
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
        expect.objectContaining({ trialsOverride: 20 }),
      );
      expect(result.stabilityLevel).toBe('high');
      expect(result.stabilityTrials).toBe(20);
    });

    it('overrides the default when scenario has no stabilityLevel',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult(['pass', 'pass', 'pass', 'pass', 'pass']),
        ]);

        const runner = new GraduationRunner({
          scenario: mockScenario,
          config: mockConfig,
          baselineStore: mockBaselineStore,
          stabilityLevelOverride: 'low',
        });
        const result = await runner.run('run-override-default');

        expect(SuiteRunner).toHaveBeenCalledWith(
          expect.objectContaining({ trialsOverride: 5 }),
        );
        expect(result.stabilityLevel).toBe('low');
        expect(result.stabilityTrials).toBe(5);
      },
    );

    it('falls back to scenario level when override is undefined',
      async () => {
        mockSuiteRunnerRun.mockResolvedValue([
          makeScenarioResult([
            'pass', 'pass', 'pass', 'pass', 'pass',
            'pass', 'pass', 'pass', 'pass', 'pass',
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
          expect.objectContaining({ trialsOverride: 20 }),
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
          loadRunMetadataByDirName: vi.fn<EvalStore['loadRunMetadataByDirName']>().mockResolvedValue(null),
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
          loadRunMetadataByDirName: vi.fn<EvalStore['loadRunMetadataByDirName']>().mockResolvedValue(null),
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
          loadRunMetadataByDirName: vi.fn<EvalStore['loadRunMetadataByDirName']>().mockResolvedValue(null),
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

  describe('baseline saved unconditionally', () => {
    it('saves baseline even when all verdicts fail', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['fail', 'fail', 'fail']),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'low' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-always-save-fail');

      expect(mockBaselineStore.save).toHaveBeenCalledWith(
        'run-always-save-fail',
        expect.objectContaining({ scenarioName: 'test-scenario' }),
        { defaultThreshold: 0.1 },
      );
    });

    it('saves baseline when all verdicts pass', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'low' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-always-save-pass');

      expect(mockBaselineStore.save).toHaveBeenCalledWith(
        'run-always-save-pass',
        expect.objectContaining({ scenarioName: 'test-scenario' }),
        { defaultThreshold: 0.1 },
      );
    });
  });

  describe('GraduationResult shape', () => {
    it('result contains scenarioName, stabilityLevel, stabilityTrials, baselineSaved', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'low' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-shape');

      expect(result).toHaveProperty('scenarioName', 'test-scenario');
      expect(result).toHaveProperty('stabilityLevel', 'low');
      expect(result).toHaveProperty('stabilityTrials', 5);
      expect(result).toHaveProperty('baselineSaved', true);
      expect(Object.keys(result)).toHaveLength(4);
    });

    it('result does not contain promoted, passRates, minPassRate, passRateThreshold', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: { ...mockScenario, stabilityLevel: 'low' },
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-no-gate-fields');

      expect('promoted' in result).toBe(false);
      expect('passRates' in result).toBe(false);
      expect('minPassRate' in result).toBe(false);
      expect('passRateThreshold' in result).toBe(false);
    });
  });

  describe('baseline save sanity check', () => {
    it('skips baseline save when all trial verdicts are unknown', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['unknown', 'unknown', 'unknown']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-all-unknown');

      expect(mockBaselineStore.save).not.toHaveBeenCalled();
      expect(result.baselineSaved).toBe(false);
    });

    it('saves baseline when verdicts include fail (fail != unknown)', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['fail', 'fail', 'fail']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-all-fail');

      expect(mockBaselineStore.save).toHaveBeenCalledOnce();
      expect(result.baselineSaved).toBe(true);
    });

    it('saves baseline when mix of pass and unknown', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'unknown', 'unknown']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-mixed');

      expect(mockBaselineStore.save).toHaveBeenCalledOnce();
      expect(result.baselineSaved).toBe(true);
    });
  });

  describe('shared run folder (dirName + skipFinalize)', () => {
    it('throws when skipFinalize is true without dirName', () => {
      expect(() => new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        skipFinalize: true,
        store: makeMockStore() as unknown as EvalStore,
      } as any)).toThrow('skipFinalize requires dirName');
    });

    it('skips initRun when dirName is provided', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'shared-dir',
        skipFinalize: true,
      });
      await runner.run('shared-run-id');

      expect(mockStore.initRun).not.toHaveBeenCalled();
    });

    it('writes trials directly instead of calling save when skipFinalize is true', async () => {
      const scenarioResult = makeScenarioResult(['pass', 'fail', 'pass']);
      mockSuiteRunnerRun.mockResolvedValue([scenarioResult]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'shared-dir',
        skipFinalize: true,
      });
      await runner.run('shared-run-id');

      expect(mockStore.save).not.toHaveBeenCalled();
      expect(mockStore.writeTrial).toHaveBeenCalledTimes(3);
      for (let i = 0; i < 3; i++) {
        expect(mockStore.writeTrial).toHaveBeenCalledWith(
          'shared-dir',
          'test-scenario',
          expect.objectContaining({ trialIndex: i }),
        );
      }
    });

    it('returns scenarioResult when skipFinalize is true', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'shared-dir',
        skipFinalize: true,
      });
      const result = await runner.run('shared-run-id');

      expect(result.scenarioResult).toBeDefined();
      expect(result.scenarioResult!.scenarioName).toBe('test-scenario');
      expect(result.scenarioResult!.trials).toHaveLength(3);
    });

    it('does not return scenarioResult when skipFinalize is false', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-no-skip');

      expect(result.scenarioResult).toBeUndefined();
    });

    it('still saves baseline when skipFinalize is true', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'shared-dir',
        skipFinalize: true,
      });
      await runner.run('shared-run-id');

      expect(mockBaselineStore.save).toHaveBeenCalledWith(
        'shared-run-id',
        expect.objectContaining({ scenarioName: 'test-scenario' }),
        { defaultThreshold: 0.1 },
      );
    });

    it('uses provided dirName for ensureTrialDir', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'pre-created-dir',
        skipFinalize: true,
      });
      await runner.run('shared-run-id');

      // SuiteRunner should have been constructed with getTrialOutputDir
      // that uses the provided dirName
      const suiteRunnerOpts = vi.mocked(SuiteRunner).mock.calls[0][0];
      expect(suiteRunnerOpts.getTrialOutputDir).toBeDefined();
    });
  });

  describe('isDeferredResult type guard', () => {
    it('returns true when scenarioResult is present', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'shared-dir',
        skipFinalize: true,
      });
      const result = await runner.run('run-deferred');
      expect(isDeferredResult(result)).toBe(true);
    });

    it('returns false when scenarioResult is undefined', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      const result = await runner.run('run-standalone');
      expect(isDeferredResult(result)).toBe(false);
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

  describe('partial trial persistence (writePartialTrial)', () => {
    it('passes writePartialTrial to SuiteRunner when store and dirName are available', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'partial-dir',
        skipFinalize: true,
      });
      await runner.run('run-partial');

      const suiteRunnerOpts = vi.mocked(SuiteRunner).mock.calls[0][0];
      expect(suiteRunnerOpts.writePartialTrial).toBeDefined();
    });

    it('does not pass writePartialTrial to SuiteRunner when no store', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-no-partial');

      const suiteRunnerOpts = vi.mocked(SuiteRunner).mock.calls[0][0];
      expect(suiteRunnerOpts.writePartialTrial).toBeUndefined();
    });

    it('writePartialTrial callback delegates to store.writePartialTrial with dirName', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = makeMockStore();
      mockStore.writePartialTrial = vi.fn().mockResolvedValue(undefined);
      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
        dirName: 'delegate-dir',
        skipFinalize: true,
      });
      await runner.run('run-delegate');

      const suiteRunnerOpts = vi.mocked(SuiteRunner).mock.calls[0][0];
      const fakeTranscript = makeTranscript(0);
      await suiteRunnerOpts.writePartialTrial!(
        'test-scenario', 0, fakeTranscript,
      );

      expect(mockStore.writePartialTrial).toHaveBeenCalledWith(
        'delegate-dir', 'test-scenario', 0, fakeTranscript,
      );
    });
  });

  describe('onTrialEvaluated forwarding', () => {
    it('forwards onTrialEvaluated to SuiteRunner when provided', async () => {
      const onTrialEvaluated = vi.fn();
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        onTrialEvaluated,
      });
      await runner.run('run-cb');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.objectContaining({ onTrialEvaluated }),
      );
    });

    it('does not pass onTrialEvaluated to SuiteRunner when omitted', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
      });
      await runner.run('run-no-cb');

      expect(SuiteRunner).toHaveBeenCalledWith(
        expect.not.objectContaining({ onTrialEvaluated: expect.anything() }),
      );
    });
  });

  describe('git field propagation', () => {
    it('passes gitSha and gitBranch from run metadata to baselineStore.save', async () => {
      mockSuiteRunnerRun.mockResolvedValue([
        makeScenarioResult(['pass', 'pass', 'pass']),
      ]);

      const mockStore = {
        save: vi.fn<EvalStore['save']>().mockResolvedValue('/path'),
        initRun: vi
          .fn<EvalStore['initRun']>()
          .mockResolvedValue('20260101_run-git-fields'),
        loadRunMetadataByDirName: vi
          .fn<EvalStore['loadRunMetadataByDirName']>()
          .mockResolvedValue({
            runId: 'run-git-fields',
            timestamp: '2026-01-01T00:00:00.000Z',
            gitSha: 'abc1234',
            gitBranch: 'feat/test',
            scenarios: ['test-scenario'],
            config: mockConfig as unknown as import('../../util/sanitize.js').SanitizedConfig,
            maxTurns: mockConfig.eval.maxTurns,
          }),
        ensureTrialDir: vi
          .fn<EvalStore['ensureTrialDir']>()
          .mockResolvedValue('/tmp/trial'),
        writePartialTrial: vi
          .fn<EvalStore['writePartialTrial']>()
          .mockResolvedValue(undefined),
      };

      const runner = new GraduationRunner({
        scenario: mockScenario,
        config: mockConfig,
        baselineStore: mockBaselineStore,
        store: mockStore as unknown as EvalStore,
      });
      await runner.run('run-git-fields');

      expect(mockBaselineStore.save).toHaveBeenCalledWith(
        'run-git-fields',
        expect.objectContaining({ scenarioName: 'test-scenario' }),
        expect.objectContaining({
          defaultThreshold: 0.1,
          gitSha: 'abc1234',
          gitBranch: 'feat/test',
        }),
      );
    });
  });
});
