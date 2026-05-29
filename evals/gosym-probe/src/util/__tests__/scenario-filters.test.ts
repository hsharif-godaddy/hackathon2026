import { describe, it, expect } from 'vitest';
import {
  validateRunFlags,
  validateBaselineRunId,
  filterScenarios,
  findScenario,
  buildScenarioIndex,
  findScenariosBySuite,
} from '../scenario-filters.js';
import type { Scenario } from '../../scenarios/types.js';

function makeScenario(
  name: string,
  suite?: string,
): Scenario {
  return {
    name,
    suite,
    trials: 1,
    persona: {
      name: 'Test',
      description: '',
      systemPrompt: '',
    },
    goals: [],
    evaluators: [],
  };
}

const S_LANDING = makeScenario('build-landing-page', 'smoke');
const S_FIX_BUG = makeScenario('fix-bug', 'smoke');
const S_REFACTOR = makeScenario('refactor');

const ALL = [S_LANDING, S_FIX_BUG, S_REFACTOR];

// ── buildScenarioIndex ────────────────────────────────────────────────────────

describe('buildScenarioIndex()', () => {
  it('byName maps each scenario by name', () => {
    const index = buildScenarioIndex(ALL);
    expect(index.byName.get('build-landing-page')).toBe(S_LANDING);
    expect(index.byName.get('fix-bug')).toBe(S_FIX_BUG);
    expect(index.byName.get('refactor')).toBe(S_REFACTOR);
  });

  it('bySuite groups scenarios with the same suite', () => {
    const index = buildScenarioIndex(ALL);
    expect(index.bySuite.get('smoke')).toEqual(
      [S_LANDING, S_FIX_BUG],
    );
  });

  it('excludes no-suite scenarios from bySuite', () => {
    const index = buildScenarioIndex(ALL);
    expect(index.bySuite.has('undefined')).toBe(false);
    // refactor has no suite — should not appear in bySuite values
    for (const scenarios of index.bySuite.values()) {
      expect(scenarios).not.toContain(S_REFACTOR);
    }
  });

  it('returns empty maps for empty registry', () => {
    const index = buildScenarioIndex([]);
    expect(index.byName.size).toBe(0);
    expect(index.bySuite.size).toBe(0);
  });

  it('handles multiple distinct suites', () => {
    const a = makeScenario('a', 'alpha');
    const b = makeScenario('b', 'beta');
    const index = buildScenarioIndex([a, b]);
    expect(index.bySuite.get('alpha')).toEqual([a]);
    expect(index.bySuite.get('beta')).toEqual([b]);
  });
});

// ── findScenariosBySuite ──────────────────────────────────────────────────────

describe('findScenariosBySuite()', () => {
  it('returns scenarios in the given suite', () => {
    const index = buildScenarioIndex(ALL);
    const result = findScenariosBySuite(index, 'smoke');
    expect(result.error).toBeNull();
    expect(result.scenarios).toEqual([S_LANDING, S_FIX_BUG]);
  });

  it('returns error when suite is not found', () => {
    const index = buildScenarioIndex(ALL);
    const result = findScenariosBySuite(index, 'unknown');
    expect(result.scenarios).toHaveLength(0);
    expect(result.error).toContain('"unknown"');
  });
});

// ── validateRunFlags ──────────────────────────────────────────────────────────

