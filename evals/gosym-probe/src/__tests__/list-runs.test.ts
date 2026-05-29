import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanRunsDir } from '../util/list-commands.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeIndexEntry(overrides: {
  runId?: string;
  timestamp?: string;
  dir?: string;
  kind?: 'eval' | 'graduation';
} = {}) {
  return {
    runId: overrides.runId ?? 'run-abc-123',
    timestamp: overrides.timestamp ?? '2026-05-15T02:43:09.000Z',
    dir: overrides.dir ?? '20260515024309_run-abc-123',
    ...(overrides.kind !== undefined && { kind: overrides.kind }),
  };
}

function makeMetadata(scenarios: string[], overrides: {
  runId?: string;
  kind?: 'eval' | 'graduation';
} = {}) {
  return {
    runId: overrides.runId ?? 'run-abc-123',
    timestamp: '2026-05-15T02:43:09.000Z',
    gitSha: 'abc123',
    scenarios,
    config: {},
    ...(overrides.kind !== undefined && { kind: overrides.kind }),
  };
}

// ── scanRunsDir ───────────────────────────────────────────────────────────────

describe('scanRunsDir', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when .run-index.json is missing (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(err);

    const result = await scanRunsDir('./runs');
    expect(result).toEqual([]);
  });

  it('returns empty array when index has no runs', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ runs: [] }) as never);

    const result = await scanRunsDir('./runs');
    expect(result).toEqual([]);
  });

  it('returns RunListEntry array with scenarios from metadata', async () => {
    const entry = makeIndexEntry();
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ runs: [entry] }) as never)
      .mockResolvedValueOnce(
        JSON.stringify(makeMetadata(['simple-portfolio', 'business-site'])) as never,
      );

    const result = await scanRunsDir('./runs');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      runId: 'run-abc-123',
      timestamp: '2026-05-15T02:43:09.000Z',
      scenarios: ['simple-portfolio', 'business-site'],
    });
  });

  it('preserves kind field when present', async () => {
    const entry = makeIndexEntry({ kind: 'graduation' });
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ runs: [entry] }) as never)
      .mockResolvedValueOnce(
        JSON.stringify(makeMetadata(['my-scenario'], { kind: 'graduation' })) as never,
      );

    const result = await scanRunsDir('./runs');
    expect(result[0].kind).toBe('graduation');
  });

  it('defaults scenarios to [] when metadata is missing (ENOENT)', async () => {
    const entry = makeIndexEntry();
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ runs: [entry] }) as never)
      .mockRejectedValueOnce(err);

    const result = await scanRunsDir('./runs');
    expect(result).toHaveLength(1);
    expect(result[0].scenarios).toEqual([]);
  });

  it('handles multiple runs in order', async () => {
    const entry1 = makeIndexEntry({ runId: 'run-1', dir: 'dir-1' });
    const entry2 = makeIndexEntry({ runId: 'run-2', dir: 'dir-2' });
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ runs: [entry1, entry2] }) as never)
      .mockResolvedValueOnce(JSON.stringify(makeMetadata(['s1'], { runId: 'run-1' })) as never)
      .mockResolvedValueOnce(JSON.stringify(makeMetadata(['s2'], { runId: 'run-2' })) as never);

    const result = await scanRunsDir('./runs');

    expect(result).toHaveLength(2);
    expect(result[0].runId).toBe('run-1');
    expect(result[0].scenarios).toEqual(['s1']);
    expect(result[1].runId).toBe('run-2');
    expect(result[1].scenarios).toEqual(['s2']);
  });

  it('output entries are JSON-serialisable without loss', async () => {
    const entry = makeIndexEntry();
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ runs: [entry] }) as never)
      .mockResolvedValueOnce(
        JSON.stringify(makeMetadata(['my-scenario'])) as never,
      );

    const result = await scanRunsDir('./runs');
    const reparsed = JSON.parse(JSON.stringify(result));
    expect(reparsed).toEqual(result);
  });

  it('rethrows non-ENOENT filesystem errors', async () => {
    const err = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    mockReadFile.mockRejectedValueOnce(err);

    await expect(scanRunsDir('./runs')).rejects.toThrow('Permission denied');
  });
});
