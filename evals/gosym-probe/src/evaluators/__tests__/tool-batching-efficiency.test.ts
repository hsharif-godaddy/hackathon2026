import { describe, it, expect } from 'vitest';
import { ToolBatchingEfficiencyEvaluator } from '../tool-batching-efficiency.js';
import type { ToolCall } from '../../runner/transcript.js';
import {
  makeToolCall,
  makeAssistantTurn,
  makeUserTurn,
  makeTranscript,
  makeScenario,
} from './evaluator-test-helpers.js';

function successfulCall(id: string): ToolCall {
  return makeToolCall({ id, startTime: 100, endTime: 200 });
}

function failedCall(id: string): ToolCall {
  return makeToolCall({ id, startTime: 100, endTime: 200, error: 'failed' });
}

describe('ToolBatchingEfficiencyEvaluator — properties', () => {
  it('has correct name, regressionMode=score, lowerIsBetter=false', () => {
    const evaluator = new ToolBatchingEfficiencyEvaluator();
    expect(evaluator.name).toBe('tool-batching-efficiency');
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });
});

describe('ToolBatchingEfficiencyEvaluator — unknown paths', () => {
  const evaluator = new ToolBatchingEfficiencyEvaluator();

  it('returns unknown for empty transcript', async () => {
    const result = await evaluator.evaluate(makeTranscript([]), makeScenario());
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it('returns unknown when transcript has only user turns', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn(), makeUserTurn()]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it('returns unknown when all assistant turns have 0 tool calls', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn({ toolCalls: [] })]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it('returns unknown when only 1 successful call (cannot measure batching)', async () => {
    // calls=1 → denominator (calls-1)=0, undefined → unknown
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn({ toolCalls: [successfulCall('c1')] })]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it('returns unknown when all calls failed (0 successful calls)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({ toolCalls: [failedCall('f1'), failedCall('f2')] }),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.score).toBe(0);
  });
});

describe('ToolBatchingEfficiencyEvaluator — scoring: (calls - turns) / (calls - 1)', () => {
  const evaluator = new ToolBatchingEfficiencyEvaluator();

  it('scores 1.0 when all calls are in 1 turn', async () => {
    // calls=10, turns=1 → (10-1)/(10-1) = 1.0
    const calls = Array.from({ length: 10 }, (_, i) => successfulCall(`c${i}`));
    const result = await evaluator.evaluate(
      makeTranscript([makeAssistantTurn({ toolCalls: calls })]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(1.0);
  });

  it('scores 0.0 when each turn has exactly 1 call', async () => {
    // calls=8, turns=8 → (8-8)/(8-1) = 0/7 = 0.0
    const turns = Array.from({ length: 8 }, (_, i) =>
      makeAssistantTurn({ toolCalls: [successfulCall(`c${i}`)] }),
    );
    const result = await evaluator.evaluate(makeTranscript(turns), makeScenario());
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(0);
  });

  it('scores 10/11 for 12 calls across 2 turns', async () => {
    // calls=12, turns=2 → (12-2)/(12-1) = 10/11
    const turn1 = makeAssistantTurn({
      toolCalls: Array.from({ length: 6 }, (_, i) => successfulCall(`a${i}`)),
    });
    const turn2 = makeAssistantTurn({
      toolCalls: Array.from({ length: 6 }, (_, i) => successfulCall(`b${i}`)),
    });
    const result = await evaluator.evaluate(
      makeTranscript([turn1, turn2]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(10 / 11, 5);
  });

  it('scores 8/11 for 12 calls across 4 turns', async () => {
    // calls=12, turns=4 → (12-4)/(12-1) = 8/11
    const turns = Array.from({ length: 4 }, (_, i) =>
      makeAssistantTurn({
        toolCalls: Array.from({ length: 3 }, (_, j) => successfulCall(`${i}-${j}`)),
      }),
    );
    const result = await evaluator.evaluate(makeTranscript(turns), makeScenario());
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(8 / 11, 5);
  });

  it('scores 1.0 for the minimum measurable case: 2 calls in 1 turn', async () => {
    // calls=2, turns=1 → (2-1)/(2-1) = 1/1 = 1.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({ toolCalls: [successfulCall('a'), successfulCall('b')] }),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(1.0);
  });

  it('scores 0.0 for 2 calls each in their own turn', async () => {
    // calls=2, turns=2 → (2-2)/(2-1) = 0/1 = 0.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({ toolCalls: [successfulCall('a')] }),
        makeAssistantTurn({ toolCalls: [successfulCall('b')] }),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(0);
  });
});

describe('ToolBatchingEfficiencyEvaluator — failed calls excluded', () => {
  const evaluator = new ToolBatchingEfficiencyEvaluator();

  it('excludes turn with only failed calls: t1=[ok], t2=[fail,fail], t3=[ok]', async () => {
    // t2 has no successful calls → not a productive turn
    // calls=2, turns=2 → (2-2)/(2-1) = 0.0
    const t1 = makeAssistantTurn({ toolCalls: [successfulCall('a')] });
    const t2 = makeAssistantTurn({ toolCalls: [failedCall('f1'), failedCall('f2')] });
    const t3 = makeAssistantTurn({ toolCalls: [successfulCall('b')] });
    const result = await evaluator.evaluate(makeTranscript([t1, t2, t3]), makeScenario());
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(0);
  });

  it('excludes failed calls: turn1 has 4 successful + 2 failed, turn2 has 4 successful', async () => {
    // successful calls=8, turns=2 → (8-2)/(8-1) = 6/7
    const turn1 = makeAssistantTurn({
      toolCalls: [
        ...Array.from({ length: 4 }, (_, i) => successfulCall(`a${i}`)),
        failedCall('f1'),
        failedCall('f2'),
      ],
    });
    const turn2 = makeAssistantTurn({
      toolCalls: Array.from({ length: 4 }, (_, i) => successfulCall(`b${i}`)),
    });
    const result = await evaluator.evaluate(
      makeTranscript([turn1, turn2]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBeCloseTo(6 / 7, 5);
  });
});

describe('ToolBatchingEfficiencyEvaluator — mixed turns', () => {
  const evaluator = new ToolBatchingEfficiencyEvaluator();

  it('ignores user turns and assistant turns without tool calls', async () => {
    // Only 1 productive turn with 8 calls → calls=8, turns=1 → (8-1)/(8-1) = 1.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeUserTurn(),
        makeAssistantTurn({ toolCalls: [] }),
        makeAssistantTurn({
          toolCalls: Array.from({ length: 8 }, (_, i) => successfulCall(`c${i}`)),
        }),
        makeUserTurn(),
        makeAssistantTurn({ toolCalls: [] }),
      ]),
      makeScenario(),
    );
    expect(result.verdict).toBe('observed');
    expect(result.score).toBe(1.0);
  });
});

describe('ToolBatchingEfficiencyEvaluator — EvalResult shape', () => {
  it('returns EvalResult consumable by TrialAggregator in score-mode', async () => {
    const evaluator = new ToolBatchingEfficiencyEvaluator();
    // calls=4, turns=1 → (4-1)/(4-1) = 1.0
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn({
          toolCalls: Array.from({ length: 4 }, (_, i) => successfulCall(`c${i}`)),
        }),
      ]),
      makeScenario(),
    );
    expect(result.evaluator).toBe('tool-batching-efficiency');
    expect(typeof result.score).toBe('number');
    expect(result.verdict).toBe('observed');
    expect(typeof result.reason).toBe('string');
    expect(result.details).toHaveProperty('totalSuccessfulCalls');
    expect(result.details).toHaveProperty('productiveTurns');
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(false);
  });
});
