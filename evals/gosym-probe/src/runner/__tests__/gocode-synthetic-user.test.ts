import { describe, it, expect, vi } from 'vitest';
import { GocodeSyntheticUser } from '../gocode-synthetic-user.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { GoalTracker } from '../goal-tracker.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Turn } from '../transcript.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeClient(response = 'DONE'): GocodeClient {
  return { complete: vi.fn().mockResolvedValue(response) } as unknown as
    GocodeClient;
}

function makeScenario(): Scenario {
  return {
    name: 'test',
    trials: 1,
    persona: {
      name: 'tester',
      description: '',
      systemPrompt: 'You are a tester.',
    },
    goals: [
      { description: 'build a page', assertion: 'positive' },
      { description: 'share credentials', assertion: 'negative' },
    ],
    evaluators: [],
  };
}

function userTurn(content: string): Turn {
  return { role: 'user', content, toolCalls: [], timestamp: 0 };
}

function assistantTurn(
  content: string,
  toolCalls: Turn['toolCalls'] = [],
): Turn {
  return { role: 'assistant', content, toolCalls, timestamp: 0 };
}

// ── History prompt rendering ──────────────────────────────────────────────────

describe('GocodeSyntheticUser — history prompt', () => {
  function getHistoryContent(client: GocodeClient): string {
    const [msgs] = (client.complete as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [{ role: string; content: string }[]];
    return msgs.find((m) => m.role === 'user')?.content ?? '';
  }

  it('includes plain assistant content in history', async () => {
    const client = makeClient('hello back');
    const user = new GocodeSyntheticUser(client);
    const history: Turn[] = [
      userTurn('hello'),
      assistantTurn('Hello! How can I help?'),
    ];

    await user.nextMessage(history, makeScenario());

    expect(getHistoryContent(client)).toContain(
      'ASSISTANT: Hello! How can I help?',
    );
  });

  it('includes user turns in history', async () => {
    const client = makeClient('reply');
    const user = new GocodeSyntheticUser(client);
    const history: Turn[] = [userTurn('build me a page')];

    await user.nextMessage(history, makeScenario());

    expect(getHistoryContent(client)).toContain('USER: build me a page');
  });

  it('renders tool call name in assistant turn', async () => {
    const client = makeClient('answer');
    const user = new GocodeSyntheticUser(client);
    const history: Turn[] = [
      userTurn('help me'),
      assistantTurn('', [
        {
          id: 'tc-1',
          name: 'askQuestion',
          output: undefined,
          startTime: 0,
          endTime: 0,
        },
      ]),
    ];

    await user.nextMessage(history, makeScenario());

    expect(getHistoryContent(client)).toContain('[tool: askQuestion]');
  });

  it('renders tool call output in assistant turn', async () => {
    const client = makeClient('answer');
    const user = new GocodeSyntheticUser(client);
    const widgetOutput = {
      success: true,
      widgetType: 'ask-question',
      widgetData: {
        questions: [
          { question: "What's your business name?", allowOther: true },
        ],
        answers: [],
      },
    };
    const history: Turn[] = [
      userTurn('help me'),
      assistantTurn('', [
        {
          id: 'tc-1',
          name: 'askQuestion',
          output: widgetOutput,
          startTime: 0,
          endTime: 0,
        },
      ]),
    ];

    await user.nextMessage(history, makeScenario());

    const content = getHistoryContent(client);
    expect(content).toContain('[tool: askQuestion]');
    expect(content).toContain("What's your business name?");
  });

  it('renders both content and tool calls when both present', async () => {
    const client = makeClient('answer');
    const user = new GocodeSyntheticUser(client);
    const history: Turn[] = [
      userTurn('help'),
      assistantTurn('Let me check.', [
        {
          id: 'tc-1',
          name: 'someTool',
          output: { result: 'ok' },
          startTime: 0,
          endTime: 0,
        },
      ]),
    ];

    await user.nextMessage(history, makeScenario());

    const content = getHistoryContent(client);
    expect(content).toContain('Let me check.');
    expect(content).toContain('[tool: someTool]');
  });

  it('renders multiple tool calls in a single turn', async () => {
    const client = makeClient('done');
    const user = new GocodeSyntheticUser(client);
    const history: Turn[] = [
      userTurn('go'),
      assistantTurn('', [
        {
          id: 'tc-1',
          name: 'toolA',
          output: 'result-a',
          startTime: 0,
          endTime: 0,
        },
        {
          id: 'tc-2',
          name: 'toolB',
          output: { x: 1 },
          startTime: 0,
          endTime: 0,
        },
      ]),
    ];

    await user.nextMessage(history, makeScenario());

    const content = getHistoryContent(client);
    expect(content).toContain('[tool: toolA]');
    expect(content).toContain('[tool: toolB]');
  });

  it('omits tool output section when output is undefined', async () => {
    const client = makeClient('done');
    const user = new GocodeSyntheticUser(client);
    const history: Turn[] = [
      userTurn('go'),
      assistantTurn('', [
        {
          id: 'tc-1',
          name: 'pendingTool',
          output: undefined,
          startTime: 0,
          endTime: 0,
        },
      ]),
    ];

    await user.nextMessage(history, makeScenario());

    const content = getHistoryContent(client);
    expect(content).toContain('[tool: pendingTool]');
    expect(content).not.toContain('undefined');
  });
});

// ── Termination / turn counting ───────────────────────────────────────────────

describe('GocodeSyntheticUser — termination', () => {
  it('returns null when DONE signal received', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);
    const result = await user.nextMessage(
      [userTurn('hi'), assistantTurn('hello')],
      makeScenario(),
    );
    expect(result).toBeNull();
  });

  it('returns trimmed response when not DONE', async () => {
    const client = makeClient('  Sure, let me help.  ');
    const user = new GocodeSyntheticUser(client);
    const result = await user.nextMessage(
      [userTurn('hi'), assistantTurn('hello')],
      makeScenario(),
    );
    expect(result).toBe('Sure, let me help.');
  });
});

