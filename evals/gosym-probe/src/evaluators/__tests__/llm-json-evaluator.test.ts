import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import { LLMJsonEvaluator, JudgeNumericalSchema } from '../llm-json-evaluator.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

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

const testScenario: Scenario = {
  name: 'test-scenario',
  persona: { name: 'p', description: 'd', systemPrompt: 'sp' },
  goals: [],
  evaluators: [],
  trials: 1,
  category: 'capability',
};

function validResponse(score: number = 0.8): string {
  return JSON.stringify({ score, verdict: 'pass', reason: 'looks good' });
}

// Minimal schema for testing the generic plumbing without binding to a specific shape
const TestSchema = JudgeNumericalSchema;

function makeEvaluator(
  complete: () => Promise<string>,
  opts: { evalVersion?: string; scoreOverride?: number } = {},
) {
  const gocode = { complete: vi.fn(complete) } as unknown as GocodeClient;
  const evaluator = new LLMJsonEvaluator(gocode, {
    name: 'test-evaluator',
    evalVersion: opts.evalVersion,
    schema: TestSchema,
    prompt: () => 'evaluate this',
    toEvalResult: (parsed, _transcript, _scenario) => ({
      evaluator: 'test-evaluator',
      score: opts.scoreOverride ?? parsed.score,
      verdict: parsed.verdict,
      reason: parsed.reason,
    }),
  });
  return { evaluator, gocode };
}

// ── Error path tests ──────────────────────────────────────────────────────────

describe('LLMJsonEvaluator — error paths', () => {
  it('returns unknown when LLM request throws', async () => {
    const { evaluator } = makeEvaluator(() => {
      throw new Error('network timeout');
    });
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('network timeout');
  });

  it('returns unknown when response contains no JSON object', async () => {
    const { evaluator } = makeEvaluator(async () => 'I cannot evaluate this.');
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('No JSON object found in LLM judge response');
  });

  it('returns unknown when JSON is syntactically malformed', async () => {
    const { evaluator } = makeEvaluator(async () => '{score: 0.8 verdict: pass}');
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('LLM judge response contained malformed JSON');
  });

  it('returns unknown when JSON does not match schema', async () => {
    const { evaluator } = makeEvaluator(async () =>
      JSON.stringify({ unexpected: 'shape' }),
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('did not match expected schema');
  });

  it('includes response snippet in details on no-JSON failure', async () => {
    const { evaluator } = makeEvaluator(async () => 'no json here at all');
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.details).toMatchObject({ response: expect.any(String) });
  });

  it('includes schema issues in details on schema failure', async () => {
    const { evaluator } = makeEvaluator(async () =>
      JSON.stringify({ wrong: true }),
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.details).toMatchObject({ issues: expect.any(Array) });
  });
});

// ── Validation boundary tests (JSON extraction) ───────────────────────────────

describe('LLMJsonEvaluator — JSON extraction boundaries', () => {
  it('extracts JSON embedded in surrounding prose', async () => {
    const json = validResponse(0.75);
    const { evaluator } = makeEvaluator(
      async () => `Sure! Here is my assessment: ${json}. Hope that helps.`,
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('pass');
    expect(result.score).toBeCloseTo(0.75);
  });

  it('extracts outermost JSON when response contains nested objects', async () => {
    const withNested = JSON.stringify({
      score: 0.6,
      verdict: 'partial',
      reason: 'ok',
      meta: { extra: 'ignored' },
    });
    // LLMJsonEvaluator uses indexOf / lastIndexOf so the outer braces are captured
    const { evaluator } = makeEvaluator(async () => withNested);
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('partial');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('returns unknown when response has closing brace but no opening brace', async () => {
    const { evaluator } = makeEvaluator(async () => 'score: 0.8 }');
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
  });

  it('returns unknown when response has opening brace but no closing brace', async () => {
    const { evaluator } = makeEvaluator(async () => '{ score: 0.8');
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
  });

  it('returns unknown when closing brace appears before opening brace', async () => {
    // indexOf('{') > lastIndexOf('}') → end <= start
    const { evaluator } = makeEvaluator(async () => '} then {');
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.verdict).toBe('unknown');
  });
});

// ── Integration seam tests ────────────────────────────────────────────────────

describe('LLMJsonEvaluator — evalVersion propagation', () => {
  it('includes evalVersion on successful result when configured', async () => {
    const { evaluator } = makeEvaluator(
      async () => validResponse(),
      { evalVersion: 'v2' },
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.evalVersion).toBe('v2');
  });

  it('omits evalVersion on successful result when not configured', async () => {
    const { evaluator } = makeEvaluator(async () => validResponse());
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.evalVersion).toBeUndefined();
  });

  it('includes evalVersion on LLM error result when configured', async () => {
    const { evaluator } = makeEvaluator(
      () => { throw new Error('fail'); },
      { evalVersion: 'v2' },
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.evalVersion).toBe('v2');
  });

  it('includes evalVersion on no-JSON result when configured', async () => {
    const { evaluator } = makeEvaluator(async () => 'no json', { evalVersion: 'v2' });
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.evalVersion).toBe('v2');
  });

  it('includes evalVersion on schema-mismatch result when configured', async () => {
    const { evaluator } = makeEvaluator(
      async () => JSON.stringify({ bad: true }),
      { evalVersion: 'v2' },
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.evalVersion).toBe('v2');
  });
});

