import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadRunDetail } from '../util/list-commands.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RUN_ID = 'run-abc-123';
const DIR = '20260515024309_run-abc-123';

function makeIndex(runs: Array<{ runId: string; dir: string }>) {
  return JSON.stringify({
    runs: runs.map((r) => ({
      runId: r.runId,
      timestamp: '2026-05-15T02:43:09.000Z',
      dir: r.dir,
    })),
  });
}

function makeMetadata(scenarios: string[]) {
  return JSON.stringify({
    runId: RUN_ID,
    timestamp: '2026-05-15T02:43:09.000Z',
    gitSha: 'abc123',
    scenarios,
    config: {},
  });
}

function makeAggregated(scenarioName: string) {
  return JSON.stringify({
    scenarioName,
    evaluators: {
      'jtbd-completion': {
        passAt1: 1,
        passAtK: { 1: 1 },
        passHatK: { 1: 1 },
        passingTrials: 3,
        totalTrials: 3,
        scores: { median: 0.9, mean: 0.88, min: 0.8, max: 1.0 },
        verdicts: { pass: 3 },
        medianScore: 0.9,
      },
      'prompt-efficiency': {
        passingTrials: 2,
        totalTrials: 3,
        scores: { median: 0.7, mean: 0.72, min: 0.6, max: 0.8 },
        verdicts: { pass: 2, partial: 1 },
        lowerIsBetter: false,
      },
    },
    timing: {
      totalDurationMs: 90000,
      avgTrialDurationMs: 30000,
      avgTurnsPerTrial: 5.3,
    },
  });
}

// ── loadRunDetail ─────────────────────────────────────────────────────────────

describe('loadRunDetail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when run ID not found in index', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeIndex([{ runId: 'other-run', dir: 'other-dir' }]) as never,
    );

    const result = await loadRunDetail('./runs', RUN_ID);
    expect(result).toBeNull();
  });

  it('returns null when index is missing (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(err);

    const result = await loadRunDetail('./runs', RUN_ID);
    expect(result).toBeNull();
  });

  it('returns RunDetailOutput with correct shape for a single scenario', async () => {
    mockReadFile
      .mockResolvedValueOnce(makeIndex([{ runId: RUN_ID, dir: DIR }]) as never)
      .mockResolvedValueOnce(makeMetadata(['simple-portfolio']) as never)
      .mockResolvedValueOnce(makeAggregated('simple-portfolio') as never);

    const result = await loadRunDetail('./runs', RUN_ID);

    expect(result).not.toBeNull();
    expect(result!.runId).toBe(RUN_ID);
    expect(result!.scenarios).toHaveLength(1);

    const scenario = result!.scenarios[0];
    expect(scenario.name).toBe('simple-portfolio');
    expect(scenario.timing.avgTrialDurationMs).toBe(30000);
    expect(scenario.timing.avgTurnsPerTrial).toBe(5.3);
  });

  it('maps evaluator summary fields correctly', async () => {
    mockReadFile
      .mockResolvedValueOnce(makeIndex([{ runId: RUN_ID, dir: DIR }]) as never)
      .mockResolvedValueOnce(makeMetadata(['s1']) as never)
      .mockResolvedValueOnce(makeAggregated('s1') as never);

    const result = await loadRunDetail('./runs', RUN_ID);
    const evals = result!.scenarios[0].evaluators;

    expect(evals['jtbd-completion']).toMatchObject({
      passingTrials: 3,
      totalTrials: 3,
      passAt1: 1,
      medianScore: 0.9,
    });
    expect(evals['prompt-efficiency']).toMatchObject({
      passingTrials: 2,
      totalTrials: 3,
      lowerIsBetter: false,
    });
    expect(evals['prompt-efficiency'].passAt1).toBeUndefined();
  });

  it('defaults evaluators to {} when aggregated.json is missing (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile
      .mockResolvedValueOnce(makeIndex([{ runId: RUN_ID, dir: DIR }]) as never)
      .mockResolvedValueOnce(makeMetadata(['missing-scenario']) as never)
      .mockRejectedValueOnce(err);

    const result = await loadRunDetail('./runs', RUN_ID);

    expect(result).not.toBeNull();
    const scenario = result!.scenarios[0];
    expect(scenario.name).toBe('missing-scenario');
    expect(scenario.evaluators).toEqual({});
  });

  it('handles multiple scenarios in a run', async () => {
    mockReadFile
      .mockResolvedValueOnce(makeIndex([{ runId: RUN_ID, dir: DIR }]) as never)
      .mockResolvedValueOnce(makeMetadata(['s1', 's2']) as never)
      .mockResolvedValueOnce(makeAggregated('s1') as never)
      .mockResolvedValueOnce(makeAggregated('s2') as never);

    const result = await loadRunDetail('./runs', RUN_ID);

    expect(result!.scenarios).toHaveLength(2);
    expect(result!.scenarios[0].name).toBe('s1');
    expect(result!.scenarios[1].name).toBe('s2');
  });

  it('output is JSON-serialisable without loss', async () => {
    mockReadFile
      .mockResolvedValueOnce(makeIndex([{ runId: RUN_ID, dir: DIR }]) as never)
      .mockResolvedValueOnce(makeMetadata(['s1']) as never)
      .mockResolvedValueOnce(makeAggregated('s1') as never);

    const result = await loadRunDetail('./runs', RUN_ID);
    const reparsed = JSON.parse(JSON.stringify(result));
    expect(reparsed).toEqual(result);
  });

  it('rethrows unexpected filesystem errors (non-ENOENT) from index read', async () => {
    const err = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    mockReadFile.mockRejectedValueOnce(err);

    await expect(loadRunDetail('./runs', RUN_ID)).rejects.toThrow('Permission denied');
  });
});
