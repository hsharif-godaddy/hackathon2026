import { describe, it, expect } from 'vitest';
import { BaselineStore } from '../../baselines/baseline-store.js';
import { InMemoryFileStore } from './in-memory-file-store.js';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';

/**
 * Exercises BaselineStore through an injected FileStore (not the fs mock the
 * legacy test uses), proving the storage seam round-trips end to end. This is
 * the contract the S3 backend must also satisfy, so the same expectations will
 * later run against S3FileStore.
 */

function makeTrial(trialIndex: number): TrialResult {
  return {
    trialIndex,
    transcript: {
      scenarioName: 'demo',
      trialIndex,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
    evalResults: [],
  } as unknown as TrialResult;
}

function makeResult(): ScenarioResult {
  return {
    scenarioName: 'demo',
    stabilityLevel: 'low',
    trials: [makeTrial(0), makeTrial(1)],
    aggregated: {
      'bug-hit-rate': {
        passAtK: true,
        passToTheK: false,
        passingTrials: 1,
        totalTrials: 2,
        comparisonMode: 'passRate',
      },
    },
  } as unknown as ScenarioResult;
}

describe('BaselineStore with injected FileStore', () => {
  it('save() writes a baseline that load() reads back through the store', async () => {
    const store = new InMemoryFileStore();
    const baselines = new BaselineStore('baselines', store);

    await baselines.save('run-abc', makeResult());

    expect(store.hasUnder('baselines/demo')).toBe(true);

    const loaded = await baselines.load('demo');
    expect(loaded).not.toBeNull();
    expect(loaded!.scores.scenarioName).toBe('demo');
    expect(loaded!.scores.runId).toBe('run-abc');
    expect(loaded!.scores.scores['bug-hit-rate'].passingTrials).toBe(1);
  });

  it('load() returns null when no baseline directory exists', async () => {
    const baselines = new BaselineStore('baselines', new InMemoryFileStore());
    expect(await baselines.load('never-saved')).toBeNull();
  });

  it('loadByRunId() finds the matching run and ignores others', async () => {
    const store = new InMemoryFileStore();
    const baselines = new BaselineStore('baselines', store);

    await baselines.save('run-one', makeResult());
    await baselines.save('run-two', makeResult());

    const found = await baselines.loadByRunId('demo', 'run-two');
    expect(found).not.toBeNull();
    expect(found!.scores.runId).toBe('run-two');

    expect(await baselines.loadByRunId('demo', 'run-missing')).toBeNull();
  });
});
