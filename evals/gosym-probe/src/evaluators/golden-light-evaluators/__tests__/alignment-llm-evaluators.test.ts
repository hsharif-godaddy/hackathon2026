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
  it('returns exactly 3 evaluators', () => {
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    expect(evs).toHaveLength(3);
  });

  it('returns evaluators with correct names', () => {
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    const names = evs.map((e) => e.name);
    expect(names).toContain('intent-to-output-alignment');
    expect(names).toContain('implicit-feature-gap');
    expect(names).toContain('silent-hallucination');
  });

  it('all evaluators have evalVersion equal to ALIGNMENT_EVAL_VERSION', () => {
    expect(ALIGNMENT_EVAL_VERSION).toBe('2.0');
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

  it('pass case: maps score to observed with advisoryVerdict pass', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'well aligned' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.evaluator).toBe('intent-to-output-alignment');
    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('observed');
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('pass');
    expect(result.reason).toBe('well aligned');
    expect(result.evalVersion).toBe(ALIGNMENT_EVAL_VERSION);
  });

  it('partial case: maps partial to observed with advisoryVerdict partial', async () => {
    const ev = getEval(makeGocode({ score: 0.55, verdict: 'partial', reason: 'mostly aligned' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBeCloseTo(0.55);
    expect(result.verdict).toBe('observed');
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('partial');
  });

  it('fail case: maps fail to observed with advisoryVerdict fail', async () => {
    const ev = getEval(makeGocode({ score: 0.1, verdict: 'fail', reason: 'misaligned output' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBeCloseTo(0.1);
    expect(result.verdict).toBe('observed');
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('fail');
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

  it('result.details contains dimension, inputsUsed, advisoryVerdict, and transcriptErrors', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.details).toEqual({
      dimension: 'Intent Understanding & Alignment',
      inputsUsed: ['conversation', 'final_artifacts'],
      advisoryVerdict: 'pass',
      transcriptErrors: 0,
    });
  });

});

// ---------------------------------------------------------------------------
// implicit-feature-gap (numerical, score-mode)
// ---------------------------------------------------------------------------

describe('implicit-feature-gap (numerical, score-mode)', () => {
  function getEval(gocode: GocodeClient) {
    return createAlignmentLLMEvaluators(gocode).find(
      (e) => e.name === 'implicit-feature-gap',
    )!;
  }

  it('score=0.8 with verdict pass → verdict observed, advisoryVerdict pass', async () => {
    const ev = getEval(makeGocode({ score: 0.8, verdict: 'pass', reason: 'all features present' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.8);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('pass');
  });

  it('score=0.2 with verdict fail → verdict observed, advisoryVerdict fail', async () => {
    const ev = getEval(makeGocode({ score: 0.2, verdict: 'fail', reason: 'missing contact info' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.2);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('fail');
  });

  it('result.details contains dimension, inputsUsed, advisoryVerdict, and transcriptErrors', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.details).toEqual({
      dimension: 'Implicit Feature Completeness',
      inputsUsed: ['conversation', 'final_artifacts'],
      advisoryVerdict: 'pass',
      transcriptErrors: 0,
    });
  });

  it('unknown verdict forces score to 0 and verdict unknown', async () => {
    const ev = getEval(makeGocode({ score: 0.5, verdict: 'unknown', reason: 'unclear' }));
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
    const ev = getEval(makeFailingGocode('timeout'));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// silent-hallucination (numerical, score-mode)
// ---------------------------------------------------------------------------

describe('silent-hallucination (numerical, score-mode)', () => {
  function getEval(gocode: GocodeClient) {
    return createAlignmentLLMEvaluators(gocode).find(
      (e) => e.name === 'silent-hallucination',
    )!;
  }

  it('score=0.9 with verdict pass → verdict observed, advisoryVerdict pass', async () => {
    const ev = getEval(makeGocode({ score: 0.9, verdict: 'pass', reason: 'all claims backed' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.9);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('pass');
  });

  it('score=0.1 with verdict fail → verdict observed, advisoryVerdict fail', async () => {
    const ev = getEval(makeGocode({ score: 0.1, verdict: 'fail', reason: 'unverified claims' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.1);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('fail');
  });

  it('result.details contains dimension, inputsUsed, advisoryVerdict, and transcriptErrors', async () => {
    const ev = getEval(makeGocode({ score: 0.8, verdict: 'pass', reason: 'ok' }));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.details).toEqual({
      dimension: 'Consistency & Truthfulness',
      inputsUsed: ['conversation', 'tool_calls', 'final_artifacts'],
      advisoryVerdict: 'pass',
      transcriptErrors: 0,
    });
  });

  it('unknown verdict forces score to 0 and verdict unknown', async () => {
    const ev = getEval(makeGocode({ score: 0.5, verdict: 'unknown', reason: 'unclear' }));
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
    const ev = getEval(makeFailingGocode('timeout'));
    const result = await ev.evaluate(
      makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT,
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Score-mode regression configuration (integration seam)
// ---------------------------------------------------------------------------

describe('score-mode regression configuration', () => {
  it('all 3 evaluators have regressionMode: score', () => {
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    for (const ev of evs) {
      expect(ev.regressionMode).toBe('score');
    }
  });

  it('all 3 evaluators have lowerIsBetter: false', () => {
    const evs = createAlignmentLLMEvaluators(makeGocode({}));
    for (const ev of evs) {
      expect(ev.lowerIsBetter).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// mapScoreMode validation boundary tests
// ---------------------------------------------------------------------------

describe('mapScoreMode boundary tests (via implicit-feature-gap)', () => {
  function getEval(gocode: GocodeClient) {
    return createAlignmentLLMEvaluators(gocode).find(
      (e) => e.name === 'implicit-feature-gap',
    )!;
  }

  it('score=0.0 with non-unknown verdict → verdict observed, score 0', async () => {
    const ev = getEval(makeGocode({ score: 0.0, verdict: 'fail', reason: 'many gaps' }));
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.0);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('fail');
  });

  it('score=1.0 with verdict pass → verdict observed, score 1', async () => {
    const ev = getEval(makeGocode({ score: 1.0, verdict: 'pass', reason: 'all features present' }));
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(1.0);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('pass');
  });

  it('verdict=unknown → score 0, verdict unknown, advisoryVerdict unknown', async () => {
    const ev = getEval(makeGocode({ score: 0.5, verdict: 'unknown', reason: 'insufficient evidence' }));
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
    expect((result.details as Record<string, unknown>)?.advisoryVerdict).toBe('unknown');
  });

  it('score=0.0 with verdict fail is included in aggregation (not filtered as unknown)', async () => {
    const ev = getEval(makeGocode({ score: 0.0, verdict: 'fail', reason: 'worst case' }));
    const result = await ev.evaluate(makeTranscript(VALID_TURNS), makeScenario(), VALID_SNAPSHOT);
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(0.0);
  });
});
