import { describe, it, expect } from 'vitest';
import { BugHitRateEvaluator } from '../bug-hit-rate.js';
import type { Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

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

describe('BugHitRateEvaluator', () => {
  const evaluator = new BugHitRateEvaluator();

  it('passes with score 1.0 when no errors', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('passes when exactly 1 error', async () => {
    const transcript = makeTranscript({ errors: ['tool failed'] });
    const result = await evaluator.evaluate(
      transcript,
      makeScenario(),
    );
    expect(result.verdict).toBe('pass');
  });

  it('score is 0.5 for 1 error', async () => {
    const transcript = makeTranscript({ errors: ['tool failed'] });
    const result = await evaluator.evaluate(
      transcript,
      makeScenario(),
    );
    expect(result.score).toBeCloseTo(0.5);
  });

  it('fails when more than 1 error', async () => {
    const transcript = makeTranscript({ errors: ['err1', 'err2'] });
    const result = await evaluator.evaluate(
      transcript,
      makeScenario(),
    );
    expect(result.verdict).toBe('fail');
  });

  it('score decreases as error count grows', async () => {
    const r2 = await evaluator.evaluate(
      makeTranscript({ errors: ['a', 'b'] }),
      makeScenario(),
    );
    const r3 = await evaluator.evaluate(
      makeTranscript({ errors: ['a', 'b', 'c'] }),
      makeScenario(),
    );
    expect(r3.score).toBeLessThan(r2.score);
  });

  it('includes error count and errors array in details', async () => {
    const errors = ['timeout', 'auth failed'];
    const result = await evaluator.evaluate(
      makeTranscript({ errors }),
      makeScenario(),
    );
    expect(result.details?.errorCount).toBe(2);
    expect(result.details?.errors).toEqual(errors);
  });

  it('reports evaluator name correctly', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
    );
    expect(result.evaluator).toBe('bug-hit-rate');
  });

  it('is named bug-hit-rate', () => {
    expect(evaluator.name).toBe('bug-hit-rate');
  });

  it('does not count captureErrors as agent errors', async () => {
    const transcript = makeTranscript({
      errors: [],
      captureErrors: ['page.waitForSelector: Timeout 90000ms exceeded'],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('counts only agent errors when both arrays are populated', async () => {
    const transcript = makeTranscript({
      errors: ['agent tool error'],
      captureErrors: ['capture timeout'],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.score).toBeCloseTo(0.5);
    expect(result.verdict).toBe('pass');
  });
});
