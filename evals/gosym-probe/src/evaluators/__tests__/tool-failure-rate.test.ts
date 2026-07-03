import { describe, it, expect } from 'vitest';
import { ToolFailureRateEvaluator } from '../tool-failure-rate.js';
import type { ToolCall } from '../../runner/transcript.js';
import {
  makeToolCall as makeToolCallBase,
  makeAssistantTurn as makeAssistantTurnBase,
  makeUserTurn,
  makeTranscript,
  makeScenario,
} from './evaluator-test-helpers.js';

function makeToolCall(overrides: Partial<ToolCall> & { id: string; name: string }): ToolCall {
  return makeToolCallBase(overrides);
}

function makeAssistantTurn(toolCalls: ToolCall[]) {
  return makeAssistantTurnBase({ toolCalls });
}

describe('ToolFailureRateEvaluator — properties', () => {
  it('has name tool-failure-rate', () => {
    const evaluator = new ToolFailureRateEvaluator();
    expect(evaluator.name).toBe('tool-failure-rate');
  });


  it('has comparisonMode score', () => {
    const evaluator = new ToolFailureRateEvaluator();
    expect(evaluator.comparisonMode).toBe('score');
  });

  it('has lowerIsBetter true', () => {
    const evaluator = new ToolFailureRateEvaluator();
    expect(evaluator.lowerIsBetter).toBe(true);
  });
});

describe('ToolFailureRateEvaluator — edge case: zero tool calls', () => {
  it('returns score 0 and verdict unknown when transcript has no turns with toolCalls', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(makeTranscript([]), makeScenario());
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('incomplete');
  });

  it('returns score 0 and verdict unknown when turns have empty toolCalls arrays', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([makeUserTurn(), makeAssistantTurn([])]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('incomplete');
  });
});

describe('ToolFailureRateEvaluator — boundary: error string treatment', () => {
  it('treats error: "" as success (non-fatal warning convention)', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'read_file', error: '' }),
          makeToolCall({ id: 'tc-2', name: 'edit_file', error: '' }),
          makeToolCall({ id: 'tc-3', name: 'run_command' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('directional');
  });
});

describe('ToolFailureRateEvaluator — edge case: all tool calls succeed', () => {
  it('returns score 0 and verdict observed when no tool calls have errors', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'read_file' }),
          makeToolCall({ id: 'tc-2', name: 'edit_file' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('directional');
  });
});

describe('ToolFailureRateEvaluator — boundary: single failure', () => {
  it('returns score 1 for one tool call with error', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'edit_file', error: 'File not found' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('directional');
  });
});

describe('ToolFailureRateEvaluator — multiple errors across turns', () => {
  it('returns score 1 for 2 turns each with 1 failed tool call', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'read_file', error: 'Permission denied' }),
        ]),
        makeAssistantTurn([
          makeToolCall({ id: 'tc-2', name: 'edit_file', error: 'File locked' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('directional');
  });
});

describe('ToolFailureRateEvaluator — mixed success and failure', () => {
  it('scores failure rate as ratio of failed to total calls', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'read_file' }),
          makeToolCall({ id: 'tc-2', name: 'edit_file', error: 'File not found' }),
          makeToolCall({ id: 'tc-3', name: 'run_command' }),
          makeToolCall({ id: 'tc-4', name: 'run_command', error: 'Command failed' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('directional');
  });
});

describe('ToolFailureRateEvaluator — details shape', () => {
  it('details.failedCount matches score', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'edit_file', error: 'File not found' }),
          makeToolCall({ id: 'tc-2', name: 'read_file' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.details?.failedCount).toBe(1);
  });

  it('details.totalCalls is correct total including successes', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'edit_file', error: 'File not found' }),
          makeToolCall({ id: 'tc-2', name: 'read_file' }),
          makeToolCall({ id: 'tc-3', name: 'run_command' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.details?.totalCalls).toBe(3);
  });

  it('details.failedTools is sorted and deduplicated array of errored tool names', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'edit_file', error: 'First failure' }),
          makeToolCall({ id: 'tc-2', name: 'edit_file', error: 'Second failure' }),
          makeToolCall({ id: 'tc-3', name: 'read_file', error: 'Also failed' }),
          makeToolCall({ id: 'tc-4', name: 'run_command' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.details?.failedTools).toEqual(['edit_file', 'read_file']);
  });

  it('details.failedTools is empty array when there are no failures', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'read_file' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.details?.failedTools).toEqual([]);
  });

  it('details.totalCalls is 0 when transcript is empty', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(makeTranscript([]), makeScenario());
    expect(result.details?.totalCalls).toBe(0);
    expect(result.details?.failedCount).toBe(0);
    expect(result.details?.failedTools).toEqual([]);
  });
});

describe('ToolFailureRateEvaluator — integration seam (EvalResult shape)', () => {
  it('returns EvalResult with correct evaluator name and required fields', async () => {
    const evaluator = new ToolFailureRateEvaluator();
    const result = await evaluator.evaluate(
      makeTranscript([
        makeAssistantTurn([
          makeToolCall({ id: 'tc-1', name: 'edit_file', error: 'Error' }),
        ]),
      ]),
      makeScenario(),
    );
    expect(result.evaluator).toBe('tool-failure-rate');
    expect(typeof result.score).toBe('number');
    expect(result.verdict).toBe('directional');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
