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
    executionMode: 'sequential',
    category: 'regression',
    setup: noop,
    teardown: noop,
    ...overrides,
  };
}


describe('formatScenariosTable', () => {
  it('includes all column headers', () => {
    const result = (formatScenariosTable([]));
    expect(result).toContain('Name');
    expect(result).toContain('Category');
    expect(result).toContain('Trials');
    expect(result).toContain('Mode');
    expect(result).toContain('Evaluators');
  });

  it('includes scenario name', () => {
    const s = makeScenario({ name: 'build-landing-page' });
    expect(formatScenariosTable([s])).toContain(
      'build-landing-page',
    );
  });

  it('includes category', () => {
    const s = makeScenario({ category: 'capability' });
    expect(formatScenariosTable([s])).toContain('capability');
  });

  it('includes trial count', () => {
    const s = makeScenario({ trials: 5 });
    expect(formatScenariosTable([s])).toContain('5');
  });

  it('shows sequential as default mode', () => {
    const s = makeScenario({ executionMode: undefined });
    expect(formatScenariosTable([s])).toContain('sequential');
  });

  it('shows parallel execution mode', () => {
    const s = makeScenario({ executionMode: 'parallel' });
    expect(formatScenariosTable([s])).toContain('parallel');
  });

  it('shows evaluator count', () => {
    const s = makeScenario({
      evaluators: [
        {
          name: 'ev-1',
          deterministic: true,
          evaluate: async () => ({
            evaluator: 'ev-1',
            score: 1,
            verdict: 'pass' as const,
            reason: '',
          }),
        },
        {
          name: 'ev-2',
          deterministic: true,
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
