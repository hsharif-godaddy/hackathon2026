import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaselineStore } from '../baseline-store.js';
import type {
  ScenarioResult,
  TrialResult,
} from '../../runner/types.js';
import type { BaselineScores } from '../types.js';
import type { StoredAggregated } from '../../store/types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';

const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockReaddir = readdir as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

const FIXED_ISO = '2026-04-13T14:30:25.000Z';
const FIXED_COMPACT = '20260413143025';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMinimalTrial(trialIndex: number): TrialResult {
  return {
    trialIndex,
    transcript: {
      scenarioName: 'build-landing-page',
      trialIndex,
      turns: [],
      snapshots: [],
      errors: [],
    },
    evalResults: [],
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const SCENARIO_RESULT: ScenarioResult = {
  scenarioName: 'build-landing-page',
  stabilityLevel: 'medium',
  trials: [],
  aggregated: {
    'bug-hit-rate': {
      passAtK: true,
      passToTheK: false,
      passingTrials: 2,
      totalTrials: 3,
    },
    'prompt-efficiency': {
      passAtK: false,
      passToTheK: false,
      passingTrials: 0,
      totalTrials: 3,
    },
  },
};

const STORED_BASELINE: BaselineScores = {
  scenarioName: 'build-landing-page',
  runId: 'run-001',
  createdAt: '2026-04-03T00:00:00.000Z',
  scores: {
    'bug-hit-rate': {
      passAtK: true,
      passToTheK: false,
      passingTrials: 2,
      totalTrials: 3,
    },
  },
};

const STORED_AGGREGATED: StoredAggregated = {
  scenarioName: 'build-landing-page',
  evaluators: {
    'bug-hit-rate': {
      passAtK: true,
      passToTheK: false,
      passingTrials: 2,
      totalTrials: 5,
      scores: { min: 0, max: 1, mean: 0.4, median: 0, stddev: 0 },
      verdicts: { pass: 2, fail: 3 },
    },
  },
  timing: {
    totalDurationMs: 10000,
    avgTrialDurationMs: 2000,
    avgTurnsPerTrial: 4,
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BaselineStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date(FIXED_ISO));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
  });

  describe('save()', () => {
    it('creates the scenario subdirectory before writing', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      expect(mockMkdir).toHaveBeenCalledWith(
        'baselines/build-landing-page',
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledBefore(mockWriteFile);
    });

    it('writes to baselines/<scenario>/<ts>_<runId>.json', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      const [path] = mockWriteFile.mock.calls[0];
      expect(path).toBe(
        `baselines/build-landing-page/${FIXED_COMPACT}_run-001.json`,
      );
    });

    it('respects custom baselines directory', async () => {
      const store = new BaselineStore('/custom/baselines');
      await store.save('run-001', SCENARIO_RESULT);

      expect(mockMkdir).toHaveBeenCalledWith(
        '/custom/baselines/build-landing-page',
        { recursive: true },
      );
      const [path] = mockWriteFile.mock.calls[0];
      expect(path).toBe(
        `/custom/baselines/build-landing-page/${FIXED_COMPACT}_run-001.json`,
      );
    });

    it('stores aggregated metrics — not raw trial data', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;

      expect(parsed.scores['bug-hit-rate']).toEqual({
        passAtK: true,
        passToTheK: false,
        passingTrials: 2,
        totalTrials: 3,
      });
      expect(parsed.scores['prompt-efficiency']).toEqual({
        passAtK: false,
        passToTheK: false,
        passingTrials: 0,
        totalTrials: 3,
      });
    });

    it('does not embed raw trial transcripts', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('trials');
    });

    it('includes runId, scenarioName, createdAt', async () => {
      const store = new BaselineStore();
      await store.save('run-42', SCENARIO_RESULT);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;

      expect(parsed.runId).toBe('run-42');
      expect(parsed.scenarioName).toBe('build-landing-page');
      expect(typeof parsed.createdAt).toBe('string');
      expect(() => new Date(parsed.createdAt)).not.toThrow();
    });

    it('writes pretty-printed JSON', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      const [, raw] = mockWriteFile.mock.calls[0];
      expect(raw as string).toContain('  "runId"');
    });

    it('persists stabilityLevel from result', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;

      expect(parsed.stabilityLevel).toBe('medium');
    });

    it('persists stabilityTrials as trial count from result', async () => {
      const result: ScenarioResult = {
        ...SCENARIO_RESULT,
        trials: [
          makeMinimalTrial(0),
          makeMinimalTrial(1),
          makeMinimalTrial(2),
        ],
      };
      const store = new BaselineStore();
      await store.save('run-001', result);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;

      expect(parsed.stabilityTrials).toBe(3);
    });
  });

  describe('save() — score-mode handling', () => {
    it(
      'does not write medianScore for pass-rate '
      + 'evaluators',
      async () => {
        const store = new BaselineStore();
        const result: ScenarioResult = {
          ...SCENARIO_RESULT,
          aggregated: {
            'output-quality': {
              passAtK: true,
              passToTheK: false,
              passingTrials: 2,
              totalTrials: 3,
              medianScore: 0.67,
            },
          },
        };
        await store.save('run-001', result);

        const [, raw] = mockWriteFile.mock.calls[0];
        const parsed = JSON.parse(
          raw as string,
        ) as BaselineScores;
        expect(
          parsed.scores['output-quality'],
        ).not.toHaveProperty('medianScore');
      },
    );

    it(
      'writes medianScore for score-mode evaluators',
      async () => {
        const store = new BaselineStore();
        const result: ScenarioResult = {
          ...SCENARIO_RESULT,
          aggregated: {
            'latency': {
              passAtK: true,
              passToTheK: true,
              passingTrials: 3,
              totalTrials: 3,
              medianScore: 0.75,
              regressionMode: 'score',
            },
          },
        };
        await store.save('run-001', result);

        const [, raw] = mockWriteFile.mock.calls[0];
        const parsed = JSON.parse(
          raw as string,
        ) as BaselineScores;
        expect(
          parsed.scores['latency']?.medianScore,
        ).toBe(0.75);
      },
    );
  });

  describe('save() — passAtK/passToTheK conditional', () => {
    it('omits passAtK and passToTheK for score-mode evaluator (passAtK absent)', async () => {
      const store = new BaselineStore();
      const result: ScenarioResult = {
        ...SCENARIO_RESULT,
        aggregated: {
          'latency': {
            passingTrials: 3,
            totalTrials: 3,
            medianScore: 0.75,
            regressionMode: 'score',
          },
        },
      };
      await store.save('run-001', result);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['latency']).not.toHaveProperty('passAtK');
      expect(parsed.scores['latency']).not.toHaveProperty('passToTheK');
    });

    it('preserves passAtK and passToTheK for pass-rate evaluators', async () => {
      const store = new BaselineStore();
      await store.save('run-001', SCENARIO_RESULT);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['bug-hit-rate']).toHaveProperty('passAtK', true);
      expect(parsed.scores['bug-hit-rate']).toHaveProperty('passToTheK', false);
    });
  });

  describe('save() — existingBaseline optimization', () => {
    const SCORE_RESULT: ScenarioResult = {
      ...SCENARIO_RESULT,
      aggregated: {
        'latency': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 3,
          totalTrials: 3,
          medianScore: 0.8,
          regressionMode: 'score',
        },
      },
    };

    it(
      'skips filesystem read when existingBaseline is null',
      async () => {
        const store = new BaselineStore();
        await store.save('run-001', SCORE_RESULT, {
          defaultThreshold: 0.15,
          existingBaseline: null,
        });

        expect(mockReaddir).not.toHaveBeenCalled();
        expect(mockReadFile).not.toHaveBeenCalled();

        const [, raw] = mockWriteFile.mock.calls[0];
        const parsed = JSON.parse(raw as string) as BaselineScores;
        expect(parsed.regressionThresholds).toEqual({
          'latency': 0.15,
        });
      },
    );

    it(
      'uses provided existingBaseline instead of loading from disk',
      async () => {
        const prior: BaselineScores = {
          ...STORED_BASELINE,
          regressionThresholds: { 'latency': 0.10 },
        };
        const store = new BaselineStore();
        await store.save('run-002', SCORE_RESULT, {
          defaultThreshold: 0.15,
          existingBaseline: prior,
        });

        expect(mockReaddir).not.toHaveBeenCalled();
        expect(mockReadFile).not.toHaveBeenCalled();

        const [, raw] = mockWriteFile.mock.calls[0];
        const parsed = JSON.parse(raw as string) as BaselineScores;
        expect(parsed.regressionThresholds).toEqual({
          'latency': 0.10,
        });
      },
    );
  });

  describe('load()', () => {
    it('reads most recent file when multiple exist', async () => {
      const store = new BaselineStore();
      const files = [
        '20260412091512_run-old.json',
        '20260413143025_run-new.json',
        '20260411000000_run-oldest.json',
      ];
      mockReaddir.mockResolvedValueOnce(files);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify(STORED_BASELINE),
      );

      await store.load('build-landing-page');

      expect(mockReadFile).toHaveBeenCalledWith(
        'baselines/build-landing-page/20260413143025_run-new.json',
        'utf-8',
      );
    });

    it('returns parsed BaselineScores on success', async () => {
      const store = new BaselineStore();
      mockReaddir.mockResolvedValueOnce([
        `${FIXED_COMPACT}_run-001.json`,
      ]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify(STORED_BASELINE),
      );

      const result = await store.load('build-landing-page');

      expect(result).toEqual({
        scores: STORED_BASELINE,
        filePath: `baselines/build-landing-page/${FIXED_COMPACT}_run-001.json`,
      });
    });

    it('returns null when scenario directory is missing (ENOENT)', async () => {
      const store = new BaselineStore();
      mockReaddir.mockRejectedValueOnce(
        Object.assign(new Error('not found'), { code: 'ENOENT' }),
      );

      const result = await store.load('nonexistent-scenario');

      expect(result).toBeNull();
    });

    it('returns null when scenario directory is empty', async () => {
      const store = new BaselineStore();
      mockReaddir.mockResolvedValueOnce([]);

      const result = await store.load('build-landing-page');

      expect(result).toBeNull();
    });

    it('re-throws non-ENOENT errors from readdir', async () => {
      const store = new BaselineStore();
      const err = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      });
      mockReaddir.mockRejectedValueOnce(err);

      await expect(
        store.load('build-landing-page'),
      ).rejects.toThrow('permission denied');
    });

    it('respects custom baselines directory', async () => {
      const store = new BaselineStore('/custom/baselines');
      mockReaddir.mockResolvedValueOnce([
        `${FIXED_COMPACT}_run-001.json`,
      ]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify(STORED_BASELINE),
      );

      await store.load('build-landing-page');

      expect(mockReadFile).toHaveBeenCalledWith(
        `/custom/baselines/build-landing-page/${FIXED_COMPACT}_run-001.json`,
        'utf-8',
      );
    });

    it('ignores non-JSON files when selecting the latest baseline', async () => {
      const store = new BaselineStore();
      mockReaddir.mockResolvedValueOnce([
        '.DS_Store',
        '20260413143025_run-new.json',
        'README.md',
      ]);
      mockReadFile.mockResolvedValueOnce(JSON.stringify(STORED_BASELINE));

      await store.load('build-landing-page');

      expect(mockReadFile).toHaveBeenCalledWith(
        'baselines/build-landing-page/20260413143025_run-new.json',
        'utf-8',
      );
    });

    it('returns null when directory contains only non-JSON files', async () => {
      const store = new BaselineStore();
      mockReaddir.mockResolvedValueOnce(['.DS_Store', 'README.md']);

      const result = await store.load('build-landing-page');

      expect(result).toBeNull();
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns null when file is deleted between readdir and readFile', async () => {
      const store = new BaselineStore();
      mockReaddir.mockResolvedValueOnce([
        `${FIXED_COMPACT}_run-001.json`,
      ]);
      mockReadFile.mockRejectedValueOnce(
        Object.assign(new Error('not found'), { code: 'ENOENT' }),
      );

      const result = await store.load('build-landing-page');

      expect(result).toBeNull();
    });

    it('throws descriptive error on corrupt JSON', async () => {
      const store = new BaselineStore();
      mockReaddir.mockResolvedValueOnce([
        `${FIXED_COMPACT}_run-001.json`,
      ]);
      mockReadFile.mockResolvedValueOnce('{ truncated');

      await expect(
        store.load('build-landing-page'),
      ).rejects.toThrow(
        /Failed to parse baseline.*build-landing-page/,
      );
    });
  });

  describe('saveFromStored() — passAtK/passToTheK conditional', () => {
    it('omits passAtK and passToTheK for score-mode evaluator (passAtK absent)', async () => {
      const stored: StoredAggregated = {
        scenarioName: 'build-landing-page',
        evaluators: {
          'latency': {
            passingTrials: 3,
            totalTrials: 3,
            scores: { min: 0.7, max: 0.9, mean: 0.8, median: 0.8, stddev: 0.05 },
            verdicts: { observed: 3 },
            medianScore: 0.75,
          },
        },
        timing: {
          totalDurationMs: 6000,
          avgTrialDurationMs: 2000,
          avgTurnsPerTrial: 4,
        },
      };
      const store = new BaselineStore();
      await store.saveFromStored('run-001', stored, undefined, {
        scoreEvaluatorNames: ['latency'],
        defaultThreshold: 0.1,
      });

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['latency']).not.toHaveProperty('passAtK');
      expect(parsed.scores['latency']).not.toHaveProperty('passToTheK');
    });

    it('preserves passAtK and passToTheK for pass-rate evaluators in saveFromStored', async () => {
      const store = new BaselineStore();
      await store.saveFromStored('run-001', STORED_AGGREGATED);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['bug-hit-rate']).toHaveProperty('passAtK', true);
      expect(parsed.scores['bug-hit-rate']).toHaveProperty('passToTheK', false);
    });
  });

  describe('saveFromStored() — regressionThresholds', () => {
    const STORED_WITH_SCORE_EVALUATOR: StoredAggregated = {
      scenarioName: 'build-landing-page',
      evaluators: {
        'latency-evaluator': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 3,
          totalTrials: 3,
          scores: {
            min: 7,
            max: 9,
            mean: 8,
            median: 8.5,
            stddev: 0.5,
          },
          verdicts: { observed: 3 },
          medianScore: 0.85,
        },
        'output-quality': {
          passAtK: true,
          passToTheK: false,
          passingTrials: 2,
          totalTrials: 3,
          scores: {
            min: 0,
            max: 1,
            mean: 0.6,
            median: 0.7,
            stddev: 0.2,
          },
          verdicts: { pass: 2, partial: 1 },
        },
      },
      timing: {
        totalDurationMs: 10000,
        avgTrialDurationMs: 3333,
        avgTurnsPerTrial: 5,
      },
    };

    it(
      'writes default threshold for score-mode evaluators on first save',
      async () => {
        // beforeEach default: readdir returns [] → load() returns null
        const store = new BaselineStore();
        await store.saveFromStored(
          'run-001',
          STORED_WITH_SCORE_EVALUATOR,
          undefined,
          {
            scoreEvaluatorNames: ['latency-evaluator'],
            defaultThreshold: 0.15,
          },
        );

        const [, raw] = mockWriteFile.mock.calls[0];
        const parsed = JSON.parse(raw as string) as BaselineScores;
        expect(parsed.regressionThresholds).toEqual({
          'latency-evaluator': 0.15,
        });
      },
    );

    it('preserves existing threshold on subsequent save', async () => {
      mockReaddir.mockResolvedValueOnce([
        '20260412091512_run-old.json',
      ]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          ...STORED_BASELINE,
          regressionThresholds: { 'latency-evaluator': 0.12 },
        }),
      );

      const store = new BaselineStore();
      await store.saveFromStored(
        'run-002',
        STORED_WITH_SCORE_EVALUATOR,
        undefined,
        {
          scoreEvaluatorNames: ['latency-evaluator'],
          defaultThreshold: 0.15,
        },
      );

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.regressionThresholds).toEqual({
        'latency-evaluator': 0.12,
      });
    });

    it(
      'does not write regressionThresholds for pass-rate evaluators',
      async () => {
        // beforeEach default: readdir returns [] → load() returns null
        const store = new BaselineStore();
        await store.saveFromStored(
          'run-001',
          STORED_WITH_SCORE_EVALUATOR,
          undefined,
          {
            scoreEvaluatorNames: ['latency-evaluator'],
            defaultThreshold: 0.15,
          },
        );

        const [, raw] = mockWriteFile.mock.calls[0];
        const parsed = JSON.parse(raw as string) as BaselineScores;
        expect(parsed.regressionThresholds).not.toHaveProperty(
          'output-quality',
        );
      },
    );

    it(
      'throws when evaluators have medianScore but '
      + 'scoreEvaluatorNames is omitted',
      async () => {
        const store = new BaselineStore();
        await expect(
          store.saveFromStored(
            'run-001',
            STORED_WITH_SCORE_EVALUATOR,
          ),
        ).rejects.toThrow(
          /not listed in scoreEvaluatorNames/,
        );
      },
    );

    it(
      'throws when evaluators have medianScore but '
      + 'scoreEvaluatorNames is empty',
      async () => {
        const store = new BaselineStore();
        await expect(
          store.saveFromStored(
            'run-001',
            STORED_WITH_SCORE_EVALUATOR,
            undefined,
            { scoreEvaluatorNames: [] },
          ),
        ).rejects.toThrow(
          /latency-evaluator/,
        );
      },
    );

    it(
      'throws when scoreEvaluatorNames is a non-empty '
      + 'subset missing evaluators with medianScore',
      async () => {
        const stored: StoredAggregated = {
          scenarioName: 'build-landing-page',
          evaluators: {
            'latency': {
              passAtK: true,
              passToTheK: true,
              passingTrials: 3,
              totalTrials: 3,
              scores: { min: 7, max: 9, mean: 8, median: 8.5, stddev: 0.5 },
              verdicts: { observed: 3 },
              medianScore: 0.85,
            },
            'response-time': {
              passAtK: true,
              passToTheK: false,
              passingTrials: 2,
              totalTrials: 3,
              scores: { min: 5, max: 8, mean: 6.5, median: 6, stddev: 1 },
              verdicts: { observed: 3 },
              medianScore: 0.60,
            },
          },
          timing: {
            totalDurationMs: 10000,
            avgTrialDurationMs: 3333,
            avgTurnsPerTrial: 5,
          },
        };

        const store = new BaselineStore();
        await expect(
          store.saveFromStored(
            'run-001',
            stored,
            undefined,
            { scoreEvaluatorNames: ['latency'], defaultThreshold: 0.15 },
          ),
        ).rejects.toThrow(
          /response-time.*not listed in scoreEvaluatorNames/,
        );
      },
    );

    it(
      'does not throw when no evaluators have medianScore '
      + 'and scoreEvaluatorNames is omitted',
      async () => {
        const store = new BaselineStore();
        await expect(
          store.saveFromStored('run-001', STORED_AGGREGATED),
        ).resolves.not.toThrow();
      },
    );
  });

  describe('saveFromStored()', () => {
    it('writes versioned file to scenario subdirectory', async () => {
      const store = new BaselineStore();
      await store.saveFromStored('run-001', STORED_AGGREGATED);

      const [path] = mockWriteFile.mock.calls[0];
      expect(path).toBe(
        `baselines/build-landing-page/${FIXED_COMPACT}_run-001.json`,
      );
    });

    it('maps evaluator summaries to BaselineEvalScores', async () => {
      const store = new BaselineStore();
      await store.saveFromStored('run-001', STORED_AGGREGATED);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;

      expect(parsed.scores['bug-hit-rate']).toEqual({
        passAtK: true,
        passToTheK: false,
        passingTrials: 2,
        totalTrials: 5,
      });
    });

    it('uses stabilityLevel when provided', async () => {
      const store = new BaselineStore();
      await store.saveFromStored(
        'run-001', STORED_AGGREGATED, 'high',
      );

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.stabilityLevel).toBe('high');
    });

    it('omits stabilityLevel when not provided', async () => {
      const store = new BaselineStore();
      await store.saveFromStored('run-001', STORED_AGGREGATED);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.stabilityLevel).toBeUndefined();
    });

    it('derives stabilityTrials from first evaluator totalTrials', async () => {
      const store = new BaselineStore();
      await store.saveFromStored('run-001', STORED_AGGREGATED);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.stabilityTrials).toBe(5);
    });

    it('includes runId, scenarioName, createdAt', async () => {
      const store = new BaselineStore();
      await store.saveFromStored('run-42', STORED_AGGREGATED);

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;

      expect(parsed.runId).toBe('run-42');
      expect(parsed.scenarioName).toBe('build-landing-page');
      expect(typeof parsed.createdAt).toBe('string');
    });

    it('preserves medianScore of 0 for score-mode evaluators', async () => {
      const stored: StoredAggregated = {
        scenarioName: 'build-landing-page',
        evaluators: {
          'latency': {
            passAtK: true,
            passToTheK: true,
            passingTrials: 3,
            totalTrials: 3,
            scores: { min: 0, max: 0, mean: 0, median: 0, stddev: 0 },
            verdicts: { observed: 3 },
            medianScore: 0,
          },
        },
        timing: {
          totalDurationMs: 6000,
          avgTrialDurationMs: 2000,
          avgTurnsPerTrial: 4,
        },
      };
      const store = new BaselineStore();
      await store.saveFromStored(
        'run-001',
        stored,
        undefined,
        { scoreEvaluatorNames: ['latency'], defaultThreshold: 0.15 },
      );

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['latency']?.medianScore).toBe(0);
    });

    it('uses filtered medianScore over scores.median', async () => {
      const stored: StoredAggregated = {
        scenarioName: 'build-landing-page',
        evaluators: {
          'latency': {
            passAtK: true,
            passToTheK: true,
            passingTrials: 2,
            totalTrials: 5,
            scores: { min: 0, max: 9, mean: 3.4, median: 3, stddev: 3.2 },
            verdicts: { observed: 2, unknown: 3 },
            medianScore: 0.7,
          },
        },
        timing: {
          totalDurationMs: 10000,
          avgTrialDurationMs: 2000,
          avgTurnsPerTrial: 4,
        },
      };
      const store = new BaselineStore();
      await store.saveFromStored(
        'run-001',
        stored,
        undefined,
        { scoreEvaluatorNames: ['latency'], defaultThreshold: 0.15 },
      );

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['latency']?.medianScore).toBe(0.7);
    });

    it('omits medianScore when evaluator summary has none', async () => {
      const store = new BaselineStore();
      await store.saveFromStored(
        'run-001',
        STORED_AGGREGATED,
        undefined,
        { scoreEvaluatorNames: ['bug-hit-rate'], defaultThreshold: 0.15 },
      );

      const [, raw] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(raw as string) as BaselineScores;
      expect(parsed.scores['bug-hit-rate']).not.toHaveProperty('medianScore');
    });
  });
});
