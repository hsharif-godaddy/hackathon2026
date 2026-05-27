import type { Turn, ToolCall } from '../../runner/transcript.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { TrialResult, ScenarioResult } from '../../runner/types.js';

/**
 * Builds a minimal Turn for use in reporter tests.
 * Uses absolute timestamps — callers requiring offset-based timestamps
 * (e.g. conversation-renderer tests) should compute the absolute value
 * at the call site.
 */
export function makeTurn(
  role: 'user' | 'assistant',
  content: string,
  timestamp: number,
): Turn {
  return { role, content, toolCalls: [], timestamp };
}

/**
 * Builds a Turn with only a timestamp — for use in tests that only
 * care about timing (e.g. computeTimingStats).
 */
export function makeMinimalTurn(timestamp: number): Turn {
  return { role: 'user', content: '', toolCalls: [], timestamp };
}

export function makeEvalResult(overrides?: Partial<EvalResult>): EvalResult {
  return {
    evaluator: 'test-evaluator',
    score: 1.0,
    verdict: 'pass',
    reason: 'Test passed',
    ...overrides,
  };
}

export function makeTrial(overrides?: Partial<TrialResult>): TrialResult {
  return {
    trialIndex: 0,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex: 0,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
    evalResults: [],
    ...overrides,
  };
}

export function makeScenarioResult(
  overrides?: Partial<ScenarioResult>,
): ScenarioResult {
  return {
    scenarioName: 'test-scenario',
    stabilityLevel: 'low',
    trials: [],
    aggregated: {},
    ...overrides,
  };
}

export function makeToolCall(hasError: boolean): ToolCall {
  return {
    id: 'tc-1',
    name: 'some-tool',
    startTime: 0,
    endTime: 0,
    ...(hasError ? { error: 'Tool failed' } : {}),
  };
}

export function makeTurnWithToolCalls(toolCalls: ToolCall[]): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls,
    timestamp: 0,
  };
}
