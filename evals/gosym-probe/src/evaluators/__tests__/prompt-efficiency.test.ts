import { describe, it, expect } from 'vitest';
import { PromptEfficiencyEvaluator } from '../prompt-efficiency.js';
import type { Transcript, Turn } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeTurn(role: 'user' | 'assistant'): Turn {
  return { role, content: '', toolCalls: [], timestamp: 0 };
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    ...overrides,
  };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    category: 'regression',
    ...overrides,
  };
}

describe('PromptEfficiencyEvaluator', () => {
  const evaluator = new PromptEfficiencyEvaluator();

  it('scores 1.0 with zero user turns', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [] }),
      makeScenario({ maxTurns: 10 }),
    );
    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('observed');
  });

  it('scores high with few turns relative to maxTurns', async () => {
    // 2 of 10 max → score 0.8
    const turns = [makeTurn('user'), makeTurn('user')];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 10 }),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.8);
  });

  it("returns 'observed' when approaching maxTurns", async () => {
    // 6 user turns of 10 max → score 0.4
    const turns = Array.from({ length: 6 }, () => makeTurn('user'));
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 10 }),
    );
    expect(result.verdict).toBe('observed');
  });

  it("returns 'observed' when user turns equal maxTurns", async () => {
    const turns = Array.from({ length: 10 }, () => makeTurn('user'));
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 10 }),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('observed');
  });

  it('score does not go below 0 when turns exceed maxTurns', async () => {
    const turns = Array.from({ length: 15 }, () => makeTurn('user'));
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 10 }),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('observed');
  });

  it('only counts user turns, not assistant turns', async () => {
    const turns = [
      ...Array.from({ length: 2 }, () => makeTurn('user')),
      ...Array.from({ length: 8 }, () => makeTurn('assistant')),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 10 }),
    );
    // 2 user turns of 10 max → score 0.8
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('observed');
  });

  it('uses scenario.maxTurns when set', async () => {
    const turns = [makeTurn('user'), makeTurn('user')]; // 2 of 4
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 4 }),
    );
    expect(result.score).toBeCloseTo(0.5);
  });

  it('includes userTurns and maxTurns in details', async () => {
    const turns = [
      makeTurn('user'),
      makeTurn('user'),
      makeTurn('assistant'),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ maxTurns: 10 }),
    );
    expect(result.details?.userTurns).toBe(2);
    expect(result.details?.maxTurns).toBe(10);
  });

  it('has correct properties', () => {
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });
});
