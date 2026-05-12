import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JTBDCompletionEvaluator } from '../jtbd-completion.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
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

describe('JTBDCompletionEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: JTBDCompletionEvaluator;

  beforeEach(() => {
    mockGocode = { complete: vi.fn() };
    evaluator = new JTBDCompletionEvaluator(
      mockGocode as unknown as GocodeClient,
    );
  });

  it('returns unknown without calling GoCode when no goals defined', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ goals: [] }),
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('maps "pass" response to pass verdict and score 1.0', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build a page', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('maps "partial" response to partial verdict and score 0.5', async () => {
    mockGocode.complete.mockResolvedValue('partial');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('partial');
    expect(result.score).toBe(0.5);
  });

  it('maps "fail" response to fail verdict and score 0.0', async () => {
    mockGocode.complete.mockResolvedValue('fail');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.0);
  });

  it('maps "unknown" response to unknown verdict', async () => {
    mockGocode.complete.mockResolvedValue('unknown');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('unknown');
  });

  it('defaults to unknown on unrecognized LLM response', async () => {
    mockGocode.complete.mockResolvedValue('I cannot determine the outcome.');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.verdict).toBe('unknown');
  });

  it('includes "Did the agent accomplish" for positive goals', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{
          description: 'add a hero section',
          assertion: 'positive',
        }],
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Did the agent accomplish');
    expect(prompt).toContain('add a hero section');
  });

  it('includes "Did the agent correctly avoid" for negative goals', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{
          description: 'delete existing content',
          assertion: 'negative',
        }],
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Did the agent correctly avoid');
    expect(prompt).toContain('delete existing content');
  });

  it('includes string reference solution in prompt', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
        referenceSolution: 'The correct answer is XYZ',
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('The correct answer is XYZ');
  });

  it('includes transcript turn content in prompt', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    const turns = [{
      role: 'user' as const,
      content: 'build me a landing page',
      toolCalls: [],
      timestamp: 0,
    }];
    await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('build me a landing page');
  });

  it('reports evaluator name correctly', async () => {
    mockGocode.complete.mockResolvedValue('pass');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
    );
    expect(result.evaluator).toBe('jtbd-completion');
  });

  it('is named jtbd-completion', () => {
    expect(evaluator.name).toBe('jtbd-completion');
  });
});
