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
    captureErrors: [],
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
    ...overrides,
  };
}

describe('PromptEfficiencyEvaluator', () => {
  const evaluator = new PromptEfficiencyEvaluator();

  it('returns score of 0 for zero user turns', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [] }),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('observed');
  });

  it('returns raw user turn count for single turn', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [makeTurn('user')] }),
      makeScenario(),
    );
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('observed');
  });

  it('returns raw user turn count for multiple turns', async () => {
    const turns = [makeTurn('user'), makeTurn('user')];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario(),
    );
    expect(result.score).toBe(2);
    expect(result.verdict).toBe('observed');
  });

  it('only counts user turns; assistant turns are ignored', async () => {
    const turns = [
      ...Array.from({ length: 2 }, () => makeTurn('user')),
      ...Array.from({ length: 8 }, () => makeTurn('assistant')),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario(),
    );
    expect(result.score).toBe(2);
    expect(result.verdict).toBe('observed');
  });

  it('details contains userTurns', async () => {
    const turns = [makeTurn('user'), makeTurn('user'), makeTurn('assistant')];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario(),
    );
    expect(result.details?.userTurns).toBe(2);
  });

  it('includes evalVersion in result', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [makeTurn('user')] }),
      makeScenario(),
    );
    expect(result.evalVersion).toBe('2.0');
  });

  it('has correct properties', () => {
    expect(evaluator.name).toBe('prompt-efficiency');
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.evalVersion).toBe('2.0');
    expect(evaluator.lowerIsBetter).toBe(true);
  });
});