describe('validateRunFlags()', () => {
  it('returns null when no flags are set', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when only skipBaseline is set', () => {
    expect(
      validateRunFlags({
        skipBaseline: true,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when only baseline is set', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        baseline: 'some-run-id',
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('returns error when baseline is combined with skip-baseline', () => {
    const err = validateRunFlags({
      skipBaseline: true,
      baseline: 'some-run-id',
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
    });
    expect(err).toContain('--baseline');
    expect(err).toContain('--skip-baseline');
  });

  it('returns error when baseline is combined with graduate', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      baseline: 'some-run-id',
      graduate: 'build-landing-page',
      graduateSuite: undefined,
      stability: undefined,
    });
    expect(err).toContain('--baseline');
    expect(err).toContain('--graduate');
  });

  it('returns error when baseline is combined with graduate-suite', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      baseline: 'some-run-id',
      graduate: undefined,
      graduateSuite: 'smoke',
      stability: undefined,
    });
    expect(err).toContain('--baseline');
    expect(err).toContain('--graduate-suite');
  });

  it('returns null when only graduate is set', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: 'build-landing-page',
        graduateSuite: undefined,
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('allows skipBaseline with graduate', () => {
    expect(
      validateRunFlags({
        skipBaseline: true,
        graduate: 'build-landing-page',
        graduateSuite: undefined,
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when stability is used with graduate', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: 'build-landing-page',
        graduateSuite: undefined,
        stability: 'high',
      }),
    ).toBeNull();
  });

  it('returns error when stability is set without graduate', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: 'high',
    });
    expect(err).toContain('--stability');
    expect(err).toContain('--graduate');
  });

  it('returns error for invalid stability value', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: 'build-landing-page',
      graduateSuite: undefined,
      stability: 'ultra',
    });
    expect(err).toContain('--stability');
    expect(err).toContain('low, medium, high');
  });

  it.each(['low', 'medium', 'high'])(
    'accepts stability=%s with graduate',
    (level) => {
      expect(
        validateRunFlags({
          skipBaseline: false,
          graduate: 'build-landing-page',
          graduateSuite: undefined,
          stability: level,
        }),
      ).toBeNull();
    },
  );

  it('returns null when only graduateSuite is set', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: 'smoke',
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('returns error when graduateSuite is combined with graduate', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: 'build-landing-page',
      graduateSuite: 'smoke',
      stability: undefined,
    });
    expect(err).toContain('--graduate-suite');
    expect(err).toContain('--graduate');
  });

  it('allows skipBaseline with graduateSuite', () => {
    expect(
      validateRunFlags({
        skipBaseline: true,
        graduate: undefined,
        graduateSuite: 'smoke',
        stability: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when trials is a positive integer string', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
        trials: '3',
      }),
    ).toBeNull();
  });

  it('returns error when trials is zero', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      trials: '0',
    });
    expect(err).toContain('--trials');
  });

  it('returns error when trials is non-numeric', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      trials: 'foo',
    });
    expect(err).toContain('--trials');
  });

  it('returns error when trials is negative', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      trials: '-1',
    });
    expect(err).toContain('--trials');
  });

  it('returns null when concurrency is not set', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
        concurrency: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when concurrency is a positive integer string', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
        concurrency: '3',
      }),
    ).toBeNull();
  });

  it('returns error when concurrency is zero', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      concurrency: '0',
    });
    expect(err).toContain('--concurrency');
  });

  it('returns error when concurrency is non-numeric', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      concurrency: 'abc',
    });
    expect(err).toContain('--concurrency');
  });

  it('returns error when concurrency is negative', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      concurrency: '-1',
    });
    expect(err).toContain('--concurrency');
  });

  it('returns null when maxTurns is not set', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
        maxTurns: undefined,
      }),
    ).toBeNull();
  });

  it('returns null when maxTurns is a positive integer', () => {
    expect(
      validateRunFlags({
        skipBaseline: false,
        graduate: undefined,
        graduateSuite: undefined,
        stability: undefined,
        maxTurns: '5',
      }),
    ).toBeNull();
  });

  it('returns error when maxTurns is zero', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      maxTurns: '0',
    });
    expect(err).toContain('--max-turns');
  });

  it('returns error when maxTurns is non-numeric', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      maxTurns: 'abc',
    });
    expect(err).toContain('--max-turns');
  });

  it('returns error when maxTurns is negative', () => {
    const err = validateRunFlags({
      skipBaseline: false,
      graduate: undefined,
      graduateSuite: undefined,
      stability: undefined,
      maxTurns: '-1',
    });
    expect(err).toContain('--max-turns');
  });
});

// ── filterScenarios ───────────────────────────────────────────────────────────

