import { describe, it, expect } from 'vitest';
import { AgentStepsEvaluator } from '../agent-steps.js';
import type { Transcript, Turn } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

function expectedSigmoid(count: number): number {
  return 1 / (1 + Math.exp(0.2 * (count - 15)));
}

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
    expect(result.verdict).toBe('unknown');
  });

  it("returns 'unknown' when transcript has only user turns", async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
  });

  it('returns high score when totalSteps sums to 0', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(0)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(expectedSigmoid(0), 10);
    expect(result.verdict).toBe('observed');
  });

  it('applies sigmoid normalization to step count', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(4)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(expectedSigmoid(4), 10);
    expect(result.verdict).toBe('observed');
  });

  it('sums totalSteps across multiple assistant turns', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3), makeAssistantTurn(5)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(expectedSigmoid(8), 10);
    expect(result.verdict).toBe('observed');
  });

  it('only counts assistant turns; user turns are ignored', async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(4), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(expectedSigmoid(4), 10);
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
    expect(result.evalVersion).toBe('1.0');
  });

  it("returns 'unknown' when totalSteps sum is NaN", async () => {
    const evaluator = new AgentStepsEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(NaN)]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('Invalid totalSteps');
    expect(result.evalVersion).toBe('1.0');
  });

  it('has correct name and properties', () => {
    const evaluator = new AgentStepsEvaluator();
    expect(evaluator.name).toBe('agent-steps');
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.evalVersion).toBe('1.0');
    expect(evaluator.lowerIsBetter).toBe(false);
  });
});
