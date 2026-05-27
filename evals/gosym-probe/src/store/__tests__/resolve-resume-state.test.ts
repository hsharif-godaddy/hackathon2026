import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvalStore } from '../eval-store.js';
import type { TrialResult } from '../../runner/types.js';
import type { Scenario } from '../../scenarios/types.js';
import type { RunMetadata } from '../types.js';
import { resolveResumeState } from '../resolve-resume-state.js';
import type { ResumeStateInput } from '../resolve-resume-state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScenario(name: string): Scenario {
  return {
    name,
    persona: { name: 'test', description: 'test persona', systemPrompt: '' },
    goals: [{ description: 'goal', assertion: 'positive' }],
    evaluators: [],
    trials: 3,
  };
}

function makeTrialResult(trialIndex: number): TrialResult {
  return {
    trialIndex,
    transcript: {
      scenarioName: 'test',
      trialIndex,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
      
    },
    evalResults: [],
  };
}

function makeMetadata(
  overrides: Partial<RunMetadata> = {},
): RunMetadata {
  return {
    runId: 'run-abc-123',
    timestamp: '2024-01-01T00:00:00Z',
    gitSha: 'abc123',
    scenarios: ['scenario-a'],
    config: {} as RunMetadata['config'],
    maxTurns: 30,
    ...overrides,
  };
}