describe('LLMJsonEvaluator — score clamping', () => {
  it('clamps score above 1.0 to 1.0', async () => {
    const { evaluator } = makeEvaluator(
      async () => validResponse(),
      { scoreOverride: 1.5 },
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.score).toBe(1.0);
  });

  it('clamps score below 0 to 0.0', async () => {
    const { evaluator } = makeEvaluator(
      async () => validResponse(),
      { scoreOverride: -0.3 },
    );
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.score).toBe(0.0);
  });

  it('does not clamp scores within [0, 1]', async () => {
    const { evaluator } = makeEvaluator(async () => validResponse(0.65));
    const result = await evaluator.evaluate(makeTranscript(), testScenario);
    expect(result.score).toBeCloseTo(0.65);
  });
});

// ── Evidence validation tests ────────────────────────────────────────────────

describe('LLMJsonEvaluator — validateEvidence', () => {
  it('returns unknown without calling LLM when validateEvidence returns false', async () => {
    const gocode = { complete: vi.fn(async () => validResponse()) } as unknown as GocodeClient;
    const evaluator = new LLMJsonEvaluator(gocode, {
      name: 'test-evaluator',
      evalVersion: 'v1',
      schema: TestSchema,
      canEvaluate: () => true,
      validateEvidence: async () => false,
      prompt: () => 'evaluate this',
      toEvalResult: (parsed) => ({
        evaluator: 'test-evaluator',
        score: parsed.score,
        verdict: parsed.verdict,
        reason: parsed.reason,
      }),
    });

    const result = await evaluator.evaluate(makeTranscript(), testScenario);

    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('Evidence validation failed');
    expect(result.evalVersion).toBe('v1');
    expect(gocode.complete).not.toHaveBeenCalled();
  });

  it('proceeds to LLM call when validateEvidence returns true', async () => {
    const gocode = { complete: vi.fn(async () => validResponse(0.9)) } as unknown as GocodeClient;
    const evaluator = new LLMJsonEvaluator(gocode, {
      name: 'test-evaluator',
      schema: TestSchema,
      canEvaluate: () => true,
      validateEvidence: async () => true,
      prompt: () => 'evaluate this',
      toEvalResult: (parsed) => ({
        evaluator: 'test-evaluator',
        score: parsed.score,
        verdict: parsed.verdict,
        reason: parsed.reason,
      }),
    });

    const result = await evaluator.evaluate(makeTranscript(), testScenario);

    expect(result.verdict).toBe('pass');
    expect(result.score).toBeCloseTo(0.9);
    expect(gocode.complete).toHaveBeenCalledOnce();
  });

  it('skips validateEvidence when not configured', async () => {
    const gocode = { complete: vi.fn(async () => validResponse(0.7)) } as unknown as GocodeClient;
    const evaluator = new LLMJsonEvaluator(gocode, {
      name: 'test-evaluator',
      schema: TestSchema,
      prompt: () => 'evaluate this',
      toEvalResult: (parsed) => ({
        evaluator: 'test-evaluator',
        score: parsed.score,
        verdict: parsed.verdict,
        reason: parsed.reason,
      }),
    });

    const result = await evaluator.evaluate(makeTranscript(), testScenario);

    expect(result.verdict).toBe('pass');
    expect(gocode.complete).toHaveBeenCalledOnce();
  });
});

// ── Meta tests ────────────────────────────────────────────────────────────────

describe('LLMJsonEvaluator — class properties', () => {
  it('name matches config', () => {
    const gocode = { complete: vi.fn() } as unknown as GocodeClient;
    const ev = new LLMJsonEvaluator(gocode, {
      name: 'my-evaluator',
      schema: z.object({ value: z.number() }),
      prompt: () => '',
      toEvalResult: () => ({ evaluator: 'my-evaluator', score: 0, verdict: 'unknown', reason: '' }),
    });
    expect(ev.name).toBe('my-evaluator');
  });

});
