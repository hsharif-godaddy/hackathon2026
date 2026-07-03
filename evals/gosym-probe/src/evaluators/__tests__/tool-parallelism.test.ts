import { describe, it, expect } from 'vitest';
import { ToolParallelismEvaluator } from '../tool-parallelism.js';
import type { ToolCall } from '../../runner/transcript.js';
import {
  makeToolCall as makeToolCallBase,
  makeAssistantTurn as makeAssistantTurnBase,
  makeUserTurn,
  makeTranscript,
  makeScenario,
} from './evaluator-test-helpers.js';

function makeToolCall(overrides: Partial<ToolCall> & { startTime: number; endTime: number }): ToolCall {
  return makeToolCallBase(overrides);
}

function makeAssistantTurn(toolCalls: ToolCall[]) {
  return makeAssistantTurnBase({ toolCalls });
}

describe('ToolParallelismEvaluator — properties', () => {
  it('has correct name, comparisonMode=score, lowerIsBetter=false', () => {
    const evaluator = new ToolParallelismEvaluator();
    expect(evaluator.name).toBe('tool-parallelism');
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });
});

describe('ToolParallelismEvaluator — error paths (unknown)', () => {
  const evaluator = new ToolParallelismEvaluator();

  it('returns unknown for empty transcript', async () => {
    const result = await evaluator.evaluate(makeTranscript([]), makeScenario());
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('returns unknown when transcript has only user turns', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn(), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('returns unknown when all assistant turns have 0 tool calls', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn([])]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('returns unknown when all assistant turns have exactly 1 tool call (no pairs)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([makeToolCall({ id: 'a', startTime: 100, endTime: 200 })]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('returns unknown when all tool calls have invalid timing (endTime <= startTime)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 200, endTime: 100 }),
          makeToolCall({ id: 'b', startTime: 300, endTime: 300 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('returns unknown when all tool calls have startTime=0 and endTime=0', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 0, endTime: 0 }),
          makeToolCall({ id: 'b', startTime: 0, endTime: 0 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });
});

describe('ToolParallelismEvaluator — validation boundary (invalid timing excluded)', () => {
  const evaluator = new ToolParallelismEvaluator();

  it('excludes tool calls with NaN startTime', async () => {
    // Only one valid call after exclusion → no pairs → unknown
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: NaN, endTime: 200 }),
          makeToolCall({ id: 'b', startTime: 100, endTime: 300 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('excludes tool calls with NaN endTime', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: NaN }),
          makeToolCall({ id: 'b', startTime: 200, endTime: 400 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('excludes tool calls with Infinity startTime', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: Infinity, endTime: 200 }),
          makeToolCall({ id: 'b', startTime: 100, endTime: 300 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('excludes tool calls with Infinity endTime', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: Infinity }),
          makeToolCall({ id: 'b', startTime: 200, endTime: 400 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('excludes tool calls where endTime === startTime', async () => {
    // Both invalid → unknown
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 100 }),
          makeToolCall({ id: 'b', startTime: 200, endTime: 200 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('keeps valid calls alongside invalid ones; uses only valid for scoring', async () => {
    // 3 calls: a=valid, b=valid, c=invalid(NaN endTime)
    // After filtering: 2 valid → score based on those 2
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 300 }),
          makeToolCall({ id: 'b', startTime: 150, endTime: 400 }),
          makeToolCall({ id: 'c', startTime: 200, endTime: NaN }),
        ]),
      ]),
      makeScenario(),
    );
    // a and b overlap (b starts at 150 < a ends at 300): 1 overlapping pair out of 1 possible
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });
});

describe('ToolParallelismEvaluator — edge cases (scoring)', () => {
  const evaluator = new ToolParallelismEvaluator();

  it('scores 1.0 for 2 fully overlapping calls', async () => {
    // a: 100–400, b: 150–500 → b starts before a ends → overlap
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 400 }),
          makeToolCall({ id: 'b', startTime: 150, endTime: 500 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });

  it('scores 0.0 for 2 fully sequential calls', async () => {
    // a: 100–200, b: 300–400 → b starts after a ends → no overlap
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 200 }),
          makeToolCall({ id: 'b', startTime: 300, endTime: 400 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(0.0);
  });

  it('scores 1.0 for 2 partially overlapping calls', async () => {
    // a: 100–250, b: 200–350 → b starts at 200 < a ends at 250 → overlap
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 250 }),
          makeToolCall({ id: 'b', startTime: 200, endTime: 350 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });

  it('scores 1.0 for 3 calls all overlapping', async () => {
    // a: 100–500, b: 150–600, c: 200–700
    // Pairs: (a,b) overlap, (a,c) overlap, (b,c) overlap → 3/3 = 1.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 500 }),
          makeToolCall({ id: 'b', startTime: 150, endTime: 600 }),
          makeToolCall({ id: 'c', startTime: 200, endTime: 700 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });

  it('scores 1/3 for 3 calls where only 1 pair overlaps', async () => {
    // a: 100–350, b: 300–500, c: 600–800
    // Sorted by startTime: a, b, c
    // (a,b): b starts at 300 < a ends at 350 → overlap
    // (a,c): c starts at 600 > a ends at 350 → no overlap
    // (b,c): c starts at 600 > b ends at 500 → no overlap
    // → 1 overlapping pair out of 3 possible
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 350 }),
          makeToolCall({ id: 'b', startTime: 300, endTime: 500 }),
          makeToolCall({ id: 'c', startTime: 600, endTime: 800 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1 / 3);
  });

  it('skips turns where all tool calls have invalid timing', async () => {
    // turn1: 2 invalid calls → skipped
    // turn2: 2 valid, fully overlapping → score 1.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 0, endTime: 0 }),
          makeToolCall({ id: 'b', startTime: 0, endTime: 0 }),
        ]),
        makeAssistantTurn([
          makeToolCall({ id: 'c', startTime: 100, endTime: 400 }),
          makeToolCall({ id: 'd', startTime: 150, endTime: 500 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });
});

describe('ToolParallelismEvaluator — multiple turns weighted average', () => {
  const evaluator = new ToolParallelismEvaluator();

  it('computes weighted mean across two turns with equal tool counts', async () => {
    // turn1: 2 calls, fully sequential → ratio 0.0, weight 2
    // turn2: 2 calls, fully overlapping → ratio 1.0, weight 2
    // weighted mean: (0.0*2 + 1.0*2) / (1*2 + 1*2) = 2/4 = 0.5
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 200 }),
          makeToolCall({ id: 'b', startTime: 300, endTime: 400 }),
        ]),
        makeAssistantTurn([
          makeToolCall({ id: 'c', startTime: 100, endTime: 400 }),
          makeToolCall({ id: 'd', startTime: 150, endTime: 500 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(0.5);
  });

  it('weights turns by tool call count (heavier turns dominate)', async () => {
    // Weighted formula: score = sum(ratio_i * n_i) / sum(n_i) where n_i = toolCallCount
    // turn1: ratio=0.0, n=2 → 0.0*2 = 0
    // turn2: ratio=1.0, n=4 → 1.0*4 = 4
    // total n = 2 + 4 = 6
    // weighted mean = (0 + 4) / 6 = 4/6 ≈ 0.667
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 200 }),
          makeToolCall({ id: 'b', startTime: 300, endTime: 400 }),
        ]),
        makeAssistantTurn([
          makeToolCall({ id: 'c', startTime: 100, endTime: 500 }),
          makeToolCall({ id: 'd', startTime: 150, endTime: 500 }),
          makeToolCall({ id: 'e', startTime: 200, endTime: 500 }),
          makeToolCall({ id: 'f', startTime: 250, endTime: 500 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(4 / 6);
  });

  it('skips single-call turns in weighted average', async () => {
    // turn1: 1 call → skipped
    // turn2: 2 calls, overlapping → ratio 1.0, weight 2
    // weighted mean: 1.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 200 }),
        ]),
        makeAssistantTurn([
          makeToolCall({ id: 'b', startTime: 100, endTime: 400 }),
          makeToolCall({ id: 'c', startTime: 150, endTime: 500 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });

  it('ignores user turns when computing score', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeUserTurn(),
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 400 }),
          makeToolCall({ id: 'b', startTime: 150, endTime: 500 }),
        ]),
        makeUserTurn(),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('directional');
    expect(result.score).toBeCloseTo(1.0);
  });
});

describe('ToolParallelismEvaluator — integration seam (EvalResult shape)', () => {
  it('returns EvalResult consumable by TrialAggregator in score-mode', async () => {
    const evaluator = new ToolParallelismEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'a', startTime: 100, endTime: 400 }),
          makeToolCall({ id: 'b', startTime: 150, endTime: 500 }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.evaluator).toBe('tool-parallelism');
    expect(typeof result.score).toBe('number');
    expect(result.verdict).toBe('directional');
    expect(typeof result.reason).toBe('string');
    // score-mode with lowerIsBetter=false: higher ratio is better
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });
});