function makeMockStore(
  overrides: Partial<Record<keyof EvalStore, unknown>> = {},
): EvalStore {
  return {
    resolveRunDirName: vi.fn().mockResolvedValue('run-dir-001'),
    loadRunMetadataByDirName: vi.fn().mockResolvedValue(makeMetadata()),
    acquireRunLock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
    listCompletedTrialIndices: vi.fn().mockResolvedValue([]),
    loadTrialResultByDirName: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as EvalStore;
}

function makeInput(overrides: Partial<ResumeStateInput> = {}): ResumeStateInput {
  return {
    store: makeMockStore(),
    runRef: 'run-abc-123',
    scenarios: [makeScenario('scenario-a')],
    getTrialCount: (_scenario, trialsOverride) => trialsOverride ?? 3,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveResumeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error string when run is not found', async () => {
    const store = makeMockStore({
      resolveRunDirName: vi.fn().mockResolvedValue(null),
    });
    const result = await resolveResumeState(makeInput({ store }));

    expect(result).toBe('run not found for --resume "run-abc-123".');
  });

  it('returns error string when metadata is missing', async () => {
    const store = makeMockStore({
      loadRunMetadataByDirName: vi.fn().mockResolvedValue(null),
    });
    const result = await resolveResumeState(makeInput({ store }));

    expect(typeof result).toBe('string');
    expect(result).toContain('run metadata missing');
    expect(result).toContain('run-dir-001');
  });

  it('returns error string when expectedKind does not match metadata.kind', async () => {
    const store = makeMockStore({
      loadRunMetadataByDirName: vi.fn().mockResolvedValue(
        makeMetadata({ kind: 'eval' }),
      ),
    });
    const result = await resolveResumeState(
      makeInput({ store, expectedKind: 'graduation' }),
    );

    expect(typeof result).toBe('string');
    expect(result).toContain('is not a graduation run');
    expect(result).toContain('kind: eval');
  });

  it('returns error when metadata.kind is undefined but expectedKind is graduation', async () => {
    const store = makeMockStore({
      loadRunMetadataByDirName: vi.fn().mockResolvedValue(
        makeMetadata({ kind: undefined }),
      ),
    });
    const result = await resolveResumeState(
      makeInput({ store, expectedKind: 'graduation' }),
    );

    expect(typeof result).toBe('string');
    expect(result).toContain('is not a graduation run');
    expect(result).toContain('kind: eval');
  });

  it('proceeds normally when expectedKind matches metadata.kind', async () => {
    const store = makeMockStore({
      loadRunMetadataByDirName: vi.fn().mockResolvedValue(
        makeMetadata({ kind: 'graduation' }),
      ),
    });
    const result = await resolveResumeState(
      makeInput({ store, expectedKind: 'graduation' }),
    );

    expect(typeof result).not.toBe('string');
    expect((result as { runId: string }).runId).toBe('run-abc-123');
  });

  it('skips kind check when expectedKind is undefined', async () => {
    const store = makeMockStore({
      loadRunMetadataByDirName: vi.fn().mockResolvedValue(
        makeMetadata({ kind: 'graduation' }),
      ),
    });
    const result = await resolveResumeState(
      makeInput({ store, expectedKind: undefined }),
    );

    expect(typeof result).not.toBe('string');
    expect((result as { runId: string }).runId).toBe('run-abc-123');
  });

  describe('scenario set mismatch', () => {
    it('returns error when saved scenarios are missing from current', async () => {
      const store = makeMockStore({
        loadRunMetadataByDirName: vi.fn().mockResolvedValue(
          makeMetadata({ scenarios: ['scenario-a', 'scenario-b'] }),
        ),
      });
      const result = await resolveResumeState(
        makeInput({ store, scenarios: [makeScenario('scenario-a')] }),
      );

      expect(typeof result).toBe('string');
      expect(result).toContain('cannot resume');
      expect(result).toContain('Missing from current run: scenario-b');
    });

    it('returns error when current has extra scenarios not in saved', async () => {
      const store = makeMockStore({
        loadRunMetadataByDirName: vi.fn().mockResolvedValue(
          makeMetadata({ scenarios: ['scenario-a'] }),
        ),
      });
      const result = await resolveResumeState(
        makeInput({
          store,
          scenarios: [makeScenario('scenario-a'), makeScenario('scenario-c')],
        }),
      );

      expect(typeof result).toBe('string');
      expect(result).toContain('cannot resume');
      expect(result).toContain('Extra in current run: scenario-c');
    });

    it('returns error with both missing and extra when scenarios differ in both directions', async () => {
      const store = makeMockStore({
        loadRunMetadataByDirName: vi.fn().mockResolvedValue(
          makeMetadata({ scenarios: ['scenario-a', 'scenario-b'] }),
        ),
      });
      const result = await resolveResumeState(
        makeInput({
          store,
          scenarios: [makeScenario('scenario-a'), makeScenario('scenario-c')],
        }),
      );

      expect(typeof result).toBe('string');
      expect(result).toContain('Missing from current run: scenario-b');
      expect(result).toContain('Extra in current run: scenario-c');
    });
  });

  describe('lock release on error', () => {
    it('releases lock and re-throws when listCompletedTrialIndices throws', async () => {
      const releaseLock = vi.fn().mockResolvedValue(undefined);
      const innerError = new Error('disk failure');
      const store = makeMockStore({
        acquireRunLock: vi.fn().mockResolvedValue(releaseLock),
        listCompletedTrialIndices: vi.fn().mockRejectedValue(innerError),
      });

      await expect(resolveResumeState(makeInput({ store }))).rejects.toThrow(
        'disk failure',
      );
      expect(releaseLock).toHaveBeenCalledOnce();
    });

    it('suppresses releaseLock failure and re-throws original error', async () => {
      const releaseLock = vi.fn().mockRejectedValue(new Error('lock stuck'));
      const innerError = new Error('disk failure');
      const store = makeMockStore({
        acquireRunLock: vi.fn().mockResolvedValue(releaseLock),
        listCompletedTrialIndices: vi.fn().mockRejectedValue(innerError),
      });

      await expect(resolveResumeState(makeInput({ store }))).rejects.toThrow(
        'disk failure',
      );
      expect(releaseLock).toHaveBeenCalledOnce();
    });
  });

  describe('happy path', () => {
    it('returns ResumeState with correct dirName, runId, existing trials, and remaining indices', async () => {
      const trial0 = makeTrialResult(0);
      const trial2 = makeTrialResult(2);
      const releaseLock = vi.fn().mockResolvedValue(undefined);

      const store = makeMockStore({
        acquireRunLock: vi.fn().mockResolvedValue(releaseLock),
        listCompletedTrialIndices: vi.fn().mockResolvedValue([0, 2]),
        loadTrialResultByDirName: vi.fn().mockImplementation(
          (_dir: string, _scenario: string, trialIndex: number) => {
            if (trialIndex === 0) return Promise.resolve(trial0);
            if (trialIndex === 2) return Promise.resolve(trial2);
            return Promise.resolve(null);
          },
        ),
      });

      const result = await resolveResumeState(makeInput({ store }));

      expect(typeof result).not.toBe('string');
      const state = result as {
        dirName: string;
        runId: string;
        existingTrialsByScenario: Map<string, TrialResult[]>;
        trialIndicesByScenario: Map<string, number[]>;
        releaseLock: () => Promise<void>;
      };

      expect(state.dirName).toBe('run-dir-001');
      expect(state.runId).toBe('run-abc-123');
      expect(state.existingTrialsByScenario.get('scenario-a')).toEqual([
        trial0,
        trial2,
      ]);
      expect(state.trialIndicesByScenario.get('scenario-a')).toEqual([1]);
      expect(state.releaseLock).toBe(releaseLock);
    });

    it('excludes completed trials with index >= trialCount', async () => {
      const trial0 = makeTrialResult(0);
      const releaseLock = vi.fn().mockResolvedValue(undefined);

      const store = makeMockStore({
        acquireRunLock: vi.fn().mockResolvedValue(releaseLock),
        listCompletedTrialIndices: vi.fn().mockResolvedValue([0, 1, 5, 10]),
        loadTrialResultByDirName: vi.fn().mockImplementation(
          (_dir: string, _scenario: string, trialIndex: number) => {
            if (trialIndex === 0) return Promise.resolve(trial0);
            if (trialIndex === 1) return Promise.resolve(makeTrialResult(1));
            return Promise.resolve(null);
          },
        ),
      });

      const result = await resolveResumeState(
        makeInput({
          store,
          getTrialCount: () => 3,
        }),
      );

      expect(typeof result).not.toBe('string');
      const state = result as {
        existingTrialsByScenario: Map<string, TrialResult[]>;
        trialIndicesByScenario: Map<string, number[]>;
      };

      // Only indices 0 and 1 are loaded (< trialCount of 3)
      expect(state.existingTrialsByScenario.get('scenario-a')).toHaveLength(2);
      // Remaining indices: 2 is not in completedSet (only 0,1,5,10 are)
      // but 5 and 10 ARE in completedSet so they are excluded from remaining
      expect(state.trialIndicesByScenario.get('scenario-a')).toEqual([2]);
    });

    it('skips trials where loadTrialResultByDirName returns null', async () => {
      const trial1 = makeTrialResult(1);
      const releaseLock = vi.fn().mockResolvedValue(undefined);

      const store = makeMockStore({
        acquireRunLock: vi.fn().mockResolvedValue(releaseLock),
        listCompletedTrialIndices: vi.fn().mockResolvedValue([0, 1, 2]),
        loadTrialResultByDirName: vi.fn().mockImplementation(
          (_dir: string, _scenario: string, trialIndex: number) => {
            if (trialIndex === 1) return Promise.resolve(trial1);
            return Promise.resolve(null);
          },
        ),
      });

      const result = await resolveResumeState(makeInput({ store }));

      expect(typeof result).not.toBe('string');
      const state = result as {
        existingTrialsByScenario: Map<string, TrialResult[]>;
        trialIndicesByScenario: Map<string, number[]>;
      };

      // Only trial1 loaded successfully; 0 and 2 returned null
      expect(state.existingTrialsByScenario.get('scenario-a')).toEqual([trial1]);
      // All 3 indices are in completedSet, so no remaining indices
      expect(state.trialIndicesByScenario.get('scenario-a')).toEqual([]);
    });

    it('passes trialsOverride from metadata to getTrialCount', async () => {
      const getTrialCount = vi.fn().mockReturnValue(5);
      const releaseLock = vi.fn().mockResolvedValue(undefined);

      const store = makeMockStore({
        acquireRunLock: vi.fn().mockResolvedValue(releaseLock),
        loadRunMetadataByDirName: vi.fn().mockResolvedValue(
          makeMetadata({ trialsOverride: 7 }),
        ),
      });

      await resolveResumeState(
        makeInput({ store, getTrialCount }),
      );

      expect(getTrialCount).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'scenario-a' }),
        7,
      );
    });
  });
});
