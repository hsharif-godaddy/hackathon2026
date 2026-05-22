import { describe, it, expect } from 'vitest';
import {
  formatRunList,
  formatRunSummary,
  formatEvaluatorScores,
} from '../../commands/results.js';
import type {
  RunMetadata,
  StoredAggregated,
} from '../../../store/types.js';


const baseMetadata: RunMetadata = {
  runId: 'run-abc',
  timestamp: '2026-04-11T10:00:00.000Z',
  gitSha: 'abc123',
  scenarios: ['scenario-a', 'scenario-b'],
  config: {} as RunMetadata['config'],
  maxTurns: 30,
};

const baseAgg: StoredAggregated = {
  scenarioName: 'scenario-a',
  evaluators: {
    'tool-call': {
      passAtK: true,
      passToTheK: true,
      passingTrials: 3,
      totalTrials: 5,
      scores: {
        min: 0.6,
        max: 1.0,
        mean: 0.8,
        median: 0.8,
        stddev: 0.1,
      },
      verdicts: { pass: 3, fail: 2 },
    },
  },
  timing: {
    totalDurationMs: 1000,
    avgTrialDurationMs: 200,
    avgTurnsPerTrial: 4,
  },
};

describe('formatRunList', () => {
  it('returns empty message when no runs', () => {
    expect(formatRunList([])).toContain('No runs found');
  });

  it('shows column headers', () => {
    const result = formatRunList([
        {
          runId: 'run-001',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]);
    expect(result).toContain('#');
    expect(result).toContain('Run ID');
    expect(result).toContain('Timestamp');
  });

  it('numbers runs starting from 1', () => {
    const result = formatRunList([
        { runId: 'run-001', timestamp: '2026-01-01T00:00:00.000Z' },
        { runId: 'run-002', timestamp: '2026-01-02T00:00:00.000Z' },
      ]);
    expect(result).toContain('1');
    expect(result).toContain('2');
  });

  it('includes runId in output', () => {
    const result = formatRunList([
        {
          runId: 'run-abc',
          timestamp: '2026-04-11T10:00:00.000Z',
        },
      ]);
    expect(result).toContain('run-abc');
  });

  it('includes timestamp in output', () => {
    const result = formatRunList([
        {
          runId: 'run-abc',
          timestamp: '2026-04-11T10:00:00.000Z',
        },
      ]);
    expect(result).toContain('2026-04-11T10:00:00.000Z');
  });

  it('shows all runs when multiple provided', () => {
    const result = formatRunList([
        { runId: 'run-001', timestamp: '2026-01-01T00:00:00.000Z' },
        { runId: 'run-002', timestamp: '2026-01-02T00:00:00.000Z' },
        { runId: 'run-003', timestamp: '2026-01-03T00:00:00.000Z' },
      ]);
    expect(result).toContain('run-001');
    expect(result).toContain('run-002');
    expect(result).toContain('run-003');
  });

  it('shows [graduation] tag for graduation runs', () => {
    const result = formatRunList([
        {
          runId: 'run-grad',
          timestamp: '2026-04-14T10:00:00.000Z',
          kind: 'graduation' as const,
        },
      ]);
    expect(result).toContain('[graduation]');
  });

  it('shows no kind tag for regular eval runs', () => {
    const result = formatRunList([
        {
          runId: 'run-eval',
          timestamp: '2026-04-14T10:00:00.000Z',
        },
      ]);
    expect(result).not.toContain('[graduation]');
    expect(result).not.toContain('[eval]');
  });

  it('shows [graduation] only on the correct run in a mixed list',
    () => {
      const result = formatRunList([
          {
            runId: 'run-eval',
            timestamp: '2026-04-14T10:00:00.000Z',
          },
          {
            runId: 'run-grad',
            timestamp: '2026-04-14T11:00:00.000Z',
            kind: 'graduation' as const,
          },
        ]);
      expect(result).toContain('[graduation]');
      expect(result).toContain('run-eval');
    },
  );
});

describe('formatRunSummary', () => {
  it('includes Run ID', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).toContain('run-abc');
  });

  it('includes timestamp', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).toContain('2026-04-11T10:00:00.000Z');
  });

  it('includes git SHA', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).toContain('abc123');
  });

  it('shows (none) when gitSha is null', () => {
    const result = formatRunSummary({ ...baseMetadata, gitSha: null });
    expect(result).toContain('(none)');
  });

  it('includes scenario names', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).toContain('scenario-a');
    expect(result).toContain('scenario-b');
  });

  it('shows trialsOverride when present', () => {
    const result = formatRunSummary({ ...baseMetadata, trialsOverride: 5 });
    expect(result).toContain('5');
  });

  it('does not show trialsOverride row when absent', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).not.toContain('Trials Override');
  });

  it('shows concurrencyOverride when present', () => {
    const result = formatRunSummary({ ...baseMetadata, concurrencyOverride: 3 });
    expect(result).toContain('Concurrency Override');
    expect(result).toContain('3');
  });

  it('does not show Concurrency Override row when absent', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).not.toContain('Concurrency Override');
  });

  it('includes column headers', () => {
    const result = (formatRunSummary(baseMetadata));
    expect(result).toContain('Field');
    expect(result).toContain('Value');
  });
});

