import { describe, it, expect } from 'vitest';
import {
  ToolCallVerificationEvaluator,
} from '../tool-call-verification.js';
import type {
  Transcript,
  Turn,
  ToolCall,
} from '../../runner/transcript.js';
import type { Scenario, ToolCallAssertion } from '../../scenarios/types.js';
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

  describe('args subset match', () => {
    it('rejects a non-primitive arg value at the type level (compile-lock)', () => {
      // argsMatch compares with strict `===`, which only handles primitives. The
      // AssertionArgValue narrowing makes an object/array-valued arg a COMPILE error,
      // so a forbidden-tool guard can never silently pass vacuously against a
      // structured arg. If this @ts-expect-error stops erroring, the type widened.
      const assertion: ToolCallAssertion = {
        tool: 'handoff',
        called: false,
        // @ts-expect-error non-primitive arg values are not allowed
        args: { channels: ['social'] },
      };
      expect(assertion.args).toBeDefined();
    });

    it('forbidden handoff to marketing PASSES when handoff targets a different agent', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', { input: { targetAgent: 'develop' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
    });

    it('forbidden handoff to marketing FAILS when handoff targets marketing', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', { input: { targetAgent: 'marketing' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
      expect(result.reason).toContain('marketing');
    });

    it('required tool with args PASSES only when a call matches every arg', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('socialPostCreate', { input: { platform: 'instagram' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'socialPostCreate', called: true, args: { platform: 'instagram' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
    });

    it('args match requires the tool NAME to match too', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('media', { input: { targetAgent: 'marketing' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      // a non-handoff tool with the same arg does NOT trip the handoff assertion
      expect(result.verdict).toBe('pass');
    });

    it('forbidden+args is satisfied when the called tool has no/non-object input', async () => {
      const turns = [
        makeTurn('assistant', [makeToolCall('handoff')]), // no input recorded
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      // null/undefined input can't match the arg subset → assertion stays satisfied
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
    });

    it('required+args FAILS when the tool is called but with non-matching args', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('socialPostCreate', { input: { platform: 'facebook' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'socialPostCreate', called: true, args: { platform: 'instagram' } },
          ],
        }),
      );
      // called, but args don't match → treated as "not called with those args"
      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
    });
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

  describe('args matching', () => {
    it('fails when a forbidden call matches the args subset', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', {
            input: { targetAgent: 'marketing', reason: 'campaign' },
          }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
    });

    it('passes when a handoff targets a different agent (args do not match)', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', { input: { targetAgent: 'care' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
    });

    it('passes the no-marketing-handoff guard when handoff was never called', async () => {
      const result = await evaluator.evaluate(
        makeTranscript({ turns: [] }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
    });

    it('matches a required call only when the args subset is satisfied', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', { input: { targetAgent: 'develop' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: true, args: { targetAgent: 'develop' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
    });

    it('treats non-object input as non-matching for args assertions', async () => {
      const turns = [
        makeTurn('assistant', [makeToolCall('handoff', { input: 'marketing' })]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
    });

    it('includes the args in the violation reason', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', { input: { targetAgent: 'marketing' } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: false, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.reason).toContain('marketing');
    });

    it('matches when the recorded input has EXTRA keys beyond args (subset)', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('handoff', {
            input: { targetAgent: 'marketing', reason: 'campaign', step: 2 },
          }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'handoff', called: true, args: { targetAgent: 'marketing' } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
    });

    it('matches a null-valued arg against a null input value', async () => {
      const turns = [
        makeTurn('assistant', [
          makeToolCall('configure', { input: { fallback: null } }),
        ]),
      ];
      const result = await evaluator.evaluate(
        makeTranscript({ turns }),
        makeScenario({
          expectedTools: [
            { tool: 'configure', called: true, args: { fallback: null } },
          ],
        }),
      );
      expect(result.verdict).toBe('pass');
    });
  });
});
