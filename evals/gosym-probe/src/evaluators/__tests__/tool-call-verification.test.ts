import { describe, it, expect } from 'vitest';
import {
  ToolCallVerificationEvaluator,
} from '../tool-call-verification.js';
import type {
  Transcript,
  Turn,
  ToolCall,
} from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeToolCall(
  name: string,
  overrides: Partial<ToolCall> = {},
): ToolCall {
  return { id: `tc-${name}`, name, startTime: 0, endTime: 1, ...overrides };
}

function makeTurn(
  role: 'user' | 'assistant',
  toolCalls: ToolCall[] = [],
): Turn {
  return { role, content: '', toolCalls, timestamp: 0 };
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
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

describe('ToolCallVerificationEvaluator', () => {
  const evaluator = new ToolCallVerificationEvaluator();

  it('passes with score 1.0 when expectedTools is undefined', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ expectedTools: undefined }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('passes with score 1.0 when expectedTools is empty array', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ expectedTools: [] }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('passes when required tool was called', async () => {
    const turns = [
      makeTurn('assistant', [makeToolCall('create-page')]),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({
        expectedTools: [{ tool: 'create-page', called: true }],
      }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('fails when required tool was not called', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [] }),
      makeScenario({
        expectedTools: [{ tool: 'create-page', called: true }],
      }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
  });

  it('passes when forbidden tool was not called', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [] }),
      makeScenario({
        expectedTools: [{ tool: 'delete-all', called: false }],
      }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('fails when forbidden tool was called', async () => {
    const turns = [makeTurn('assistant', [makeToolCall('delete-all')])];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({
        expectedTools: [{ tool: 'delete-all', called: false }],
      }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
  });

  it('scores 0.5 when one of two assertions is violated', async () => {
    const turns = [
      makeTurn('assistant', [makeToolCall('create-page')]),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({
        expectedTools: [
          { tool: 'create-page', called: true },  // satisfied
          { tool: 'add-hero', called: true },       // violated
        ],
      }),
    );
    expect(result.score).toBeCloseTo(0.5);
    expect(result.verdict).toBe('fail'); // any violation = fail
  });

  it('checks tool calls across all turns', async () => {
    const turns = [
      makeTurn('assistant', [makeToolCall('create-page')]),
      makeTurn('assistant', [makeToolCall('add-hero')]),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({
        expectedTools: [
          { tool: 'create-page', called: true },
          { tool: 'add-hero', called: true },
        ],
      }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('includes tool name in reason when assertion is violated', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [] }),
      makeScenario({
        expectedTools: [{ tool: 'create-page', called: true }],
      }),
    );
    expect(result.reason).toContain('create-page');
  });

  it('includes called tools list in details', async () => {
    const turns = [
      makeTurn('assistant', [makeToolCall('create-page')]),
    ];
    const result = await evaluator.evaluate(
      makeTranscript({ turns }),
      makeScenario({ expectedTools: [] }),
    );
    expect(result.details?.calledTools).toContain('create-page');
  });

  it('is named tool-call-verification', () => {
    expect(evaluator.name).toBe('tool-call-verification');
  });

  describe('match: prefix', () => {
    it('passes when a tool starts with the prefix', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('skill__auth__login'),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            {
              tool: 'skill__auth',
              called: true,
              match: 'prefix',
            },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
    });

    it('fails when no tool starts with the prefix', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('skill__commerce'),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            {
              tool: 'skill__auth',
              called: true,
              match: 'prefix',
            },
          ],
        }),
      );
      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
    });

    it(
      'fails when forbidden prefix matches a called tool',
      async () => {
        const turns = [
          makeTurn('assistant', [
            makeToolCall('skill__auth'),
          ]),
        ];
        const result = await evaluator.evaluate(
          makeTranscript({ turns }),
          makeScenario({
            expectedTools: [
              {
                tool: 'skill__',
                called: false,
                match: 'prefix',
              },
            ],
          }),
        );
        expect(result.verdict).toBe('fail');
        expect(result.score).toBe(0);
      },
    );
  });

  describe('toolPattern', () => {
    it(
      'matches substring in tool name',
      async () => {
        const turns = [
          makeTurn('assistant', [
            makeToolCall('skill__auth'),
          ]),
        ];
        const result = await evaluator.evaluate(
          makeTranscript({ turns }),
          makeScenario({
            expectedTools: [
              {
                tool: '',
                called: true,
                toolPattern: /auth/,
              },
            ],
          }),
        );
        expect(result.verdict).toBe('pass');
        expect(result.score).toBe(1.0);
      },
    );

    it(
      'matches substring in nested tool name',
      async () => {
        const turns = [
          makeTurn('assistant', [
            makeToolCall('skill__auth__login'),
          ]),
        ];
        const result = await evaluator.evaluate(
          makeTranscript({ turns }),
          makeScenario({
            expectedTools: [
              {
                tool: '',
                called: true,
                toolPattern: /auth/,
              },
            ],
          }),
        );
        expect(result.verdict).toBe('pass');
        expect(result.score).toBe(1.0);
      },
    );

    it('matches with regex pattern', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('skill__publishing__publish'),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            {
              tool: '',
              called: true,
              toolPattern: /.*__publish/,
            },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
    });

    it(
      'fails when no tool matches the pattern',
      async () => {
        const turns = [
          makeTurn('assistant', [
            makeToolCall('skill__commerce'),
          ]),
        ];
        const result = await evaluator.evaluate(
          makeTranscript({ turns }),
          makeScenario({
            expectedTools: [
              {
                tool: '',
                called: true,
                toolPattern: /auth/,
              },
            ],
          }),
        );
        expect(result.verdict).toBe('fail');
        expect(result.score).toBe(0);
      },
    );

    it(
      'fails when forbidden pattern matches a called tool',
      async () => {
        const turns = [
          makeTurn('assistant', [
            makeToolCall('skill__auth__login'),
          ]),
        ];
        const result = await evaluator.evaluate(
          makeTranscript({ turns }),
          makeScenario({
            expectedTools: [
              {
                tool: '',
                called: false,
                toolPattern: /auth/,
              },
            ],
          }),
        );
        expect(result.verdict).toBe('fail');
        expect(result.score).toBe(0);
      },
    );
  });
});