describe('formatEvaluatorScores', () => {
  it('includes evaluator name', () => {
    const result = (formatEvaluatorScores(baseAgg));
    expect(result).toContain('tool-call');
  });

  it('shows PASS when passAtK is true', () => {
    const result = (formatEvaluatorScores(baseAgg));
    expect(result).toContain('PASS');
  });

  it('shows FAIL when passAtK is false', () => {
    const failAgg: StoredAggregated = {
      ...baseAgg,
      evaluators: {
        'tool-call': {
          ...baseAgg.evaluators['tool-call']!,
          passAtK: false,
        },
      },
    };
    const result = (formatEvaluatorScores(failAgg));
    expect(result).toContain('FAIL');
  });

  it('shows passing/total trial ratio', () => {
    const result = (formatEvaluatorScores(baseAgg));
    expect(result).toContain('3/5');
  });

  it('shows mean score formatted to 2 decimals', () => {
    const result = (formatEvaluatorScores(baseAgg));
    expect(result).toContain('0.80');
  });

  it('includes column headers', () => {
    const result = (formatEvaluatorScores(baseAgg));
    expect(result).toContain('Evaluator');
    expect(result).toContain('Pass@K');
    expect(result).toContain('Passing');
    expect(result).toContain('Mean Score');
  });

  it('handles multiple evaluators', () => {
    const multiAgg: StoredAggregated = {
      ...baseAgg,
      evaluators: {
        'eval-a': { ...baseAgg.evaluators['tool-call']! },
        'eval-b': {
          ...baseAgg.evaluators['tool-call']!,
          passAtK: false,
        },
      },
    };
    const result = (formatEvaluatorScores(multiAgg));
    expect(result).toContain('eval-a');
    expect(result).toContain('eval-b');
  });

  it('handles zero evaluators without throwing', () => {
    const emptyAgg: StoredAggregated = {
      ...baseAgg,
      evaluators: {},
    };
    expect(() => formatEvaluatorScores(emptyAgg)).not.toThrow();
  });

  it('shows n/a in Pass@K column when passAtK is absent (score-mode evaluator)', () => {
    const scoreAgg: StoredAggregated = {
      ...baseAgg,
      evaluators: {
        'latency': {
          passingTrials: 3,
          totalTrials: 3,
          scores: {
            min: 0.7,
            max: 0.9,
            mean: 0.8,
            median: 0.8,
            stddev: 0.1,
          },
          verdicts: { observed: 3 },
          medianScore: 0.8,
        },
      },
    };
    const result = formatEvaluatorScores(scoreAgg);
    expect(result).toContain('n/a');
    expect(result).not.toContain('PASS');
    expect(result).not.toContain('FAIL');
  });

  it('still shows PASS/FAIL for pass-rate evaluator with defined passAtK', () => {
    const result = formatEvaluatorScores(baseAgg);
    expect(result).toContain('PASS');
    expect(result).not.toContain('n/a');
  });
});
