import type { Transcript, Turn, ToolCall } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

export const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

export function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-1',
    name: 'tool',
    startTime: 0,
    endTime: 0,
    ...overrides,
  };
}

export function makeAssistantTurn(
  overrides: Partial<Turn> & { toolCalls?: ToolCall[] } = {},
): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: 0,
    ...overrides,
  };
}

export function makeUserTurn(): Turn {
  return { role: 'user', content: '', toolCalls: [], timestamp: 0 };
}

export function makeTranscript(turns: Turn[]): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns,
    snapshots: [],
    errors: [],
    captureErrors: [],
  };
}

/**
 * Overrides-style transcript factory for tests that patch arbitrary
 * fields (e.g. loadedSkills, capturedSite) rather than only supplying
 * turns. Sibling to makeTranscript(turns) above; both build the same
 * baseline shape.
 */
export function makeTranscriptWith(
  overrides: Partial<Transcript> = {},
): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    captureErrors: [],
    ...overrides,
  };
}

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    ...overrides,
  };
}
