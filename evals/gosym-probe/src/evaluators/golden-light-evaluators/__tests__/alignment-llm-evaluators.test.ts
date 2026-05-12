import { describe, it, expect } from 'vitest';

import type { DOMSnapshot, Transcript, Turn, ToolCall } from '../../../runner/transcript.js';
import type { GocodeClient } from '../../../clients/gocode-client.js';
import type { Scenario } from '../../../scenarios/types.js';
import {
  createAlignmentLLMEvaluators,
  ALIGNMENT_EVAL_VERSION,
} from '../alignment-llm-evaluators.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeGocode(response: object): GocodeClient {
  return {
    complete: async () => JSON.stringify(response),
  } as unknown as GocodeClient;
}

function makeFailingGocode(message: string): GocodeClient {
  return {
    complete: async () => {
      throw new Error(message);
    },
  } as unknown as GocodeClient;
}

function makeTurn(
  role: 'user' | 'assistant',
  content: string,
  toolCalls: ToolCall[] = [],
): Turn {
  return { role, content, toolCalls, timestamp: 0 };
}

function makeTranscript(turns: Turn[] = [], errors: string[] = []): Transcript {
  return {
    scenarioName: 'test-scenario',
    trialIndex: 0,
    turns,
    snapshots: [],
    errors,
  };
}

function makeScenario(): Scenario {
  return {
    name: 'test-scenario',
    persona: { name: 'p', description: 'd', systemPrompt: 'Build a site for me.' },
    goals: [{ description: 'Site was built', assertion: 'positive' }],
    evaluators: [],
    trials: 1,
  };
}

function makeInlineSnapshot(html: string): DOMSnapshot {
  return {
    url: 'https://example.test',
    screenshotPath: '/tmp/test.png',
    htmlPath: '',
    timestamp: new Date().toISOString(),
    consoleLogs: [],
    html,
  };
}

const VALID_TURNS = [makeTurn('user', 'Build me a portfolio')];
const VALID_SNAPSHOT = makeInlineSnapshot('<html><body><h1>Portfolio</h1></body></html>');

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe('createAlignmentLLMEvaluators', () => {
  it('returns exactly 4 evaluators', () => {
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    expect(evs).toHaveLength(4);
  });

  it('returns evaluators with correct names', () => {
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    const names = evs.map((e) => e.name);
    expect(names).toContain('intent-to-output-alignment');
    expect(names).toContain('implicit-feature-gap');
    expect(names).toContain('scope-drift-overgeneration');
    expect(names).toContain('silent-hallucination');
  });

  it('all evaluators have evalVersion equal to ALIGNMENT_EVAL_VERSION', () => {
    expect(ALIGNMENT_EVAL_VERSION).toBe('1.0');
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    for (const ev of evs) {
      expect(ev.evalVersion).toBe(ALIGNMENT_EVAL_VERSION);
    }
  });
});

// ---------------------------------------------------------------------------
// intent-to-output-alignment (numerical)
// ---------------------------------------------------------------------------

