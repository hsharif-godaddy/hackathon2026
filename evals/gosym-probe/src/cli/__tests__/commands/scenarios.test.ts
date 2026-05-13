import { describe, it, expect } from 'vitest';
import { formatScenariosTable } from '../../commands/scenarios.js';
import type { Scenario } from '../../../scenarios/types.js';

const noop = async () => {};

function makeScenario(
  overrides: Partial<Scenario>,
): Scenario {
  return {
    name: 'test-scenario',
    persona: {
      name: 'tester',
      description: 'A test persona',
      systemPrompt: 'You are a tester.',
    },
    goals: [],
    evaluators: [],
    trials: 3,
    setup: noop,
    teardown: noop,
    ...overrides,
  };
}


describe('formatScenariosTable', () => {
  it('includes all column headers', () => {
    const result = (formatScenariosTable([]));
    expect(result).toContain('Name');
    expect(result).toContain('Trials');
    expect(result).toContain('Evaluators');
  });

  it('includes scenario name', () => {
    const s = makeScenario({ name: 'build-landing-page' });
    expect(formatScenariosTable([s])).toContain(
      'build-landing-page',
    );
  });

  it('includes trial count', () => {
    const s = makeScenario({ trials: 5 });
    expect(formatScenariosTable([s])).toContain('5');
  });

  it('shows evaluator count', () => {
    const s = makeScenario({
      evaluators: [
        {
          name: 'ev-1',
          evaluate: async () => ({
            evaluator: 'ev-1',
            score: 1,
            verdict: 'pass' as const,
            reason: '',
          }),
        },
        {
          name: 'ev-2',
          evaluate: async () => ({
            evaluator: 'ev-2',
            score: 1,
            verdict: 'pass' as const,
            reason: '',
          }),
        },
      ],
    });
    expect(formatScenariosTable([s])).toContain('2');
  });

  it('handles empty scenario list without throwing', () => {
    expect(() => formatScenariosTable([])).not.toThrow();
  });

  it('includes all scenarios in multi-scenario list', () => {
    const scenarios = [
      makeScenario({ name: 'alpha' }),
      makeScenario({ name: 'beta' }),
    ];
    const result = formatScenariosTable(scenarios);
    expect(result).toContain('alpha');
    expect(result).toContain('beta');
  });
});
