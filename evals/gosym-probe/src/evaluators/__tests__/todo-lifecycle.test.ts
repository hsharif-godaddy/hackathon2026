import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TodoLifecycleEvaluator,
  serializeTraceForTodo,
} from '../todo-lifecycle.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { Transcript, Turn } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
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

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    ...overrides,
  };
}

function makeToolCall(
  name: string,
  input?: unknown,
  output?: unknown,
): Turn['toolCalls'][number] {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    name,
    input,
    output,
    startTime: Date.now(),
    endTime: Date.now() + 100,
  };
}

describe('TodoLifecycleEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: TodoLifecycleEvaluator;

  beforeEach(() => {
    mockGocode = { complete: vi.fn() };
    evaluator = new TodoLifecycleEvaluator(
      mockGocode as unknown as GocodeClient,
    );
  });

  it('returns unknown without calling GoCode when no todoList calls exist', async () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [makeToolCall('askQuestion', { questions: [] })],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).toBe('incomplete');
    expect(result.reason).toContain('No todoList create_list');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('returns unknown when todoList exists but no create_list operation', async () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', { operation: 'mark_done', itemIds: ['1'] }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).toBe('incomplete');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('calls GoCode when create_list is present', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ questions: [{ id: 'A1', reasoning: 'Yes it was called', answer: 'Yes', result: 'PASS' }], overall: 'pass' }),
    );
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Homepage' }],
            }),
          ],
        }),
      ],
    });
    await evaluator.evaluate(transcript, makeScenario());
    expect(mockGocode.complete).toHaveBeenCalledTimes(1);
  });

  it('parses all-PASS response as pass with score 1.0', async () => {
    const response = JSON.stringify({
      questions: [
        { id: 'A1', reasoning: 'create_list was called in turn 1', answer: 'Yes', result: 'PASS' },
        { id: 'A2', reasoning: '3 items in the list', answer: '3', result: 'PASS' },
        { id: 'A3', reasoning: '3 IDs passed to mark_done', answer: '3', result: 'PASS' },
        { id: 'A4', reasoning: 'All item IDs covered', answer: 'Yes', result: 'PASS' },
        { id: 'A5', reasoning: 'mark_done was called', answer: 'Yes', result: 'PASS' },
        { id: 'B1', reasoning: 'mark_done present in final turn', answer: 'Yes', result: 'PASS' },
        { id: 'B2', reasoning: 'Index 5', answer: '5', result: 'PASS' },
        { id: 'B3', reasoning: 'Index 7', answer: '7', result: 'PASS' },
        { id: 'B4', reasoning: 'mark_done at 5, askQuestion at 7', answer: 'Yes', result: 'PASS' },
        { id: 'B5', reasoning: 'No such turn found', answer: 'No', result: 'PASS' },
        { id: 'C1', reasoning: 'askQuestion called post-build', answer: 'Yes', result: 'PASS' },
        { id: 'C2', reasoning: 'setProjectName called earlier', answer: 'Yes', result: 'PASS' },
        { id: 'C3', reasoning: 'Question is about design feedback', answer: 'No', result: 'PASS' },
        { id: 'C4', reasoning: 'Asks about design preferences', answer: 'Design feedback', result: 'PASS' },
        { id: 'C5', reasoning: 'All suggestions are modifications', answer: 'Yes', result: 'PASS' },
      ],
      overall: 'pass',
    });
    mockGocode.complete.mockResolvedValue(response);

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toContain('15 checklist questions passed');
  });

  it('parses mixed response as fail with proportional score', async () => {
    const response = JSON.stringify({
      questions: [
        { id: 'A1', reasoning: 'create_list present', answer: 'Yes', result: 'PASS' },
        { id: 'A2', reasoning: '3 items', answer: '3', result: 'PASS' },
        { id: 'A3', reasoning: 'No mark_done calls found', answer: '0', result: 'FLAG' },
        { id: 'A4', reasoning: 'No items marked', answer: 'No', result: 'FLAG' },
        { id: 'A5', reasoning: 'Never called', answer: 'No', result: 'FLAG' },
        { id: 'B1', reasoning: 'Not present', answer: 'No', result: 'FLAG' },
        { id: 'B2', reasoning: 'Not in final turn', answer: 'absent', result: 'FLAG' },
        { id: 'B3', reasoning: 'askQuestion at index 2', answer: '2', result: 'PASS' },
        { id: 'B4', reasoning: 'mark_done never called', answer: 'Not called', result: 'FLAG' },
        { id: 'B5', reasoning: 'askQuestion fired with in-progress item still open', answer: 'Yes', result: 'FLAG' },
        { id: 'C1', reasoning: 'askQuestion called', answer: 'Yes', result: 'PASS' },
        { id: 'C2', reasoning: 'setProjectName called earlier', answer: 'Yes', result: 'PASS' },
        { id: 'C3', reasoning: 'No name question', answer: 'No', result: 'PASS' },
        { id: 'C4', reasoning: 'Design feedback topic', answer: 'Design feedback', result: 'PASS' },
        { id: 'C5', reasoning: 'All concrete modifications', answer: 'Yes', result: 'PASS' },
      ],
      overall: 'flag',
    });
    mockGocode.complete.mockResolvedValue(response);

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.score).toBeCloseTo(8 / 15);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toContain('7/15 questions flagged');
    expect((result.details as Record<string, unknown>).flags).toEqual([
      'A3', 'A4', 'A5', 'B1', 'B2', 'B4', 'B5',
    ]);
    expect((result.details as Record<string, unknown>).checklist).toHaveLength(15);
  });

  it('returns unknown on unparseable LLM response with raw output in details', async () => {
    mockGocode.complete.mockResolvedValue('I cannot analyze this trace.');

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).toBe('incomplete');
    expect(result.reason).toContain('No JSON object found');
    expect(result.evaluatorFailed).toBe(true);
    expect(result.details).toEqual({
      rawResponse: 'I cannot analyze this trace.',
    });
  });

  it('parses JSON wrapped in markdown fences', async () => {
    const json = JSON.stringify({
      questions: [{ id: 'A1', reasoning: 'Called', answer: 'Yes', result: 'PASS' }],
      overall: 'pass',
    });
    mockGocode.complete.mockResolvedValue(`\`\`\`json\n${json}\n\`\`\``);

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).not.toBe('incomplete');
    expect(result.evaluatorFailed).toBeUndefined();
  });

  it('parses JSON preceded by prose explanation', async () => {
    const json = JSON.stringify({
      questions: [{ id: 'A1', reasoning: 'Called', answer: 'Yes', result: 'PASS' }],
      overall: 'pass',
    });
    mockGocode.complete.mockResolvedValue(
      `Here is my analysis of the trace:\n\n${json}`,
    );

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).not.toBe('incomplete');
    expect(result.evaluatorFailed).toBeUndefined();
  });

  it('parses JSON wrapped in fences with prefix prose', async () => {
    const json = JSON.stringify({
      questions: [{ id: 'A1', reasoning: 'Called', answer: 'Yes', result: 'PASS' }],
      overall: 'pass',
    });
    mockGocode.complete.mockResolvedValue(
      `I'll analyze the trace now.\n\n\`\`\`json\n${json}\n\`\`\`\n\nThat concludes my analysis.`,
    );

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).not.toBe('incomplete');
    expect(result.evaluatorFailed).toBeUndefined();
  });

  it('includes current-milestone B5 guidance in prompt sent to GoCode', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ questions: [{ id: 'A1', reasoning: 'Called', answer: 'Yes', result: 'PASS' }], overall: 'pass' }),
    );

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Homepage' }],
            }),
          ],
        }),
      ],
    });
    await evaluator.evaluate(transcript, makeScenario());

    const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('current milestone');
    expect(prompt).toContain('deferred roadmap');
    expect(prompt).toContain('inProgress');
  });

  it('includes serialized trace in prompt sent to GoCode', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ questions: [{ id: 'A1', reasoning: 'Called', answer: 'Yes', result: 'PASS' }], overall: 'pass' }),
    );

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          role: 'user',
          content: 'Build me a landing page',
        }),
        makeTurn({
          role: 'assistant',
          toolCalls: [
            makeToolCall(
              'todoList',
              {
                operation: 'create_list',
                listName: 'Homepage',
                items: [{ id: 'itm_1', title: 'Hero section' }],
              },
              { success: true },
            ),
          ],
        }),
      ],
    });
    await evaluator.evaluate(transcript, makeScenario());

    const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Build me a landing page');
    expect(prompt).toContain('todoList');
    expect(prompt).toContain('create_list');
    expect(prompt).toContain('itm_1');
  });

  it('infers flag verdict when overall field is missing', async () => {
    const response = JSON.stringify({
      questions: [
        { id: 'A1', reasoning: 'Present', answer: 'Yes', result: 'PASS' },
        { id: 'A2', reasoning: '2 items', answer: '2', result: 'PASS' },
        { id: 'A3', reasoning: 'None marked', answer: '0', result: 'FLAG' },
      ],
    });
    mockGocode.complete.mockResolvedValue(response);

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.verdict).toBe('fail');
  });

  it('treats missing questions as failures and divides score by total expected (15)', async () => {
    const response = JSON.stringify({
      questions: [
        { id: 'A1', reasoning: 'Called', answer: 'Yes', result: 'PASS' },
        { id: 'A2', reasoning: '3 items', answer: '3', result: 'PASS' },
        { id: 'A3', reasoning: '3 marked', answer: '3', result: 'PASS' },
        { id: 'A4', reasoning: 'All covered', answer: 'Yes', result: 'PASS' },
        { id: 'A5', reasoning: 'Called', answer: 'Yes', result: 'PASS' },
        { id: 'B1', reasoning: 'Present', answer: 'Yes', result: 'PASS' },
        { id: 'B2', reasoning: 'Index 5', answer: '5', result: 'PASS' },
        { id: 'B3', reasoning: 'Index 7', answer: '7', result: 'PASS' },
        { id: 'B4', reasoning: 'Yes before', answer: 'Yes', result: 'PASS' },
        { id: 'B5', reasoning: 'No', answer: 'No', result: 'PASS' },
        { id: 'C1', reasoning: 'Called', answer: 'Yes', result: 'PASS' },
        { id: 'C2', reasoning: 'Called', answer: 'Yes', result: 'PASS' },
        { id: 'C3', reasoning: 'No', answer: 'No', result: 'PASS' },
        { id: 'C4', reasoning: 'Design feedback', answer: 'Design feedback', result: 'PASS' },
      ],
      overall: 'pass',
    });
    mockGocode.complete.mockResolvedValue(response);

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.score).toBeCloseTo(14 / 15);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toContain('C5(missing)');
    const details = result.details as Record<string, unknown>;
    expect(details.missingIds).toEqual(['C5']);
    expect(details.totalExpected).toBe(15);
  });

  it('scores 0 passes / 15 when only 2 questions returned and both FLAG', async () => {
    const response = JSON.stringify({
      questions: [
        { id: 'A1', reasoning: 'Not called', answer: 'No', result: 'FLAG' },
        { id: 'A5', reasoning: 'Never', answer: 'No', result: 'FLAG' },
      ],
      overall: 'flag',
    });
    mockGocode.complete.mockResolvedValue(response);

    const transcript = makeTranscript({
      turns: [
        makeTurn({
          toolCalls: [
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Build page' }],
            }),
          ],
        }),
      ],
    });
    const result = await evaluator.evaluate(transcript, makeScenario());
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    const details = result.details as Record<string, unknown>;
    expect((details.missingIds as string[]).length).toBe(13);
    expect(details.flags).toEqual(['A1', 'A5']);
  });

  it('reports evaluator name correctly', () => {
    expect(evaluator.name).toBe('todo-lifecycle');
  });

  it('is not deterministic', () => {
    expect(evaluator.deterministic).toBe(false);
  });
});

