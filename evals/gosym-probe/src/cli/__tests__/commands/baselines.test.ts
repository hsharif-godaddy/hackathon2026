import { describe, it, expect } from 'vitest';
import {
  formatBaselinesTable,
  buildSaveBaselineArgs,
  buildGraduateFlags,
  buildGraduateSuiteFlags,
} from '../../commands/baselines.js';
import type { BaselineScores } from '../../../baselines/types.js';


const mockBaseline: BaselineScores = {
  scenarioName: 'build-landing-page',
  runId: 'run-001',
  createdAt: '2026-04-10T12:00:00.000Z',
  scores: {
    'tool-call': {
      passAtK: true,
      passToTheK: true,
      passingTrials: 3,
      totalTrials: 5,
    },
  },
};

describe('formatBaselinesTable', () => {
  it('returns empty message for empty input', () => {
    expect(formatBaselinesTable([])).toContain('No scenarios');
  });

  it('includes column headers', () => {
    const result = formatBaselinesTable([
        { name: 'scenario-a', baseline: mockBaseline },
      ]);
    expect(result).toContain('Scenario');
    expect(result).toContain('Baseline Run');
    expect(result).toContain('Created At');
  });

  it('shows run ID when baseline exists', () => {
    const result = formatBaselinesTable([
        { name: 'build-landing-page', baseline: mockBaseline },
      ]);
    expect(result).toContain('run-001');
  });

  it('shows (none) when no baseline', () => {
    const result = formatBaselinesTable([
        { name: 'no-baseline-scenario', baseline: null },
      ]);
    expect(result).toContain('(none)');
  });

  it('shows scenario names', () => {
    const result = formatBaselinesTable([
        { name: 'scenario-a', baseline: null },
        { name: 'scenario-b', baseline: mockBaseline },
      ]);
    expect(result).toContain('scenario-a');
    expect(result).toContain('scenario-b');
  });

  it('shows createdAt for existing baseline', () => {
    const result = formatBaselinesTable([
        { name: 'build-landing-page', baseline: mockBaseline },
      ]);
    expect(result).toContain('2026-04-10T12:00:00.000Z');
  });

  it('shows empty createdAt column when no baseline', () => {
    const result = formatBaselinesTable([
        { name: 'scenario-a', baseline: null },
      ]);
    expect(result).toContain('(none)');
  });

  it('handles multiple entries without throwing', () => {
    expect(() =>
      formatBaselinesTable([
        { name: 'a', baseline: mockBaseline },
        { name: 'b', baseline: null },
        { name: 'c', baseline: mockBaseline },
      ]),
    ).not.toThrow();
  });
});

describe('buildSaveBaselineArgs', () => {
  it('returns run-id as the sole element', () => {
    const args = buildSaveBaselineArgs('run-001');
    expect(args).toEqual(['run-001']);
  });

  it('produces exactly one element', () => {
    expect(buildSaveBaselineArgs('any-id')).toHaveLength(1);
  });

  it('works with UUID-style run IDs', () => {
    const id = '228a9003-75c9-48f9-9f0a-221f2e7101ab';
    expect(buildSaveBaselineArgs(id)).toEqual([id]);
  });
});

describe('buildGraduateFlags', () => {
  it('includes --graduate flag', () => {
    const flags = buildGraduateFlags('my-scenario');
    expect(flags).toContain('--graduate');
  });

  it('includes scenario name after --graduate', () => {
    const flags = buildGraduateFlags('my-scenario');
    const idx = flags.indexOf('--graduate');
    expect(flags[idx + 1]).toBe('my-scenario');
  });

  it('produces exactly two elements', () => {
    const flags = buildGraduateFlags('my-scenario');
    expect(flags).toHaveLength(2);
  });

  it('works with hyphenated scenario names', () => {
    const flags = buildGraduateFlags('build-landing-page');
    expect(flags).toContain('build-landing-page');
  });
});

describe('buildGraduateSuiteFlags', () => {
  it('includes --graduate-suite flag', () => {
    const flags = buildGraduateSuiteFlags('smoke');
    expect(flags).toContain('--graduate-suite');
  });

  it('includes suite name after --graduate-suite', () => {
    const flags = buildGraduateSuiteFlags('smoke');
    const idx = flags.indexOf('--graduate-suite');
    expect(flags[idx + 1]).toBe('smoke');
  });

  it('produces exactly two elements', () => {
    expect(buildGraduateSuiteFlags('smoke')).toHaveLength(2);
  });

  it('works with hyphenated suite names', () => {
    const flags = buildGraduateSuiteFlags('smoke-test');
    expect(flags).toContain('smoke-test');
  });
});
