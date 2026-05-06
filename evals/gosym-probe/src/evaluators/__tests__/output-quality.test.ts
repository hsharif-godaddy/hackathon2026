import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputQualityEvaluator } from '../output-quality.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type {
  DOMSnapshot,
  Transcript,
} from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeSnapshot(
  html = '<body><h1>Hello</h1></body>',
): DOMSnapshot {
  return {
    url: 'https://localhost:8443',
    html,
    screenshot: Buffer.from(''),
    timestamp: new Date().toISOString(),
    consoleLogs: [],
  };
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

describe('OutputQualityEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: OutputQualityEvaluator;

  beforeEach(() => {
    mockGocode = { complete: vi.fn() };
    evaluator = new OutputQualityEvaluator(
      mockGocode as unknown as GocodeClient,
    );
  });

  it('returns unknown without calling GoCode when no snapshot', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('returns unknown without calling GoCode for empty snapshot HTML', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
      makeSnapshot(''),
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('returns unknown for whitespace-only snapshot HTML', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario(),
      makeSnapshot('   \n  '),
    );
    expect(result.verdict).toBe('unknown');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('parses SCORE, VERDICT and REASON from LLM response', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.8\nVERDICT: pass\nREASON: Good output',
    );
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build a page', assertion: 'positive' }],
      }),
      makeSnapshot(),
    );
    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('Good output');
  });

  it('clamps score to 1.0 when LLM returns score > 1', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 1.5\nVERDICT: pass\nREASON: test',
    );
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      makeSnapshot(),
    );
    expect(result.score).toBe(1.0);
  });

  it('clamps score to 0.0 when LLM returns score < 0', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: -0.5\nVERDICT: fail\nREASON: test',
    );
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      makeSnapshot(),
    );
    expect(result.score).toBe(0.0);
  });

  it('returns unknown on unparseable LLM response', async () => {
    mockGocode.complete.mockResolvedValue('I cannot tell.');
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      makeSnapshot(),
    );
    expect(result.verdict).toBe('unknown');
  });

  it('extracts body content from full HTML page in prompt', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.9\nVERDICT: pass\nREASON: ok',
    );
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      makeSnapshot('<html><body><h1>Hello World</h1></body></html>'),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Hello World');
  });

  it('includes Reference DOM section when referenceSolution is a DOMSnapshot', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.9\nVERDICT: pass\nREASON: Matches reference',
    );
    const refSnapshot = makeSnapshot('<body><h1>Reference</h1></body>');
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
        referenceSolution: refSnapshot,
      }),
      makeSnapshot(),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Reference DOM');
    expect(prompt).toContain('Reference');
  });

  it('does not include Reference DOM when referenceSolution is a string', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.9\nVERDICT: pass\nREASON: ok',
    );
    await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
        referenceSolution: 'some string ref',
      }),
      makeSnapshot(),
    );
    const prompt =
      mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).not.toContain('Reference DOM');
  });

  it('reports evaluator name correctly', async () => {
    mockGocode.complete.mockResolvedValue(
      'SCORE: 0.8\nVERDICT: pass\nREASON: ok',
    );
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({
        goals: [{ description: 'build', assertion: 'positive' }],
      }),
      makeSnapshot(),
    );
    expect(result.evaluator).toBe('output-quality');
  });

  it('is not deterministic', () => {
    expect(evaluator.deterministic).toBe(false);
  });
});