describe('intent-to-output-alignment (numerical)', () => {
  function getEval(gocode: GocodeClient) {
    return createAlignmentLLMEvaluators(gocode).find(
      (e) => e.name === 'intent-to-output-alignment',
    )!;
  }

  it('pass case: maps score and verdict from valid LLM response', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'well aligned' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.evaluator).toBe('intent-to-output-alignment');
    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('well aligned');
    expect(result.evalVersion).toBe(ALIGNMENT_EVAL_VERSION);
  });

  it('partial case: maps partial verdict correctly', async () => {
    const ev = getEval(makeGocode({ score: 0.55, verdict: 'partial', reason: 'mostly aligned' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBeCloseTo(0.55);
    expect(result.verdict).toBe('partial');
  });

  it('fail case: maps fail verdict correctly', async () => {
    const ev = getEval(makeGocode({ score: 0.1, verdict: 'fail', reason: 'misaligned output' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBeCloseTo(0.1);
    expect(result.verdict).toBe('fail');
  });

  it('unknown verdict forces score to 0', async () => {
    const ev = getEval(makeGocode({ score: 0.5, verdict: 'unknown', reason: 'insufficient' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('canEvaluate returns false for empty transcript → verdict unknown', async () => {
    const ev = getEval(makeGocode({ score: 0.8, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript([]), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('LLM failure returns verdict unknown', async () => {
    const ev = getEval(makeFailingGocode('network timeout'));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('network timeout');
  });

  it('malformed JSON from LLM returns verdict unknown', async () => {
    const brokenGocode = {
      complete: async () => 'this is not json at all',
    } as unknown as GocodeClient;
    const ev = getEval(brokenGocode);
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('schema mismatch from LLM returns verdict unknown', async () => {
    const ev = getEval(makeGocode({ unexpected_field: 'wrong', verdict: 'pass' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('validateEvidence rejects empty body HTML → verdict unknown', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'ok' }));
    const emptyBodySnapshot = makeInlineSnapshot('<html><body></body></html>');
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), emptyBodySnapshot,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toContain('Evidence validation failed');
  });

  it('result.details contains dimension, inputsUsed, and transcriptErrors', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.details).toEqual({
      dimension: 'Intent Understanding & Alignment',
      inputsUsed: ['conversation', 'final_artifacts'],
      transcriptErrors: 0,
    });
  });

});

// ---------------------------------------------------------------------------
// Boolean polarity inversion — implicit-feature-gap (booleanTrueIsGood=false)
// ---------------------------------------------------------------------------

describe('implicit-feature-gap (boolean, booleanTrueIsGood=false)', () => {
  function getEval(gocode: GocodeClient) {
    return createAlignmentLLMEvaluators(gocode).find(
      (e) => e.name === 'implicit-feature-gap',
    )!;
  }

  it('value=true (problem present) → verdict fail, score 0', async () => {
    const ev = getEval(makeGocode({ value: true, verdict: 'fail', reason: 'missing contact info' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('value=false (no problem) → verdict pass, score 1', async () => {
    const ev = getEval(makeGocode({ value: false, verdict: 'pass', reason: 'all features present' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });

  it('result.details contains dimension, inputsUsed, value, and transcriptErrors', async () => {
    const ev = getEval(makeGocode({ value: false, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.details).toEqual({
      dimension: 'Implicit Feature Completeness',
      inputsUsed: ['conversation', 'final_artifacts'],
      value: false,
      transcriptErrors: 0,
    });
  });

  it('unknown verdict forces score to 0 regardless of value', async () => {
    const ev = getEval(makeGocode({ value: false, verdict: 'unknown', reason: 'unclear' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('canEvaluate returns false for empty transcript → verdict unknown', async () => {
    const ev = getEval(makeGocode({ value: false, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript([]), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });

  it('LLM failure returns verdict unknown', async () => {
    const ev = getEval(makeFailingGocode('timeout'));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Boolean polarity verification for remaining boolean evaluators
// ---------------------------------------------------------------------------

describe('scope-drift-overgeneration (boolean, booleanTrueIsGood=false)', () => {
  it('value=true (drift present) → fail', async () => {
    const evs = createAlignmentLLMEvaluators(
      makeGocode({ value: true, verdict: 'fail', reason: 'unnecessary pages added' }),
    );
    const ev = evs.find((e) => e.name === 'scope-drift-overgeneration')!;
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
  });

  it('value=false (no drift) → pass', async () => {
    const evs = createAlignmentLLMEvaluators(
      makeGocode({ value: false, verdict: 'pass', reason: 'scope kept tight' }),
    );
    const ev = evs.find((e) => e.name === 'scope-drift-overgeneration')!;
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
  });
});

describe('silent-hallucination (boolean, booleanTrueIsGood=false)', () => {
  it('value=true (hallucination present) → fail', async () => {
    const evs = createAlignmentLLMEvaluators(
      makeGocode({ value: true, verdict: 'fail', reason: 'claimed email configured, no tool call' }),
    );
    const ev = evs.find((e) => e.name === 'silent-hallucination')!;
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
  });

  it('value=false (no hallucination) → pass', async () => {
    const evs = createAlignmentLLMEvaluators(
      makeGocode({ value: false, verdict: 'pass', reason: 'all claims backed by tool calls' }),
    );
    const ev = evs.find((e) => e.name === 'silent-hallucination')!;
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
  });
});