describe('filterScenarios()', () => {
  it('returns all scenarios when no filters given', () => {
    const index = buildScenarioIndex(ALL);
    const result = filterScenarios(index, undefined, undefined);
    expect(result.error).toBeNull();
    expect(result.scenarios).toEqual(ALL);
  });

  it('returns matching scenario when scenarioFilter matches', () => {
    const index = buildScenarioIndex(ALL);
    const result = filterScenarios(
      index,
      'build-landing-page',
      undefined,
    );
    expect(result.error).toBeNull();
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].name).toBe('build-landing-page');
  });

  it('returns error when scenarioFilter matches nothing', () => {
    const index = buildScenarioIndex(ALL);
    const result = filterScenarios(index, 'nonexistent', undefined);
    expect(result.scenarios).toHaveLength(0);
    expect(result.error).toContain('"nonexistent"');
    expect(result.error).toContain('build-landing-page');
    expect(result.error).toContain('fix-bug');
  });

  it('returns all scenarios in suite when suiteFilter given', () => {
    const index = buildScenarioIndex(ALL);
    const result = filterScenarios(index, undefined, 'smoke');
    expect(result.error).toBeNull();
    expect(result.scenarios).toEqual([S_LANDING, S_FIX_BUG]);
  });

  it('returns error when suiteFilter matches no suite', () => {
    const index = buildScenarioIndex(ALL);
    const result = filterScenarios(index, undefined, 'unknown');
    expect(result.scenarios).toHaveLength(0);
    expect(result.error).toContain('"unknown"');
  });

  it('ANDs scenarioFilter and suiteFilter', () => {
    const index = buildScenarioIndex(ALL);
    // scenario exists AND is in suite
    const hit = filterScenarios(
      index,
      'build-landing-page',
      'smoke',
    );
    expect(hit.error).toBeNull();
    expect(hit.scenarios).toHaveLength(1);
    expect(hit.scenarios[0].name).toBe('build-landing-page');

    // scenario exists but NOT in suite
    const miss = filterScenarios(
      index,
      'refactor',
      'smoke',
    );
    expect(miss.scenarios).toHaveLength(0);
    expect(miss.error).not.toBeNull();
  });

  it('returns empty scenarios and no error for empty registry', () => {
    const index = buildScenarioIndex([]);
    const result = filterScenarios(index, undefined, undefined);
    expect(result.error).toBeNull();
    expect(result.scenarios).toHaveLength(0);
  });
});

// ── findScenario ──────────────────────────────────────────────────────────────

describe('findScenario()', () => {
  it('returns the matching scenario', () => {
    const index = buildScenarioIndex(ALL);
    const result = findScenario(index, 'fix-bug');
    expect(result.error).toBeNull();
    expect(result.scenario?.name).toBe('fix-bug');
  });

  it('returns error when name does not match any scenario', () => {
    const index = buildScenarioIndex(ALL);
    const result = findScenario(index, 'nonexistent');
    expect(result.scenario).toBeNull();
    expect(result.error).toContain('"nonexistent"');
    expect(result.error).toContain('build-landing-page');
    expect(result.error).toContain('fix-bug');
  });
});

// ── validateBaselineRunId ─────────────────────────────────────────────────────

describe('validateBaselineRunId()', () => {
  const RUN_ID = 'abc-1234';

  it('returns null when all scenarios have the baseline', async () => {
    const store = {
      loadByRunId: async () => ({ scores: {}, filePath: '/some/path' }),
    };
    const err = await validateBaselineRunId(ALL, store, RUN_ID);
    expect(err).toBeNull();
  });

  it('returns null for an empty scenario list', async () => {
    const store = { loadByRunId: async () => null };
    const err = await validateBaselineRunId([], store, RUN_ID);
    expect(err).toBeNull();
  });

  it('returns an error message when a scenario baseline is missing', async () => {
    const store = { loadByRunId: async () => null };
    const err = await validateBaselineRunId([S_LANDING], store, RUN_ID);
    expect(err).toContain(RUN_ID);
    expect(err).toContain(S_LANDING.name);
  });

  it('reports all missing scenarios', async () => {
    const store = {
      loadByRunId: async (name: string) =>
        name === S_LANDING.name ? { scores: {}, filePath: '/p' } : null,
    };
    const err = await validateBaselineRunId(ALL, store, RUN_ID);
    expect(err).toContain(S_FIX_BUG.name);
    expect(err).not.toContain(S_LANDING.name);
    for (const scenario of ALL) {
      if (scenario.name !== S_LANDING.name) {
        expect(err).toContain(scenario.name);
      }
    }
  });

  it('propagates errors thrown by the store', async () => {
    const store = {
      loadByRunId: async () => {
        throw new Error('disk error');
      },
    };
    await expect(
      validateBaselineRunId([S_LANDING], store, RUN_ID),
    ).rejects.toThrow('disk error');
  });
});
