import { describe, it, expect, vi } from 'vitest';
import { LatencyEvaluator } from '../latency-evaluator.js';
import type {
  Transcript,
  Turn,
} from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type {
  AgentClient,
  AgentEvent,
} from '../../clients/agent-client.js';
import type { Persona } from '../../personas/types.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeScenario(
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    ...overrides,
  };
}

function makeTurn(
  role: 'user' | 'assistant',
  timestamp: number,
): Turn {
  return { role, content: '', toolCalls: [], timestamp };
}

function makeTranscript(
  trialIndex: number,
  turns: Turn[] = [],
): Transcript {
  return {
    scenarioName: 'test',
    trialIndex,
    turns,
    snapshots: [],
    errors: [],
  };
}

/**
 * Creates a mock AgentClient that captures registered
 * handlers so tests can fire synthetic events.
 */
function makeMockClient(): {
  client: AgentClient;
  fire: (event: AgentEvent) => void;
} {
  const handlers: ((event: AgentEvent) => void)[] = [];
  const client: AgentClient = {
    configure: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
    onMessage(handler) {
      handlers.push(handler);
    },
  };
  return {
    client,
    fire: (event) => handlers.forEach((h) => h(event)),
  };
}

describe('LatencyEvaluator', () => {
  it('has name "latency"', () => {
    const evaluator = new LatencyEvaluator();
    expect(evaluator.name).toBe('latency');
  });

  describe('evaluate() with no hookClient called', () => {
    it('returns unknown when no timing recorded', async () => {
      const evaluator = new LatencyEvaluator();
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.verdict).toBe('unknown');
      expect(result.reason).toMatch(/no chunk events/i);
    });

    it('includes chunkCount: 0 in details', async () => {
      const evaluator = new LatencyEvaluator();
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.details?.chunkCount).toBe(0);
    });
  });

  describe('hookClient()', () => {
    it('records timing for the correct trial index', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'hello' });

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      expect(result.details?.chunkCount).toBe(1);
    });

    it('ignores non-chunk/non-complete events', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({
        type: 'step_start',
        agentName: 'test',
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.details?.chunkCount).toBe(0);
    });

    it('does not affect a different trial index', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 1);
      fire({ type: 'chunk', content: 'x' });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.details?.chunkCount).toBe(0);
    });
  });

  describe('complete events without preceding chunks', () => {
    it(
      'does not include empty turns in results',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        // Tool-only turn: complete with no chunks
        fire({ type: 'complete', content: '' });
        // Text turn: has chunks
        fire({ type: 'chunk', content: 'hello' });
        fire({
          type: 'complete',
          content: 'hello',
        });

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 2000),
          makeTurn('user', 3000),
          makeTurn('assistant', 4000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.details?.chunkCount).toBe(1);
        const perTurn = result.details
          ?.perTurn as Array<{
          turnIndex: number;
          chunkCount: number;
        }>;
        expect(perTurn).toHaveLength(1);
        // turnIndex is 1 (second pair), not 0
        expect(perTurn[0].turnIndex).toBe(1);
        expect(perTurn[0].chunkCount).toBe(1);
      },
    );

    it(
      'advances turnIndex through empty turns',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        // Two empty turns, then one with data
        fire({ type: 'complete', content: '' });
        fire({ type: 'complete', content: '' });
        fire({ type: 'chunk', content: 'x' });
        fire({ type: 'complete', content: 'x' });

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 2000),
          makeTurn('user', 3000),
          makeTurn('assistant', 4000),
          makeTurn('user', 5000),
          makeTurn('assistant', 6000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        const perTurn = result.details
          ?.perTurn as Array<{
          turnIndex: number;
        }>;
        expect(perTurn).toHaveLength(1);
        // Third pair (index 2), proving index
        // was advanced through empty turns
        expect(perTurn[0].turnIndex).toBe(2);
      },
    );

    it(
      'all empty completes produce no chunks',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'complete', content: '' });
        fire({ type: 'complete', content: '' });
        fire({ type: 'complete', content: '' });

        const result = await evaluator.evaluate(
          makeTranscript(0),
          makeScenario(),
        );
        expect(result.details?.chunkCount).toBe(0);
        expect(result.verdict).toBe('unknown');
      },
    );
  });

  describe('evaluate() with single-turn chunk data', () => {
    it(
      'returns real verdict when TTFC is available',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(1500);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 2000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        // TTFC=500ms, halfLifeMs=4000
        // → score = 2^(-0.125) ≈ 0.917
        expect(result.verdict).toBe('observed');
        expect(result.score).toBeGreaterThan(0.5);
      },
    );

    it('includes chunkCount in details', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'chunk', content: 'c' });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.details?.chunkCount).toBe(3);
    });

    it('computes maxInterChunkGapMs within a turn', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();
      const now = vi.spyOn(Date, 'now');

      evaluator.hookClient(client, 0);
      now.mockReturnValue(1000);
      fire({ type: 'chunk', content: 'a' });
      now.mockReturnValue(1050);
      fire({ type: 'chunk', content: 'b' });
      now.mockReturnValue(1200);
      fire({ type: 'chunk', content: 'c' });
      now.mockRestore();

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.details?.maxInterChunkGapMs).toBe(150);
    });

    it('sets maxInterChunkGapMs to 0 for single chunk', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'only' });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      expect(result.details?.maxInterChunkGapMs).toBe(0);
    });

    it('computes timeToFirstChunkMs from user turn', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();
      const now = vi.spyOn(Date, 'now');

      evaluator.hookClient(client, 0);
      now.mockReturnValue(1100);
      fire({ type: 'chunk', content: 'first' });
      now.mockRestore();

      const turns = [makeTurn('user', 1000)];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      expect(result.details?.timeToFirstChunkMs).toBe(100);
    });

    it('sets timeToFirstChunkMs to null without user turn', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'x' });

      const result = await evaluator.evaluate(
        makeTranscript(0, []),
        makeScenario(),
      );
      expect(result.details?.timeToFirstChunkMs).toBeNull();
    });

    it('includes timing metrics in reason string', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();
      const now = vi.spyOn(Date, 'now');

      evaluator.hookClient(client, 0);
      now.mockReturnValue(1050);
      fire({ type: 'chunk', content: 'x' });
      now.mockRestore();

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      expect(result.reason).toContain('TTFC=');
      expect(result.reason).toContain('maxGap=');
      expect(result.reason).toContain('total=');
      expect(result.reason).toContain('chunks=');
      expect(result.reason).toContain('turns=');
    });
  });

  describe('evaluate() with multi-turn chunk data', () => {
    it('separates chunks by complete events', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'complete', content: 'done' });
      fire({ type: 'chunk', content: 'c' });
      fire({ type: 'complete', content: 'done' });

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
        makeTurn('user', 3000),
        makeTurn('assistant', 4000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      const perTurn = result.details?.perTurn as Array<{
        chunkCount: number;
      }>;
      expect(perTurn).toHaveLength(2);
      expect(perTurn[0].chunkCount).toBe(2);
      expect(perTurn[1].chunkCount).toBe(1);
    });

    it('excludes inter-turn gaps from maxGap', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();
      const now = vi.spyOn(Date, 'now');

      evaluator.hookClient(client, 0);

      // Turn 0: two chunks 50ms apart
      now.mockReturnValue(1000);
      fire({ type: 'chunk', content: 'a' });
      now.mockReturnValue(1050);
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'complete', content: '' });

      // 10 second gap between turns (synthetic user LLM etc)
      // Turn 1: two chunks 80ms apart
      now.mockReturnValue(11000);
      fire({ type: 'chunk', content: 'c' });
      now.mockReturnValue(11080);
      fire({ type: 'chunk', content: 'd' });
      fire({ type: 'complete', content: '' });

      now.mockRestore();

      const turns = [
        makeTurn('user', 900),
        makeTurn('assistant', 1100),
        makeTurn('user', 10000),
        makeTurn('assistant', 11100),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );

      // maxGap should be 80ms (within turn 1),
      // NOT ~10s (inter-turn gap)
      expect(result.details?.maxInterChunkGapMs).toBe(80);
    });

    it('computes per-turn TTFC from each user turn', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();
      const now = vi.spyOn(Date, 'now');

      evaluator.hookClient(client, 0);

      now.mockReturnValue(1200);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'complete', content: '' });

      now.mockReturnValue(3500);
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'complete', content: '' });

      now.mockRestore();

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 1300),
        makeTurn('user', 3000),
        makeTurn('assistant', 3600),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      const perTurn = result.details?.perTurn as Array<{
        timeToFirstChunkMs: number;
      }>;
      expect(perTurn[0].timeToFirstChunkMs).toBe(200);
      expect(perTurn[1].timeToFirstChunkMs).toBe(500);
    });

    it('computes per-turn totalTurnMs', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'complete', content: '' });
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'complete', content: '' });

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
        makeTurn('user', 3000),
        makeTurn('assistant', 5000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      const perTurn = result.details?.perTurn as Array<{
        totalTurnMs: number;
      }>;
      expect(perTurn[0].totalTurnMs).toBe(1000);
      expect(perTurn[1].totalTurnMs).toBe(2000);
    });

    it('reports totalMs as full conversation span', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'complete', content: '' });
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'complete', content: '' });

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
        makeTurn('user', 3000),
        makeTurn('assistant', 8000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      // First user (1000) to last assistant (8000)
      expect(result.details?.totalMs).toBe(7000);
    });

    it('uses first turn TTFC as top-level TTFC', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();
      const now = vi.spyOn(Date, 'now');

      evaluator.hookClient(client, 0);

      now.mockReturnValue(1300);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'complete', content: '' });

      now.mockReturnValue(3100);
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'complete', content: '' });

      now.mockRestore();

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 1400),
        makeTurn('user', 3000),
        makeTurn('assistant', 3200),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      expect(result.details?.timeToFirstChunkMs).toBe(300);
    });

    it('skips turns with no chunks in perTurn', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);

      // Turn 0: no chunks, just tool calls
      fire({ type: 'complete', content: '' });

      // Turn 1: has chunks
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'complete', content: '' });

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
        makeTurn('user', 3000),
        makeTurn('assistant', 4000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      const perTurn = result.details?.perTurn as Array<{
        turnIndex: number;
        chunkCount: number;
      }>;
      // Only the turn with chunks is included
      expect(perTurn).toHaveLength(1);
      expect(perTurn[0].turnIndex).toBe(1);
      expect(perTurn[0].chunkCount).toBe(1);
    });

    it('includes unfinalised active turn chunks', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({ type: 'complete', content: '' });
      // Second turn never receives complete event
      fire({ type: 'chunk', content: 'b' });
      fire({ type: 'chunk', content: 'c' });

      const turns = [
        makeTurn('user', 1000),
        makeTurn('assistant', 2000),
        makeTurn('user', 3000),
        makeTurn('assistant', 4000),
      ];
      const result = await evaluator.evaluate(
        makeTranscript(0, turns),
        makeScenario(),
      );
      expect(result.details?.chunkCount).toBe(3);
      const perTurn = result.details?.perTurn as Array<{
        chunkCount: number;
      }>;
      expect(perTurn).toHaveLength(2);
      expect(perTurn[0].chunkCount).toBe(1);
      expect(perTurn[1].chunkCount).toBe(2);
    });
  });

  describe('scoring', () => {
    it(
      'computes median TTFC across multiple ' +
        'turns (odd count)',
      async () => {
        // TTFCs: 500, 1000, 1500ms → median = 1000ms
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);

        now.mockReturnValue(1500);
        fire({ type: 'chunk', content: 'a' });
        fire({ type: 'complete', content: '' });

        now.mockReturnValue(3000);
        fire({ type: 'chunk', content: 'b' });
        fire({ type: 'complete', content: '' });

        now.mockReturnValue(4500);
        fire({ type: 'chunk', content: 'c' });
        fire({ type: 'complete', content: '' });

        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 2000),
          makeTurn('user', 2000),
          makeTurn('assistant', 3000),
          makeTurn('user', 3000),
          makeTurn('assistant', 5000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.details?.medianTTFC).toBe(1000);
      },
    );

    it(
      'computes median TTFC across multiple ' +
        'turns (even count)',
      async () => {
        // TTFCs: 600, 1000ms → median = 800ms
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);

        now.mockReturnValue(1600);
        fire({ type: 'chunk', content: 'a' });
        fire({ type: 'complete', content: '' });

        now.mockReturnValue(3000);
        fire({ type: 'chunk', content: 'b' });
        fire({ type: 'complete', content: '' });

        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 2000),
          makeTurn('user', 2000),
          makeTurn('assistant', 4000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.details?.medianTTFC).toBe(800);
      },
    );

    it(
      'score follows exponential half-life decay',
      async () => {
        // medianTTFC = halfLifeMs → score = 0.5
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(5000);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 7000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        // TTFC=4000ms = halfLifeMs → score = 0.5
        expect(result.score).toBeCloseTo(0.5);
        expect(result.details?.medianTTFC).toBe(4000);
      },
    );

    it(
      'returns observed when TTFC well below half-life',
      async () => {
        // TTFC=500ms, halfLifeMs=4000ms
        // score = 2^(-0.125) ≈ 0.917
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(1500);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 3000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.verdict).toBe('observed');
        expect(result.score).toBeGreaterThan(0.5);
      },
    );

    it(
      'returns observed when TTFC equals half-life',
      async () => {
        // TTFC=4000ms = halfLifeMs → score = 0.5
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(5000);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 7000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.verdict).toBe('observed');
        expect(result.score).toBeCloseTo(0.5);
      },
    );

    it(
      'returns observed when TTFC well above half-life',
      async () => {
        // TTFC=5000ms, halfLifeMs=4000ms
        // score = 2^(-1.25) ≈ 0.420
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(6000);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 10000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.verdict).toBe('observed');
        expect(result.score).toBeLessThan(0.5);
      },
    );

    it(
      'uses custom halfLifeMs when provided',
      async () => {
        // halfLifeMs=1000ms, TTFC=1000ms → score=0.5
        const evaluator = new LatencyEvaluator({
          halfLifeMs: 1000,
        });
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(2000);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 5000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.score).toBeCloseTo(0.5);
        expect(result.details?.halfLifeMs).toBe(1000);
      },
    );

    it(
      'includes medianTTFC and halfLifeMs in details',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        now.mockReturnValue(1500);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 3000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.details?.medianTTFC).toBe(500);
        expect(result.details?.halfLifeMs).toBe(4000);
      },
    );

    it(
      'falls back to unknown when no TTFC ' +
        'values available',
      async () => {
        // Chunk fired but empty transcript → TTFC null
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });

        const result = await evaluator.evaluate(
          makeTranscript(0, []),
          makeScenario(),
        );
        expect(result.verdict).toBe('unknown');
        expect(result.score).toBe(0);
      },
    );
  });

  describe('constructor validation', () => {
    it('throws when halfLifeMs is 0', () => {
      expect(
        () => new LatencyEvaluator({ halfLifeMs: 0 }),
      ).toThrow('halfLifeMs must be a finite positive number');
    });

    it('throws when halfLifeMs is negative', () => {
      expect(
        () =>
          new LatencyEvaluator({ halfLifeMs: -1 }),
      ).toThrow('halfLifeMs must be a finite positive number');
    });

    it('throws when halfLifeMs is NaN', () => {
      expect(
        () => new LatencyEvaluator({ halfLifeMs: NaN }),
      ).toThrow('halfLifeMs must be a finite positive number');
    });

    it('throws when halfLifeMs is Infinity', () => {
      expect(
        () => new LatencyEvaluator({ halfLifeMs: Infinity }),
      ).toThrow('halfLifeMs must be a finite positive number');
    });

    it('throws when halfLifeMs is -Infinity', () => {
      expect(
        () => new LatencyEvaluator({ halfLifeMs: -Infinity }),
      ).toThrow('halfLifeMs must be a finite positive number');
    });

    it('accepts halfLifeMs = 1', () => {
      expect(
        () => new LatencyEvaluator({ halfLifeMs: 1 }),
      ).not.toThrow();
    });

    it('defaults to 4000 when no options', () => {
      expect(() => new LatencyEvaluator()).not.toThrow();
    });
  });

  describe('score clamping', () => {
    it(
      'clamps score to 10 when negative TTFC '
      + 'would exceed range',
      async () => {
        // Negative TTFC: chunk arrives before the
        // user turn timestamp (clock skew).
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        // User turn at 2000ms, chunk at 1000ms
        // => TTFC = -1000ms => raw score > 1
        now.mockReturnValue(1000);
        fire({ type: 'chunk', content: 'a' });
        now.mockRestore();

        const turns = [
          makeTurn('user', 2000),
          makeTurn('assistant', 5000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        expect(result.score).toBe(1);
      },
    );
  });

  describe('aab diagnostic events', () => {
    it('includes empty aabDiagnostics when no events received', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      const diag = result.details?.aabDiagnostics as {
        timingSummaries: unknown[];
        slowGaps: unknown[];
        timeouts: unknown[];
      };
      expect(diag.timingSummaries).toEqual([]);
      expect(diag.slowGaps).toEqual([]);
      expect(diag.timeouts).toEqual([]);
    });

    it('captures stream_timing_summary per trial', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 5000,
        timeToFirstTextChunkMs: 12000,
        maxChunkGapMs: 3000,
        chunksRead: 1,
        streamDurationMs: 18000,
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      const diag = result.details?.aabDiagnostics as {
        timingSummaries: Array<{
          timeToStreamStartMs: number;
          timeToFirstTextChunkMs: number;
        }>;
      };
      expect(diag.timingSummaries).toHaveLength(1);
      expect(diag.timingSummaries[0].timeToStreamStartMs).toBe(5000);
      expect(diag.timingSummaries[0].timeToFirstTextChunkMs).toBe(12000);
    });

    it('accumulates multiple stream_timing_summary events', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 1000,
        timeToFirstTextChunkMs: 2000,
        maxChunkGapMs: 500,
        chunksRead: 1,
        streamDurationMs: 3000,
      });
      fire({ type: 'chunk', content: 'b' });
      fire({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 1100,
        timeToFirstTextChunkMs: 2200,
        maxChunkGapMs: 400,
        chunksRead: 2,
        streamDurationMs: 3200,
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      const diag = result.details?.aabDiagnostics as {
        timingSummaries: Array<{
          timeToStreamStartMs: number;
          timeToFirstTextChunkMs: number | null;
        }>;
      };
      expect(diag.timingSummaries).toHaveLength(2);
      expect(
        diag.timingSummaries[0].timeToStreamStartMs,
      ).toBe(1000);
      expect(
        diag.timingSummaries[0]
          .timeToFirstTextChunkMs,
      ).toBe(2000);
      expect(
        diag.timingSummaries[1].timeToStreamStartMs,
      ).toBe(1100);
      expect(
        diag.timingSummaries[1]
          .timeToFirstTextChunkMs,
      ).toBe(2200);
    });

    it('captures stream_chunk_slow_gap events', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({
        type: 'stream_chunk_slow_gap',
        gapMs: 45000,
        chunksRead: 3,
        streamElapsedMs: 60000,
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      const diag = result.details?.aabDiagnostics as {
        slowGaps: Array<{ gapMs: number }>;
      };
      expect(diag.slowGaps).toHaveLength(1);
      expect(diag.slowGaps[0].gapMs).toBe(45000);
    });

    it('captures stream_chunk_timeout events', async () => {
      const evaluator = new LatencyEvaluator();
      const { client, fire } = makeMockClient();

      evaluator.hookClient(client, 0);
      fire({ type: 'chunk', content: 'a' });
      fire({
        type: 'stream_chunk_timeout',
        chunksRead: 5,
        streamElapsedMs: 125000,
        timeToFirstTextChunkMs: 8000,
        maxChunkGapMs: 120000,
        error: 'AbortError',
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      const diag = result.details?.aabDiagnostics as {
        timeouts: Array<{ maxChunkGapMs: number }>;
      };
      expect(diag.timeouts).toHaveLength(1);
      expect(diag.timeouts[0].maxChunkGapMs).toBe(120000);
    });

    it('isolates diagnostics by trial index', async () => {
      const evaluator = new LatencyEvaluator();
      const { client: c0, fire: fire0 } = makeMockClient();
      const { client: c1, fire: fire1 } = makeMockClient();

      evaluator.hookClient(c0, 0);
      evaluator.hookClient(c1, 1);

      fire0({ type: 'chunk', content: 'a' });
      fire0({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 1000,
        timeToFirstTextChunkMs: 2000,
        maxChunkGapMs: 500,
        chunksRead: 1,
        streamDurationMs: 3000,
      });
      fire1({ type: 'chunk', content: 'b' });

      const r0 = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );
      const r1 = await evaluator.evaluate(
        makeTranscript(1),
        makeScenario(),
      );

      const d0 = r0.details?.aabDiagnostics as {
        timingSummaries: unknown[];
      };
      const d1 = r1.details?.aabDiagnostics as {
        timingSummaries: unknown[];
      };
      expect(d0.timingSummaries).toHaveLength(1);
      expect(
        (d0.timingSummaries[0] as {
          timeToStreamStartMs: number;
        }).timeToStreamStartMs,
      ).toBe(1000);
      expect(d1.timingSummaries).toHaveLength(0);
    });

    it(
      'includes aabInit and aabTTFC in reason when ' +
        'timing summary present',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 5000,
          timeToFirstTextChunkMs: 12000,
          maxChunkGapMs: 3000,
          chunksRead: 1,
          streamDurationMs: 18000,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 20000),
          ]),
          makeScenario(),
        );
        expect(result.reason).toContain('aabInit=5000ms');
        expect(result.reason).toContain('aabTTFC=12000ms');
      },
    );

    it(
      'skips null-TTFC summaries and picks first ' +
        'text-bearing summary',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        // Tool-only step: null TTFC
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 300,
          timeToFirstTextChunkMs: null,
          maxChunkGapMs: 1000,
          chunksRead: 5,
          streamDurationMs: 2000,
        });
        // First text-bearing step
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 44000,
          timeToFirstTextChunkMs: 25000,
          maxChunkGapMs: 50000,
          chunksRead: 100,
          streamDurationMs: 60000,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 80000),
          ]),
          makeScenario(),
        );
        expect(result.reason).toContain('aabInit=44000ms');
        expect(result.reason).toContain('aabTTFC=25000ms');
        expect(result.reason).not.toContain('aabInit=300ms');
      },
    );

    it(
      'appends aabWorstGap when worst-gap step differs ' +
        'from first-text step',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 44000,
          timeToFirstTextChunkMs: 25000,
          maxChunkGapMs: 50000,
          chunksRead: 100,
          streamDurationMs: 60000,
        });
        // Later step with a larger gap
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 200,
          timeToFirstTextChunkMs: 3000,
          maxChunkGapMs: 150000,
          chunksRead: 10,
          streamDurationMs: 155000,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 200000),
          ]),
          makeScenario(),
        );
        expect(result.reason).toContain('aabInit=44000ms');
        expect(result.reason).toContain('aabTTFC=25000ms');
        expect(result.reason).toContain('aabWorstGap=150000ms');
      },
    );

    it(
      'omits aabWorstGap when worst gap is the ' +
        'first-text step itself',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 5000,
          timeToFirstTextChunkMs: 12000,
          maxChunkGapMs: 30000,
          chunksRead: 1,
          streamDurationMs: 18000,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 20000),
          ]),
          makeScenario(),
        );
        expect(result.reason).toContain('aabInit=5000ms');
        expect(result.reason).toContain('aabTTFC=12000ms');
        expect(result.reason).not.toContain('aabWorstGap');
      },
    );

    it(
      'compares summaries by index, not reference',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        // Two summaries with identical field values
        // but at different array positions. First has
        // text, second has worse gap. Index comparison
        // correctly treats them as distinct.
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 100,
          timeToFirstTextChunkMs: 200,
          maxChunkGapMs: 50,
          chunksRead: 1,
          streamDurationMs: 300,
        });
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 100,
          timeToFirstTextChunkMs: 200,
          maxChunkGapMs: 9999,
          chunksRead: 1,
          streamDurationMs: 300,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 2000),
          ]),
          makeScenario(),
        );
        expect(result.reason).toContain(
          'aabWorstGap=9999ms',
        );
      },
    );

    it(
      'omits aab suffix when all summaries have ' +
        'null timeToFirstTextChunkMs',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 300,
          timeToFirstTextChunkMs: null,
          maxChunkGapMs: 2000,
          chunksRead: 5,
          streamDurationMs: 3000,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 5000),
          ]),
          makeScenario(),
        );
        expect(result.reason).not.toContain('aabInit');
        expect(result.reason).not.toContain('aabTTFC');
      },
    );
  });

  describe('turn-correlated diagnostics', () => {
    it(
      'tags timing summary with active turn index',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        // Turn 0: chunk then complete
        fire({ type: 'chunk', content: 'a' });
        fire({ type: 'complete', content: '' });
        // Turn 1: chunk then diagnostic summary
        fire({ type: 'chunk', content: 'b' });
        fire({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 100,
          timeToFirstTextChunkMs: 200,
          maxChunkGapMs: 50,
          chunksRead: 1,
          streamDurationMs: 300,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 2000),
            makeTurn('user', 3000),
            makeTurn('assistant', 4000),
          ]),
          makeScenario(),
        );
        const diag = result.details
          ?.aabDiagnostics as {
          timingSummaries: Array<{
            turnIndex: number;
          }>;
        };
        expect(diag.timingSummaries).toHaveLength(1);
        expect(
          diag.timingSummaries[0].turnIndex,
        ).toBe(1);
      },
    );

    it(
      'tags slow gap with active turn index',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        fire({
          type: 'stream_chunk_slow_gap',
          gapMs: 5000,
          chunksRead: 2,
          streamElapsedMs: 8000,
        });

        const result = await evaluator.evaluate(
          makeTranscript(0),
          makeScenario(),
        );
        const diag = result.details
          ?.aabDiagnostics as {
          slowGaps: Array<{ turnIndex: number }>;
        };
        expect(diag.slowGaps).toHaveLength(1);
        expect(diag.slowGaps[0].turnIndex).toBe(0);
      },
    );

    it(
      'tags timeout with active turn index',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();

        evaluator.hookClient(client, 0);
        fire({ type: 'chunk', content: 'a' });
        fire({ type: 'complete', content: '' });
        fire({ type: 'chunk', content: 'b' });
        fire({ type: 'complete', content: '' });
        // Timeout arrives during turn 2
        fire({ type: 'chunk', content: 'c' });
        fire({
          type: 'stream_chunk_timeout',
          chunksRead: 1,
          streamElapsedMs: 60000,
          timeToFirstTextChunkMs: 5000,
          maxChunkGapMs: 55000,
          error: 'AbortError',
        });

        const result = await evaluator.evaluate(
          makeTranscript(0, [
            makeTurn('user', 1000),
            makeTurn('assistant', 2000),
            makeTurn('user', 3000),
            makeTurn('assistant', 4000),
            makeTurn('user', 5000),
            makeTurn('assistant', 70000),
          ]),
          makeScenario(),
        );
        const diag = result.details
          ?.aabDiagnostics as {
          timeouts: Array<{ turnIndex: number }>;
        };
        expect(diag.timeouts).toHaveLength(1);
        expect(diag.timeouts[0].turnIndex).toBe(2);
      },
    );
  });

  describe('double complete edge case (S4)', () => {
    it(
      'falls back to sequential pairing when' +
        ' double-complete inflates turnIndex',
      async () => {
        const evaluator = new LatencyEvaluator();
        const { client, fire } = makeMockClient();
        const now = vi.spyOn(Date, 'now');

        evaluator.hookClient(client, 0);
        // Turn 0: chunks then complete
        now.mockReturnValue(1200);
        fire({ type: 'chunk', content: 'a' });
        now.mockReturnValue(1300);
        fire({ type: 'chunk', content: 'b' });
        fire({ type: 'complete', content: '' });
        // Double complete (no chunks between).
        // Inflates collector turnIndex to 2.
        fire({ type: 'complete', content: '' });
        // Turn 2 (inflated): chunks then complete
        now.mockReturnValue(3400);
        fire({ type: 'chunk', content: 'c' });
        fire({ type: 'complete', content: '' });
        now.mockRestore();

        // Simulation only produces 2 pairs (the
        // double-complete is a spurious AAB event,
        // not a real exchange).
        const turns = [
          makeTurn('user', 1000),
          makeTurn('assistant', 2000),
          makeTurn('user', 3000),
          makeTurn('assistant', 4000),
        ];
        const result = await evaluator.evaluate(
          makeTranscript(0, turns),
          makeScenario(),
        );
        const perTurn = result.details
          ?.perTurn as Array<{
          turnIndex: number;
          chunkCount: number;
          timeToFirstChunkMs: number | null;
          totalTurnMs: number | null;
        }>;
        expect(perTurn).toHaveLength(2);
        expect(perTurn[0].turnIndex).toBe(0);
        expect(perTurn[0].chunkCount).toBe(2);
        expect(perTurn[0].timeToFirstChunkMs).toBe(
          200,
        );
        expect(perTurn[0].totalTurnMs).toBe(1000);
        // Turn 2's inflated turnIndex exceeds pair
        // count, falls back to sequential pairing
        // with the second transcript pair.
        expect(perTurn[1].turnIndex).toBe(2);
        expect(perTurn[1].chunkCount).toBe(1);
        expect(perTurn[1].timeToFirstChunkMs).toBe(
          400,
        );
        expect(perTurn[1].totalTurnMs).toBe(1000);
      },
    );
  });

  describe(
    'events before hookClient (S5)',
    () => {
      it(
        'events fired before hookClient are lost',
        async () => {
          const { client, fire } = makeMockClient();

          // Fire event before hookClient
          fire({ type: 'chunk', content: 'lost' });

          const evaluator = new LatencyEvaluator();
          evaluator.hookClient(client, 0);
          fire({
            type: 'chunk',
            content: 'captured',
          });

          const result = await evaluator.evaluate(
            makeTranscript(0),
            makeScenario(),
          );
          expect(result.details?.chunkCount).toBe(1);
        },
      );
    },
  );

  describe(
    'concurrent trial isolation (S6)',
    () => {
      it(
        'interleaved events are isolated by' +
          ' trial index',
        async () => {
          const evaluator = new LatencyEvaluator();
          const { client: c0, fire: fire0 } =
            makeMockClient();
          const { client: c1, fire: fire1 } =
            makeMockClient();

          evaluator.hookClient(c0, 0);
          evaluator.hookClient(c1, 1);

          // Interleave events across trials
          fire0({ type: 'chunk', content: 'a0' });
          fire1({ type: 'chunk', content: 'a1' });
          fire0({ type: 'chunk', content: 'b0' });
          fire1({ type: 'chunk', content: 'b1' });
          fire1({ type: 'chunk', content: 'c1' });
          fire0({
            type: 'complete',
            content: '',
          });
          fire1({
            type: 'complete',
            content: '',
          });

          const r0 = await evaluator.evaluate(
            makeTranscript(0),
            makeScenario(),
          );
          const r1 = await evaluator.evaluate(
            makeTranscript(1),
            makeScenario(),
          );

          expect(r0.details?.chunkCount).toBe(2);
          expect(r1.details?.chunkCount).toBe(3);

          const pt0 = r0.details
            ?.perTurn as Array<{
            chunkCount: number;
          }>;
          const pt1 = r1.details
            ?.perTurn as Array<{
            chunkCount: number;
          }>;
          expect(pt0).toHaveLength(1);
          expect(pt0[0].chunkCount).toBe(2);
          expect(pt1).toHaveLength(1);
          expect(pt1[0].chunkCount).toBe(3);
        },
      );
    },
  );

  describe(
    'evaluator reuse across trials (S7)',
    () => {
      it(
        'produces correct independent results' +
          ' for sequential trials',
        async () => {
          const evaluator = new LatencyEvaluator();

          // Trial 0
          const { client: c0, fire: fire0 } =
            makeMockClient();
          evaluator.hookClient(c0, 0);
          fire0({ type: 'chunk', content: 'x' });

          const r0 = await evaluator.evaluate(
            makeTranscript(0),
            makeScenario(),
          );
          expect(r0.details?.chunkCount).toBe(1);

          // Trial 1 on same evaluator instance
          const { client: c1, fire: fire1 } =
            makeMockClient();
          evaluator.hookClient(c1, 1);
          fire1({ type: 'chunk', content: 'a' });
          fire1({ type: 'chunk', content: 'b' });
          fire1({ type: 'chunk', content: 'c' });

          const r1 = await evaluator.evaluate(
            makeTranscript(1),
            makeScenario(),
          );
          expect(r1.details?.chunkCount).toBe(3);
        },
      );
    },
  );
});
