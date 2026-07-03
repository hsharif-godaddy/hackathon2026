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
    captureErrors: [],
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
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it("returns 'unknown' when transcript has only user turns", async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('returns score of 0 for totalSteps=0', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(0)]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('directional');
  });

  it('returns raw step count', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(4)]),
      makeScenario(),
    );
    expect(result.score).toBe(4);
    expect(result.verdict).toBe('directional');
  });

  it('sums totalSteps across multiple assistant turns', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3), makeAssistantTurn(5)]),
      makeScenario(),
    );
    expect(result.score).toBe(8);
    expect(result.verdict).toBe('directional');
  });

  it('only counts assistant turns; user turns are ignored', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(4), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.score).toBe(4);
  });

  it('details contains totalSteps', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3)]),
      makeScenario(),
    );
    expect(result.details?.totalSteps).toBe(3);
  });

  it('includes evalVersion in result', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(5)]),
      makeScenario(),
    );
    expect(result.evalVersion).toBe('2.0');
  });

  it("returns 'unknown' when totalSteps sum is NaN", async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(NaN)]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
    expect(result.reason).toContain('Invalid totalSteps');
    expect(result.evalVersion).toBe('2.0');
  });

  it('returns score of 1000 for large step count (unclamped)', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(1000)]),
      makeScenario(),
    );
    expect(result.score).toBe(1000);
    expect(result.verdict).toBe('directional');
  });

  it('has correct name and properties', () => {
    const evaluator = new AgentStepsEvaluator();
    expect(evaluator.name).toBe('agent-steps');
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.evalVersion).toBe('2.0');
    expect(evaluator.lowerIsBetter).toBe(true);
  });
});
