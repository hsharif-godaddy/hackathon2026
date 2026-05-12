import { describe, it, expect } from 'vitest';
import { TurnDurationEvaluator } from '../turn-duration.js';
import {
  makeAssistantTurn as makeAssistantTurnBase,
  makeUserTurn,
  makeTranscript,
  makeScenario,
} from './evaluator-test-helpers.js';

function makeAssistantTurn(durationMs?: number) {
  return makeAssistantTurnBase({ durationMs });
}

describe('TurnDurationEvaluator — properties', () => {
  it('has correct name, regressionMode=score, lowerIsBetter=true', () => {
    const evaluator = new TurnDurationEvaluator();
    expect(evaluator.name).toBe('turn-duration');
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });
});

describe('TurnDurationEvaluator — error paths (unknown)', () => {
  const evaluator = new TurnDurationEvaluator();

  it("returns 'unknown' when no assistant turns have durationMs", async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it("returns 'unknown' when transcript has only user turns", async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it("returns 'unknown' when transcript is empty", async () => {
    const result = await evaluator.evaluate(
      makeTranscript([]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });
});

describe('TurnDurationEvaluator — score-mode observed verdict', () => {
  const evaluator = new TurnDurationEvaluator();

  it('scores raw ms for single turn with durationMs 0', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(0)]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(0);
  });

  it('scores raw totalDurationMs for a single 5000ms turn', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(5000)]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(5000);
  });

  it('scores sum of durationMs across two turns (3000+7000=10000)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3000), makeAssistantTurn(7000)]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(10000);
  });

  it('only sums assistant turns; user turns are ignored', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(2000), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(2000);
  });
});

describe('TurnDurationEvaluator — details', () => {
  const evaluator = new TurnDurationEvaluator();

  it('details.totalDurationMs equals score for single turn', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3000)]),
      makeScenario(),
    );
    expect(result.details?.totalDurationMs).toBe(3000);
  });

  it('details.averageDurationMs equals totalDurationMs for single turn', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(5000)]),
      makeScenario(),
    );
    expect(result.details?.averageDurationMs).toBe(5000);
  });

  it('details.averageDurationMs is mean of defined turns (3000+7000 / 2 = 5000)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(3000), makeAssistantTurn(7000)]),
      makeScenario(),
    );
    expect(result.details?.averageDurationMs).toBe(5000);
  });

  it('details.perTurnMs contains values in input order', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn(1000), makeAssistantTurn(2000), makeAssistantTurn(3000)]),
      makeScenario(),
    );
    expect(result.details?.perTurnMs).toEqual([1000, 2000, 3000]);
  });
});

describe('TurnDurationEvaluator — edge cases (mixed defined/undefined)', () => {
  const evaluator = new TurnDurationEvaluator();

  it('sums only defined durationMs values, skips undefined turns', async () => {
    // 2 defined (1000+2000=3000), 1 undefined
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn(1000),
        makeAssistantTurn(undefined),
        makeAssistantTurn(2000),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(3000);
  });

  it('averageDurationMs uses only defined turns as denominator', async () => {
    // 2 defined values (1000+2000=3000), avg = 3000/2 = 1500
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn(1000),
        makeAssistantTurn(undefined),
        makeAssistantTurn(2000),
      ]),
      makeScenario(),
    );
    expect(result.details?.averageDurationMs).toBe(1500);
  });

  it('perTurnMs contains only defined durationMs values in order', async () => {
    // turns: 1000, undefined, 2000 → perTurnMs: [1000, 2000]
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn(1000),
        makeAssistantTurn(undefined),
        makeAssistantTurn(2000),
      ]),
      makeScenario(),
    );
    expect(result.details?.perTurnMs).toEqual([1000, 2000]);
  });

  it('returns unknown when all assistant turns have undefined durationMs', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn(undefined),
        makeAssistantTurn(undefined),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
  });
});
