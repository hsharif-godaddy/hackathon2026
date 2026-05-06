import { describe, it, expect } from 'vitest';
import { TurnDurationEvaluator } from '../turn-duration.js';
import type { Transcript, Turn } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeAssistantTurn(durationMs?: number): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: 0,
    durationMs,
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
    category: 'regression',
    ...overrides,
  };
}

describe('TurnDurationEvaluator', () => {
  it("returns 'unknown' when no assistant turns have durationMs", async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
  });

  it("returns 'unknown' when transcript has only user turns", async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
  });

  it('scores 1.0 when durationMs sums to 0', async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(0)]),
      makeScenario(),
    );
    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it("returns 'pass' at 2000 of 10000 max ms (score 0.8)", async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(2000)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
  });

  it("returns 'partial' at boundary (6000 of 10000 → score 0.4)", async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(6000)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.4);
    expect(result.verdict).toBe('partial');
  });

  it("returns 'fail' when duration meets max", async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(10000)]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('score clamps to 0 when duration exceeds max', async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(15000)]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('sums durationMs across multiple assistant turns', async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(1000), makeAssistantTurn(1000)]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
  });

  it('only counts assistant turns; user turns are ignored', async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(2000), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.8);
  });

  it('details contains totalDurationMs and maxDurationMs', async () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3000)]),
      makeScenario(),
    );
    expect(result.details?.totalDurationMs).toBe(3000);
    expect(result.details?.maxDurationMs).toBe(10000);
  });

  it('is deterministic and named turn-duration', () => {
    const evaluator = new TurnDurationEvaluator({ maxDurationMs: 10000 });
    expect(evaluator.deterministic).toBe(true);
    expect(evaluator.name).toBe('turn-duration');
  });
});