describe('serializeTraceForTodo', () => {
  it('includes only relevant tool calls', () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          role: 'assistant',
          toolCalls: [
            makeToolCall('str_replace_based_edit_tool', { file: 'index.html' }),
            makeToolCall('todoList', { operation: 'create_list', items: [] }),
            makeToolCall('readFile', { path: '/app/package.json' }),
            makeToolCall('askQuestion', { questions: [{ question: 'How?' }] }),
          ],
        }),
      ],
    });
    const result = serializeTraceForTodo(transcript);
    expect(result).toContain('todoList');
    expect(result).toContain('askQuestion');
    expect(result).not.toContain('str_replace_based_edit_tool');
    expect(result).not.toContain('readFile');
  });

  it('preserves original tool call indices', () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          role: 'assistant',
          toolCalls: [
            makeToolCall('str_replace_based_edit_tool', {}),
            makeToolCall('str_replace_based_edit_tool', {}),
            makeToolCall('todoList', { operation: 'mark_done' }),
            makeToolCall('askQuestion', { questions: [] }),
          ],
        }),
      ],
    });
    const result = serializeTraceForTodo(transcript);
    expect(result).toContain('[2] todoList');
    expect(result).toContain('[3] askQuestion');
    expect(result).not.toContain('[0]');
    expect(result).not.toContain('[1]');
  });

  it('includes user turn content', () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          role: 'user',
          content: 'Build me a shoe store',
        }),
      ],
    });
    const result = serializeTraceForTodo(transcript);
    expect(result).toContain('Build me a shoe store');
    expect(result).toContain('role=user');
  });

  it('skips assistant turns with no relevant tool calls', () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({
          role: 'assistant',
          toolCalls: [
            makeToolCall('str_replace_based_edit_tool', {}),
            makeToolCall('readFile', {}),
          ],
        }),
      ],
    });
    const result = serializeTraceForTodo(transcript);
    expect(result).toBe('');
  });

  it('formats multi-turn trace with proper structure', () => {
    const transcript = makeTranscript({
      turns: [
        makeTurn({ role: 'user', content: 'Build a page' }),
        makeTurn({
          role: 'assistant',
          toolCalls: [
            makeToolCall('setProjectName', { name: 'MyApp' }, { success: true }),
            makeToolCall('todoList', {
              operation: 'create_list',
              items: [{ id: 'itm_1', title: 'Hero' }],
            }),
            makeToolCall('handoff', { targetAgent: 'develop' }),
          ],
        }),
      ],
    });
    const result = serializeTraceForTodo(transcript);
    expect(result).toContain('=== TURN 1 | role=user ===');
    expect(result).toContain('=== TURN 2 | role=assistant ===');
    expect(result).toContain('[0] setProjectName');
    expect(result).toContain('[1] todoList');
    expect(result).toContain('[2] handoff');
  });
});