// ── System prompt construction ────────────────────────────────────────────────

describe('GocodeSyntheticUser — system prompt', () => {
  function getMsgs(client: GocodeClient) {
    const [msgs] = (client.complete as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [{ role: string; content: string }[]];
    return msgs;
  }

  it('includes persona systemPrompt', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);

    await user.nextMessage([], makeScenario());

    const sysPrompt =
      getMsgs(client).find((m) => m.role === 'system')?.content ?? '';
    expect(sysPrompt).toContain('You are a tester.');
  });

  it('marks positive goals as ACHIEVE', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);

    await user.nextMessage([], makeScenario());

    const sysPrompt =
      getMsgs(client).find((m) => m.role === 'system')?.content ?? '';
    expect(sysPrompt).toContain('ACHIEVE: build a page');
  });

  it('marks negative goals as AVOID', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);

    await user.nextMessage([], makeScenario());

    const sysPrompt =
      getMsgs(client).find((m) => m.role === 'system')?.content ?? '';
    expect(sysPrompt).toContain('AVOID: share credentials');
  });

  it('prompts user to start conversation when history is empty', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);

    await user.nextMessage([], makeScenario());

    const userMsg =
      getMsgs(client).find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('Start the conversation');
  });
});

// ── Tracker-aware prompt ──────────────────────────────────────────────────────

describe('GocodeSyntheticUser — tracker-aware prompt', () => {
  function getSystemContent(client: GocodeClient): string {
    const [msgs] = (client.complete as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [{ role: string; content: string }[]];
    return msgs.find((m) => m.role === 'system')?.content ?? '';
  }

  function makeTracker(output = 'mock goal prompt'): GoalTracker {
    return {
      buildGoalPrompt: vi.fn().mockReturnValue(output),
    } as unknown as GoalTracker;
  }

  it('calls buildGoalPrompt() and includes output in system prompt', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);
    const tracker = makeTracker('Your current goal: build a page');

    await user.nextMessage([], makeScenario(), tracker);

    expect(
      (tracker.buildGoalPrompt as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalled();
    expect(getSystemContent(client)).toContain(
      'Your current goal: build a page',
    );
  });

  it('includes follow-up instruction in system prompt', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);
    const tracker = makeTracker();

    await user.nextMessage([], makeScenario(), tracker);

    expect(getSystemContent(client)).toContain(
      'Continue engaging naturally after each request.',
    );
  });

  it('DONE condition references requests have been made', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);
    const tracker = makeTracker();

    await user.nextMessage([], makeScenario(), tracker);

    expect(getSystemContent(client)).toContain(
      'all requests have been made',
    );
  });

  it('does not include flat ACHIEVE/AVOID when tracker provided', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);
    const tracker = makeTracker();

    await user.nextMessage([], makeScenario(), tracker);

    const sys = getSystemContent(client);
    expect(sys).not.toContain('ACHIEVE:');
    expect(sys).not.toContain('AVOID:');
  });
});

// ── No-tracker regression ─────────────────────────────────────────────────────

describe('GocodeSyntheticUser — no tracker regression', () => {
  it('uses flat ACHIEVE/AVOID format when no tracker passed', async () => {
    const client = makeClient('DONE');
    const user = new GocodeSyntheticUser(client);

    await user.nextMessage([], makeScenario());

    const [msgs] = (client.complete as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [{ role: string; content: string }[]];
    const sys = msgs.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toContain('ACHIEVE: build a page');
    expect(sys).toContain('AVOID: share credentials');
  });
});

// ── staticFirstMessage ───────────────────────────────────────────────────────

describe('GocodeSyntheticUser — staticFirstMessage', () => {
  it('returns staticFirstMessage verbatim on first turn', async () => {
    const client = makeClient('ignored');
    const user = new GocodeSyntheticUser(client);
    const scenario = {
      ...makeScenario(),
      staticFirstMessage: 'Build me a website',
    };

    const result = await user.nextMessage(
      [],
      scenario,
    );
    expect(result).toBe('Build me a website');
  });

  it('does not call LLM on first turn', async () => {
    const client = makeClient('ignored');
    const user = new GocodeSyntheticUser(client);
    const scenario = {
      ...makeScenario(),
      staticFirstMessage: 'Build me a website',
    };

    await user.nextMessage([], scenario);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('calls LLM on subsequent turns', async () => {
    const client = makeClient('follow-up reply');
    const user = new GocodeSyntheticUser(client);
    const scenario = {
      ...makeScenario(),
      staticFirstMessage: 'Build me a website',
    };

    const history = [
      userTurn('Build me a website'),
      assistantTurn('Sure, starting now.'),
    ];
    const result = await user.nextMessage(
      history,
      scenario,
    );
    expect(result).toBe('follow-up reply');
    expect(client.complete).toHaveBeenCalledOnce();
  });
});
