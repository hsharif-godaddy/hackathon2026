import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scenarioToInfo, scanBaselinesDir } from '../util/list-commands.js';
import type { Scenario } from '../scenarios/types.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from 'node:fs/promises';

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STUB_PERSONA = {
  name: 'beginner',
  description: 'A beginner user',
  systemPrompt: 'You are a beginner.',
};

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: STUB_PERSONA,
    goals: [{ description: 'Task done', assertion: 'positive' }],
    evaluators: [],
    trials: 3,
    ...overrides,
  };
}

function makeEvaluator(name: string) {
  return {
    name,
    comparisonMode: 'passRate' as const,
    evaluate: vi.fn(),
  };
}

// ── scenarioToInfo ────────────────────────────────────────────────────────────

describe('scenarioToInfo', () => {
  it('maps required fields correctly', () => {
    const scenario = makeScenario({
      name: 'my-scenario',
      trials: 5,
      evaluators: [makeEvaluator('jtbd-completion'), makeEvaluator('prompt-efficiency')],
    });

    const info = scenarioToInfo(scenario);

    expect(info.name).toBe('my-scenario');
    expect(info.trials).toBe(5);
    expect(info.evaluators).toEqual(['jtbd-completion', 'prompt-efficiency']);
  });

  it('uses empty string for missing suite', () => {
    const scenario = makeScenario({ suite: undefined });
    expect(scenarioToInfo(scenario).suite).toBe('');
  });

  it('uses suite when present', () => {
    const scenario = makeScenario({ suite: 'golden-light' });
    expect(scenarioToInfo(scenario).suite).toBe('golden-light');
  });

  it('defaults stabilityLevel to "low" when absent', () => {
    const scenario = makeScenario({ stabilityLevel: undefined });
    expect(scenarioToInfo(scenario).stabilityLevel).toBe('low');
  });

  it('preserves explicit stabilityLevel', () => {
    const scenario = makeScenario({ stabilityLevel: 'high' });
    expect(scenarioToInfo(scenario).stabilityLevel).toBe('high');
  });

  it('sets executionMode to "standard"', () => {
    expect(scenarioToInfo(makeScenario()).executionMode).toBe('standard');
  });

  it('returns empty evaluators array when scenario has none', () => {
    const scenario = makeScenario({ evaluators: [] });
    expect(scenarioToInfo(scenario).evaluators).toEqual([]);
  });

  it('output is JSON-serialisable without loss', () => {
    const scenario = makeScenario({
      name: 'round-trip',
      suite: 'test',
      trials: 3,
      stabilityLevel: 'medium',
      evaluators: [makeEvaluator('ev-a')],
    });
    const info = scenarioToInfo(scenario);
    const reparsed = JSON.parse(JSON.stringify(info));
    expect(reparsed).toEqual(info);
  });
});

// ── scanBaselinesDir ──────────────────────────────────────────────────────────

describe('scanBaselinesDir', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when baselines dir is missing (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReaddir.mockRejectedValueOnce(err);

    const result = await scanBaselinesDir('./baselines');
    expect(result).toEqual([]);
  });

  it('returns empty array when baselines dir is empty', async () => {
    mockReaddir.mockResolvedValueOnce([] as never);

    const result = await scanBaselinesDir('./baselines');
    expect(result).toEqual([]);
  });

  it('returns BaselineEntry for each scenario with a baseline', async () => {
    // baselines/ lists two scenario subdirs
    mockReaddir.mockResolvedValueOnce(['simple-portfolio', 'business-site'] as never);
    // simple-portfolio/ has one json file
    mockReaddir.mockResolvedValueOnce(['20260515024309_abc-123.json'] as never);
    // business-site/ has one json file
    mockReaddir.mockResolvedValueOnce(['20260516010000_def-456.json'] as never);
    mockReadFile
      .mockResolvedValueOnce(
        JSON.stringify({ runId: 'abc-123', createdAt: '2026-05-15T02:43:09.000Z' }) as never,
      )
      .mockResolvedValueOnce(
        JSON.stringify({ runId: 'def-456', createdAt: '2026-05-16T01:00:00.000Z' }) as never,
      );

    const result = await scanBaselinesDir('./baselines');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      scenarioName: 'simple-portfolio',
      runId: 'abc-123',
      createdAt: '2026-05-15T02:43:09.000Z',
    });
    expect(result[1]).toMatchObject({
      scenarioName: 'business-site',
      runId: 'def-456',
    });
  });

  it('picks the most recent file when multiple baselines exist for a scenario', async () => {
    mockReaddir.mockResolvedValueOnce(['my-scenario'] as never);
    // Two files: newer first after reverse sort
    mockReaddir.mockResolvedValueOnce([
      '20260510000000_old-run.json',
      '20260515000000_new-run.json',
    ] as never);
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ runId: 'new-run', createdAt: '2026-05-15T00:00:00.000Z' }) as never,
    );

    const result = await scanBaselinesDir('./baselines');

    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe('new-run');
  });

  it('skips scenario subdirs with no json files', async () => {
    mockReaddir.mockResolvedValueOnce(['empty-scenario'] as never);
    mockReaddir.mockResolvedValueOnce([] as never);

    const result = await scanBaselinesDir('./baselines');
    expect(result).toEqual([]);
  });

  it('skips malformed baseline JSON without throwing', async () => {
    mockReaddir.mockResolvedValueOnce(['bad-scenario'] as never);
    mockReaddir.mockResolvedValueOnce(['20260515_bad.json'] as never);
    mockReadFile.mockResolvedValueOnce('NOT_JSON{{{' as never);

    const result = await scanBaselinesDir('./baselines');
    expect(result).toEqual([]);
  });

  it('rethrows non-ENOENT filesystem errors', async () => {
    const err = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    mockReaddir.mockRejectedValueOnce(err);

    await expect(scanBaselinesDir('./baselines')).rejects.toThrow('Permission denied');
  });
});
