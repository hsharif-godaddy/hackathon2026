import { describe, it, expect } from 'vitest';
import { AgentStepsEvaluator } from '../agent-steps.js';
import type { Transcript, Turn } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeAssistantTurn(totalSteps?: number): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: 0,
    totalSteps,
  };
}

function makeUserTurn(): Turn {
  return { role: 'user', content: '', toolCalls: [], timestamp: 0 };
}

function makeTranscript(turns: Turn[]): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns,
    snapshots: [],
    errors: [],
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

describe('AgentStepsEvaluator', () => {
  it("returns 'unknown' when no assistant turns have totalSteps", async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
  });

  it("returns 'unknown' when transcript has only user turns", async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
  });

  it('scores 1.0 when totalSteps sums to 0', async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(0)]),
      makeScenario(),
    );
    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('observed');
  });

  it("returns 'observed' at 2 of 10 max steps (score 0.8)", async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(2)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('observed');
  });

  it("returns 'observed' at boundary (6 of 10 → score 0.4)", async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(6)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.4);
    expect(result.verdict).toBe('observed');
  });

  it("returns 'observed' when steps meet max", async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(10)]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('observed');
  });

  it('score clamps to 0 when steps exceed max', async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(15)]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('observed');
  });

  it('sums totalSteps across multiple assistant turns', async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(1), makeAssistantTurn(1)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('observed');
  });

  it('only counts assistant turns; user turns are ignored', async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(2), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.8);
  });

  it('details contains totalSteps and maxSteps', async () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3)]),
      makeScenario(),
    );
    expect(result.details?.totalSteps).toBe(3);
    expect(result.details?.maxSteps).toBe(10);
  });

  it('has correct name and properties', () => {
    const evaluator = new AgentStepsEvaluator({ maxSteps: 10 });
    expect(evaluator.name).toBe('agent-steps');
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });

  it('throws RangeError when maxSteps is 0', () => {
    expect(() => new AgentStepsEvaluator({ maxSteps: 0 }))
      .toThrow(RangeError);
  });

  it('throws RangeError when maxSteps is negative', () => {
    expect(() => new AgentStepsEvaluator({ maxSteps: -5 }))
      .toThrow(RangeError);
  });

  it('throws RangeError when maxSteps is NaN', () => {
    expect(() => new AgentStepsEvaluator({ maxSteps: NaN }))
      .toThrow(RangeError);
  });

  it('throws RangeError when maxSteps is Infinity', () => {
    expect(() => new AgentStepsEvaluator({ maxSteps: Infinity }))
      .toThrow(RangeError);
  });
});
