import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Simulation,
  isFatalError,
  InactivityTimeoutError,
  InactivityGuard,
} from '../simulation.js';
import type { SimulationCaptureContext } from '../simulation.js';
import type { Transcript } from '../transcript.js';
import { GoalTracker } from '../goal-tracker.js';
import type { AgentClient, AgentEvent } from '../../clients/agent-client.js';
import type { SyntheticUserAgent } from '../synthetic-user.js';
import type {
  Scenario,
  ScenarioGoal,
  SetupContext,
} from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';
import type { ResolvedConfig } from '../../../config/index.js';

// Controllable mock — call .emit() to push events into the simulation.
class MockAgentClient implements AgentClient {
  private handlers: ((e: AgentEvent) => void)[] = [];
  public sent: string[] = [];
  public lastCtx: SetupContext = {};

  configure(ctx: SetupContext): void {
    this.lastCtx = ctx;
  }

  send(message: string): void {
    this.sent.push(message);
  }

  onMessage(handler: (e: AgentEvent) => void): void {
    this.handlers.push(handler);
  }

  disconnect(): void {}

  emit(event: AgentEvent): void {
    for (const h of [...this.handlers]) h(event);
  }
}

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

const mockConfig: ResolvedConfig = {
  env: 'local.test',
  aab: {
    socketUrl: 'http://localhost:4000',
    bffUrl: 'https://local.gasket.dev-godaddy.com:8443',
    controlPlaneUrl: 'http://localhost:4001',
  },
  gocode: {
    baseUrl: 'http://gocode',
    apiKey: 'key',
    model: 'claude-sonnet-4-6',
  },
  eval: {
    defaultTrials: 1,
    maxTurns: 5,
    turnTimeoutMs: 5_000,
    firstTurnInactivityMs: 600_000,
    firstTurnRetryScheduleMs: [600_000, 120_000, 120_000, 120_000],
    maxFirstTurnRetries: 2,
    maxConcurrency: 1,
  },
  playwright: { ignoreHttpsErrors: true },
  regression: { thresholds: {}, defaultThreshold: 0.1 },
};

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [{ description: 'build a page', assertion: 'positive' }],
    evaluators: [],
    trials: 1,
    setup: vi.fn().mockResolvedValue(undefined),
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSnapshotMeta(): {
  url: string;
  screenshotPath: string;
  htmlPath: string;
  timestamp: string;
  consoleLogs: { type: string; text: string }[];
} {
  return {
    url: 'https://localhost:5001',
    screenshotPath: '/tmp/trials/0/snapshots/0.png',
    htmlPath: '/tmp/trials/0/snapshots/0.html',
    timestamp: new Date().toISOString(),
    consoleLogs: [],
  };
}

// Auto-responding agent: emits 'complete' after each send() via a
// queued microtask, so the simulation's onMessage handler is
// registered before the event fires.
function makeAutoAgent(response = 'done'): MockAgentClient {
  const agent = new MockAgentClient();
  const origSend = agent.send.bind(agent);
  agent.send = vi.fn().mockImplementation((msg: string) => {
    origSend(msg);
    Promise.resolve().then(() =>
      agent.emit({ type: 'complete', content: response }),
    );
  });
  return agent;
}

describe('Simulation', () => {
  let agentClient: MockAgentClient;

  beforeEach(() => {
    agentClient = new MockAgentClient();
  });

  it('calls setup() before first nextMessage()', async () => {
    const callOrder: string[] = [];
    const scenario = makeScenario({
      setup: vi.fn().mockImplementation(async () => {
        callOrder.push('setup');
      }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockImplementation(async () => {
        callOrder.push('nextMessage');
        return null;
      }),
    };

    await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(callOrder.indexOf('setup')).toBeLessThan(
      callOrder.indexOf('nextMessage'),
    );
  });

  it('calls teardown() after the loop ends', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };

    await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(scenario.teardown).toHaveBeenCalledOnce();
  });

  it('terminates immediately when syntheticUser returns null', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };

    const transcript = await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(transcript.turns).toHaveLength(0);
    expect(agentClient.sent).toHaveLength(0);
  });

  it('records user turn before agent response', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('build me a landing page')
        .mockResolvedValue(null),
    };
    const agent = makeAutoAgent('Here is your page.');

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(transcript.turns[0].role).toBe('user');
    expect(transcript.turns[0].content).toBe('build me a landing page');
  });

  it('records assistant turn from complete event', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = makeAutoAgent('Here is your page.');

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].content).toBe('Here is your page.');
  });

  it('terminates after maxTurns even if syntheticUser keeps responding', async () => {
    const config = {
      ...mockConfig,
      eval: { ...mockConfig.eval, defaultTrials: 1, maxTurns: 2, turnTimeoutMs: 5_000 },
    };
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue('keep going'),
    };
    const agent = makeAutoAgent();

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns).toHaveLength(2);
  });

  it('records error events in the transcript', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    // Agent emits an error followed by complete on each send().
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({ type: 'error', error: 'tool failed' });
        agent.emit({ type: 'complete', content: 'done anyway' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(transcript.errors).toContain('tool failed');
  });

  it(
    'emits console.warn on 429 error with eval.maxConcurrency hint ' +
      'and trial index',
    async () => {
      const scenario = makeScenario();
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockResolvedValueOnce('hello')
          .mockResolvedValue(null),
      };
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const agent = new MockAgentClient();
      agent.send = vi.fn().mockImplementation((msg: string) => {
        agent.sent.push(msg);
        Promise.resolve().then(() => {
          agent.emit({ type: 'error', error: '429 Too Many Requests' });
          agent.emit({ type: 'complete', content: 'done' });
        });
      });

      const transcript = await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        config: mockConfig,
      }).run(2);

      expect(warnSpy).toHaveBeenCalledOnce();
      const warnArg = warnSpy.mock.calls[0][0] as string;
      expect(warnArg).toContain('eval.maxConcurrency');
      expect(warnArg).toContain('2');
      expect(transcript.errors).toContain('429 Too Many Requests');
      warnSpy.mockRestore();
    },
  );

  it('does not emit console.warn for non-rate-limit errors', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({ type: 'error', error: 'tool failed' });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it(
    'captures a single snapshot after the conversation completes',
    async () => {
      const scenario = makeScenario({
        setup: vi.fn().mockResolvedValue({ appId: 'test-app' }),
      });
      // 2-turn conversation — capture must still be called once,
      // not once per turn.
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockResolvedValueOnce('hello')
          .mockResolvedValueOnce('second turn')
          .mockResolvedValue(null),
      };
      const mockSiteCapture = {
        capture: vi.fn().mockResolvedValue({
          snapshot: makeSnapshotMeta(),
        }),
      };
      const agent = makeAutoAgent();
      const getTrialOutputDir = vi
        .fn()
        .mockResolvedValue('/tmp/trials/0');
      const captureContext: SimulationCaptureContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        siteCapture: mockSiteCapture as any,
        getTrialOutputDir,
      };

      const transcript = await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        captureContext,
        config: mockConfig,
      }).run(0);

      expect(mockSiteCapture.capture).toHaveBeenCalledOnce();
      expect(mockSiteCapture.capture).toHaveBeenCalledWith(
        { appId: 'test-app' },
        '/tmp/trials/0',
      );
      expect(transcript.snapshots).toHaveLength(1);
    },
  );

  it('captures snapshot before teardown', async () => {
    const callOrder: string[] = [];
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ appId: 'app' }),
      teardown: vi.fn().mockImplementation(async () => {
        callOrder.push('teardown');
      }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const mockSiteCapture = {
      capture: vi.fn().mockImplementation(async () => {
        callOrder.push('snapshot');
        return { snapshot: makeSnapshotMeta() };
      }),
    };
    const agent = makeAutoAgent();
    const getTrialOutputDir = vi
      .fn()
      .mockResolvedValue('/tmp/trials/0');
    const captureContext: SimulationCaptureContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      siteCapture: mockSiteCapture as any,
      getTrialOutputDir,
    };

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      captureContext,
      config: mockConfig,
    }).run(0);

    expect(callOrder).toEqual(['snapshot', 'teardown']);
  });

  it('attaches capturedSite to transcript when present', async () => {
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ appId: 'app' }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const capturedSite = {
      previewUrl: 'https://example.com',
      generatedAt: new Date().toISOString(),
      durationMs: 100,
      outputDir: '/tmp/trials/0/snapshots',
      routes: [],
      perRoute: [],
      errors: [],
    };
    const mockSiteCapture = {
      capture: vi.fn().mockResolvedValue({
        snapshot: makeSnapshotMeta(),
        capturedSite,
      }),
    };
    const agent = makeAutoAgent();
    const getTrialOutputDir = vi
      .fn()
      .mockResolvedValue('/tmp/trials/0');
    const captureContext: SimulationCaptureContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      siteCapture: mockSiteCapture as any,
      getTrialOutputDir,
    };

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      captureContext,
      config: mockConfig,
    }).run(0);

    expect(transcript.capturedSite).toEqual(capturedSite);
  });

  it(
    'calls teardown even when site capture throws',
    async () => {
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const scenario = makeScenario({
        setup: vi.fn().mockResolvedValue({ appId: 'app' }),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockResolvedValueOnce('hello')
          .mockResolvedValue(null),
      };
      const mockSiteCapture = {
        capture: vi
          .fn()
          .mockRejectedValue(new Error('browser crash')),
      };
      const agent = makeAutoAgent();
      const captureContext: SimulationCaptureContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        siteCapture: mockSiteCapture as any,
        getTrialOutputDir: vi.fn().mockResolvedValue('/tmp/trials/0'),
      };

      await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        captureContext,
        config: mockConfig,
      }).run(0);

      expect(scenario.teardown).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    },
  );

  it('sets trialIndex and scenarioName in the transcript', async () => {
    const scenario = makeScenario({ name: 'my-scenario' });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };

    const transcript = await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(3);

    expect(transcript.scenarioName).toBe('my-scenario');
    expect(transcript.trialIndex).toBe(3);
  });

  it('records tool calls from tool_start and tool_result events', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'create-page', input: { title: 'x' } },
        });
        agent.emit({
          type: 'tool_result',
          tool: {
            id: 'tc-1',
            name: 'create-page',
            output: { url: '/page/1' },
          },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].toolCalls).toHaveLength(1);
    expect(assistantTurns[0].toolCalls[0].name).toBe('create-page');
    expect(assistantTurns[0].toolCalls[0].input).toEqual({ title: 'x' });
    expect(assistantTurns[0].toolCalls[0].output).toEqual({ url: '/page/1' });
  });

  it('accumulates tool_input_delta events into parsed tool call input', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'create-page', input: {} },
        });
        // JSON arrives in fragments: {"title": + "landing page"}
        agent.emit({
          type: 'tool_input_delta',
          tool: { id: 'tc-1', name: 'create-page' },
          delta: '{"title":',
        });
        agent.emit({
          type: 'tool_input_delta',
          tool: { id: 'tc-1', name: 'create-page' },
          delta: '"landing page"}',
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'create-page', output: 'ok' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurn?.toolCalls[0].input).toEqual(
      { title: 'landing page' },
    );
  });

  it('falls back to tool_start input when accumulated deltas are malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'create-page', input: {} },
        });
        agent.emit({
          type: 'tool_input_delta',
          tool: { id: 'tc-1', name: 'create-page' },
          delta: '{invalid json',
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'create-page', output: 'ok' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurn?.toolCalls[0].input).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Malformed tool_input_delta JSON for tool tc-1'),
    );
    warnSpy.mockRestore();
  });

  it('clears input deltas between turns so turn 2 is not contaminated by turn 1', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')
        .mockResolvedValue(null),
    };
    let callCount = 0;
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      const turn = ++callCount;
      Promise.resolve().then(() => {
        if (turn === 1) {
          agent.emit({
            type: 'tool_start',
            tool: { id: 'tc-1', name: 'tool-a', input: {} },
          });
          agent.emit({
            type: 'tool_input_delta',
            tool: { id: 'tc-1', name: 'tool-a' },
            delta: '{"key":"val1"}',
          });
          agent.emit({
            type: 'tool_result',
            tool: { id: 'tc-1', name: 'tool-a' },
          });
        } else {
          // Turn 2: same tool id, no deltas — input should be {}
          agent.emit({
            type: 'tool_start',
            tool: { id: 'tc-1', name: 'tool-a', input: {} },
          });
          agent.emit({
            type: 'tool_result',
            tool: { id: 'tc-1', name: 'tool-a' },
          });
        }
        agent.emit({ type: 'complete', content: `done ${turn}` });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].toolCalls[0].input).toEqual({ key: 'val1' });
    expect(assistantTurns[1].toolCalls[0].input).toEqual({});
  });

  it('second call with same tool ID in same turn keeps its tool_start input', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        // First call: tool_start + delta + tool_result
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'create-page', input: { title: 'first' } },
        });
        agent.emit({
          type: 'tool_input_delta',
          tool: { id: 'tc-1', name: 'create-page' },
          delta: '{"title":"from delta"}',
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'create-page', output: 'ok' },
        });
        // Second call: same ID, no deltas — must keep tool_start input
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'create-page', input: { title: 'second' } },
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'create-page', output: 'ok2' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    // currentTurnTools is keyed by ID, so tc-1 is overwritten by the
    // second call; the second tool_start input must not be contaminated
    // by the first call's accumulated delta.
    expect(assistantTurn?.toolCalls[0].input).toEqual({ title: 'second' });
  });

  it('warns when empty-string delta is accumulated and parse fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'create-page', input: { fallback: true } },
        });
        // Empty-string delta: accumulated becomes "" which is falsy
        // but should still enter the parse path
        agent.emit({
          type: 'tool_input_delta',
          tool: { id: 'tc-1', name: 'create-page' },
          delta: '',
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'create-page', output: 'ok' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    // JSON.parse("") throws, so tool_start input is preserved
    expect(assistantTurn?.toolCalls[0].input).toEqual({ fallback: true });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Malformed tool_input_delta JSON for tool tc-1'),
    );
    warnSpy.mockRestore();
  });

  it('cleans up orphaned inputDeltas when tool_result has no matching tool_start', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        // Orphaned sequence: delta + result with no prior tool_start
        agent.emit({
          type: 'tool_input_delta',
          tool: { id: 'tc-orphan', name: 'create-page' },
          delta: '{"stale":"data"}',
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-orphan', name: 'create-page', output: 'ok' },
        });
        // Valid sequence with the same ID: tool_start + result (no deltas)
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-orphan', name: 'create-page', input: { title: 'real' } },
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-orphan', name: 'create-page', output: 'ok2' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    // The stale delta from the orphaned sequence must not bleed into
    // the valid tool call. Input should be the tool_start value.
    expect(assistantTurn?.toolCalls[0].input).toEqual({ title: 'real' });
  });

  it('calls configure() with setup result before turn loop', async () => {
    const setupCtx = { appId: 'my-app' };
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue(setupCtx),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };
    const agent = makeAutoAgent();
    const configureSpy = vi.spyOn(agent, 'configure');

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(configureSpy).toHaveBeenCalledOnce();
    expect(configureSpy).toHaveBeenCalledWith(setupCtx);
  });

  it('calls configure() with empty object when setup returns void', async () => {
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue(undefined),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };
    const agent = makeAutoAgent();
    const configureSpy = vi.spyOn(agent, 'configure');

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(configureSpy).toHaveBeenCalledOnce();
    expect(configureSpy).toHaveBeenCalledWith({});
  });

  it(
    'does not include raw error content in rate-limit warning',
    async () => {
      const scenario = makeScenario();
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockResolvedValueOnce('hello')
          .mockResolvedValue(null),
      };
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const sensitiveError = '429 rate limit: token=sk-secret-abc123';
      const agent = new MockAgentClient();
      agent.send = vi.fn().mockImplementation((msg: string) => {
        agent.sent.push(msg);
        Promise.resolve().then(() => {
          agent.emit({ type: 'error', error: sensitiveError });
          agent.emit({ type: 'complete', content: 'done' });
        });
      });

      await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        config: mockConfig,
      }).run(0);

      expect(warnSpy).toHaveBeenCalledOnce();
      const warnArg = warnSpy.mock.calls[0][0] as string;
      expect(warnArg).not.toContain('sk-secret-abc123');
      expect(warnArg).not.toContain('token=');
      warnSpy.mockRestore();
    },
  );

  it(
    'wraps setup() rejection with scenario name and trial index',
    async () => {
      const scenario = makeScenario({
        name: 'my-scenario',
        setup: vi.fn().mockRejectedValue(
          new Error('network timeout'),
        ),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi.fn(),
      };

      await expect(
        new Simulation({
          scenario,
          agentClient,
          syntheticUser,
          config: mockConfig,
        }).run(3),
      ).rejects.toThrow(
        '[my-scenario] setup failed on trial 3: network timeout',
      );
    },
  );

  it('calls teardown() even when a turn times out', async () => {
    vi.useFakeTimers();
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue('hello'),
    };
    // Agent never emits 'complete'.
    const agent = new MockAgentClient();
    agent.send = vi.fn();

    const config = {
      ...mockConfig,
      eval: { ...mockConfig.eval, turnTimeoutMs: 5_000 },
    };

    const runPromise = new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config,
    }).run(0);

    // Attach the rejection handler before advancing timers so the
    // rejection is never "unhandled" between the two awaits.
    const assertion = expect(runPromise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;

    expect(scenario.teardown).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it(
    'does not mask simulation error when teardown also throws',
    async () => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const scenario = makeScenario({
        name: 'leaky-scenario',
        teardown: vi
          .fn()
          .mockRejectedValue(new Error('deleteApp 503')),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockRejectedValue(new Error('simulation boom')),
      };

      await expect(
        new Simulation({
          scenario,
          agentClient,
          syntheticUser,
          config: mockConfig,
        }).run(2),
      ).rejects.toThrow('simulation boom');

      expect(errorSpy).toHaveBeenCalledOnce();
      const [fmt, name, trial, rawErr] = errorSpy.mock.calls[0];
      expect(fmt).toContain('teardown failed');
      expect(name).toBe('leaky-scenario');
      expect(trial).toBe(2);
      expect(rawErr).toBeInstanceOf(Error);
      expect((rawErr as Error).message).toBe('deleteApp 503');
      errorSpy.mockRestore();
    },
  );

  it(
    'records teardown error in transcript.errors on successful run',
    async () => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const scenario = makeScenario({
        name: 'leak-scenario',
        teardown: vi
          .fn()
          .mockRejectedValue(new Error('deleteApp 503')),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockResolvedValueOnce('hello')
          .mockResolvedValue(null),
      };
      const agent = makeAutoAgent();

      const transcript = await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        config: mockConfig,
      }).run(1);

      expect(transcript.errors).toContainEqual(
        expect.stringContaining('teardown failed'),
      );
      expect(transcript.errors).toContainEqual(
        expect.stringContaining('deleteApp 503'),
      );
      expect(transcript.errors).toContainEqual(
        expect.stringContaining('leak-scenario'),
      );
      errorSpy.mockRestore();
    },
  );

  it(
    'passes setupResult to teardown when turn loop throws',
    async () => {
      const setupCtx = { appId: 'leak-check', previewUrl: 'http://test' };
      const scenario = makeScenario({
        name: 'teardown-ctx',
        setup: vi.fn().mockResolvedValue(setupCtx),
        teardown: vi.fn().mockResolvedValue(undefined),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockRejectedValue(new Error('turn boom')),
      };

      await expect(
        new Simulation({
          scenario,
          agentClient,
          syntheticUser,
          config: mockConfig,
        }).run(0),
      ).rejects.toThrow('turn boom');

      expect(scenario.teardown).toHaveBeenCalledOnce();
      expect(scenario.teardown).toHaveBeenCalledWith(setupCtx);
    },
  );

  it(
    'does not mask setup error when teardown also throws',
    async () => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const scenario = makeScenario({
        name: 'double-fault',
        setup: vi
          .fn()
          .mockRejectedValue(new Error('provision failed')),
        teardown: vi
          .fn()
          .mockRejectedValue(new Error('deleteApp 503')),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi.fn(),
      };

      await expect(
        new Simulation({
          scenario,
          agentClient,
          syntheticUser,
          config: mockConfig,
        }).run(1),
      ).rejects.toThrow('provision failed');

      expect(scenario.teardown).toHaveBeenCalledOnce();
      expect(scenario.teardown).toHaveBeenCalledWith({});
      expect(errorSpy).toHaveBeenCalledOnce();
      const [fmt, name, trial, rawErr] = errorSpy.mock.calls[0];
      expect(fmt).toContain('teardown failed');
      expect(name).toBe('double-fault');
      expect(trial).toBe(1);
      expect(rawErr).toBeInstanceOf(Error);
      expect((rawErr as Error).message).toBe('deleteApp 503');
      errorSpy.mockRestore();
    },
  );

  it('synthesizes content from commitHash when complete content is empty', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('build')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({
          type: 'complete',
          content: '',
          data: { commitHash: 'abc123', agentId: 'develop' },
        });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].content).toBe(
      '[Build complete by develop — commit abc123]',
    );
  });

  it('defaults agentId to "develop" in synthesis when absent', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('build')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({
          type: 'complete',
          content: '',
          data: { commitHash: 'def456' },
        });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].content).toBe(
      '[Build complete by develop — commit def456]',
    );
  });

  it('uses step_complete content when complete content is empty', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('build')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({ type: 'step_complete', content: 'step result' });
        agent.emit({ type: 'complete', content: '' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].content).toBe('step result');
  });

  it('uses last step_complete when multiple arrive before complete', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('build')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({ type: 'step_complete', content: 'first agent' });
        agent.emit({ type: 'step_complete', content: 'develop agent' });
        agent.emit({ type: 'complete', content: '' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].content).toBe('develop agent');
  });

  it('does not bleed step_complete content from a previous turn', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')
        .mockResolvedValue(null),
    };
    let callCount = 0;
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      const turn = ++callCount;
      Promise.resolve().then(() => {
        if (turn === 1) {
          agent.emit({ type: 'step_complete', content: 'step result' });
        }
        agent.emit({ type: 'complete', content: '' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].content).toBe('step result');
    expect(assistantTurns[1].content).toBe('');
  });

  it('step_start sets agentId on subsequent tool calls', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({ type: 'step_start', agentName: 'develop' });
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'createFile' },
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'createFile', output: 'ok' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurn?.toolCalls[0].agentId).toBe('develop');
  });

  it('agentId is undefined on tool calls without a preceding step_start',
    async () => {
      const scenario = makeScenario();
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi
          .fn()
          .mockResolvedValueOnce('hello')
          .mockResolvedValue(null),
      };
      const agent = new MockAgentClient();
      agent.send = vi.fn().mockImplementation((msg: string) => {
        agent.sent.push(msg);
        Promise.resolve().then(() => {
          agent.emit({
            type: 'tool_start',
            tool: { id: 'tc-1', name: 'createFile' },
          });
          agent.emit({
            type: 'tool_result',
            tool: { id: 'tc-1', name: 'createFile', output: 'ok' },
          });
          agent.emit({ type: 'complete', content: 'done' });
        });
      });

      const transcript = await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        config: mockConfig,
      }).run(0);

      const assistantTurn = transcript.turns.find(
        (t) => t.role === 'assistant',
      );
      expect(assistantTurn?.toolCalls[0].agentId).toBeUndefined();
    },
  );

  it('multi-agent turn tags each tool call with its active agent', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      Promise.resolve().then(() => {
        agent.emit({ type: 'step_start', agentName: 'initial' });
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-1', name: 'planPage' },
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-1', name: 'planPage', output: 'ok' },
        });
        agent.emit({ type: 'step_start', agentName: 'develop' });
        agent.emit({
          type: 'tool_start',
          tool: { id: 'tc-2', name: 'createFile' },
        });
        agent.emit({
          type: 'tool_result',
          tool: { id: 'tc-2', name: 'createFile', output: 'ok' },
        });
        agent.emit({ type: 'complete', content: 'done' });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurn = transcript.turns.find(
      (t) => t.role === 'assistant',
    );
    const toolCalls = assistantTurn?.toolCalls ?? [];
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].agentId).toBe('initial');
    expect(toolCalls[1].agentId).toBe('develop');
  });

  it('clears tool calls between turns', async () => {
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('first message')
        .mockResolvedValueOnce('second message')
        .mockResolvedValue(null),
    };
    let callCount = 0;
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation((msg: string) => {
      agent.sent.push(msg);
      const turn = ++callCount;
      Promise.resolve().then(() => {
        if (turn === 1) {
          agent.emit({
            type: 'tool_start',
            tool: { id: 'tc-1', name: 'tool-a' },
          });
          agent.emit({
            type: 'tool_result',
            tool: { id: 'tc-1', name: 'tool-a' },
          });
        }
        agent.emit({ type: 'complete', content: `done ${turn}` });
      });
    });

    const transcript = await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    const assistantTurns = transcript.turns.filter(
      (t) => t.role === 'assistant',
    );
    expect(assistantTurns[0].toolCalls).toHaveLength(1);
    // Second turn had no tool events — toolCalls should be empty
    expect(assistantTurns[1].toolCalls).toHaveLength(0);
  });
});

describe('preview URL pre-warm', () => {
  let agentClient: MockAgentClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agentClient = new MockAgentClient();
    fetchSpy = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    'fires fetch to previewUrl when siteCapture present ' +
      'and setupResult has previewUrl',
    async () => {
      const previewUrl = 'https://preview.local:5001';
      const scenario = makeScenario({
        setup: vi.fn().mockResolvedValue({ previewUrl }),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi.fn().mockResolvedValue(null),
      };
      const mockSiteCapture = {
        capture: vi.fn().mockResolvedValue({
          snapshot: makeSnapshotMeta(),
        }),
      };

      const captureContext: SimulationCaptureContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        siteCapture: mockSiteCapture as any,
        getTrialOutputDir: vi.fn().mockResolvedValue('/tmp/trials/0'),
      };

      await new Simulation({
        scenario,
        agentClient,
        syntheticUser,
        captureContext,
        config: mockConfig,
      }).run(0);

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        previewUrl,
        expect.objectContaining({ signal: expect.anything() }),
      );
    },
  );

  it(
    'does not fire pre-warm when setupResult has no previewUrl',
    async () => {
      const scenario = makeScenario({
        setup: vi.fn().mockResolvedValue({ appId: 'app' }),
      });
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi.fn().mockResolvedValue(null),
      };
      const mockSiteCapture = {
        capture: vi.fn().mockResolvedValue({
          snapshot: makeSnapshotMeta(),
        }),
      };

      const captureContext: SimulationCaptureContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        siteCapture: mockSiteCapture as any,
        getTrialOutputDir: vi.fn().mockResolvedValue('/tmp/trials/0'),
      };

      await new Simulation({
        scenario,
        agentClient,
        syntheticUser,
        captureContext,
        config: mockConfig,
      }).run(0);

      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('does not fire pre-warm when siteCapture is absent', async () => {
    const previewUrl = 'https://preview.local:5001';
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ previewUrl }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };

    await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not throw when pre-warm fetch rejects', async () => {
    const previewUrl = 'https://preview.local:5001';
    fetchSpy.mockRejectedValue(new Error('network error'));
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ previewUrl }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };
    const mockSiteCapture = {
      capture: vi.fn().mockResolvedValue({
        snapshot: makeSnapshotMeta(),
      }),
    };

    const captureContext: SimulationCaptureContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      siteCapture: mockSiteCapture as any,
      getTrialOutputDir: vi.fn().mockResolvedValue('/tmp/trials/0'),
    };

    await expect(
      new Simulation({
        scenario,
        agentClient,
        syntheticUser,
        captureContext,
        config: mockConfig,
      }).run(0),
    ).resolves.toBeDefined();
  });
});

describe('fatal AAB error abort', () => {
  it(
    'aborts immediately when AAB disconnects mid-turn',
    async () => {
      const scenario = makeScenario();
      const syntheticUser: SyntheticUserAgent = {
        nextMessage: vi.fn().mockResolvedValue('hello'),
      };
      // Agent emits a disconnect error with no 'complete' —
      // the simulation must abort instead of waiting for the
      // turn timeout.
      const agent = new MockAgentClient();
      agent.send = vi.fn().mockImplementation(
        (msg: string) => {
          agent.sent.push(msg);
          Promise.resolve().then(() => {
            agent.emit({
              type: 'error',
              error:
                'AAB disconnected: io server disconnect',
            });
          });
        },
      );

      const config = {
        ...mockConfig,
        eval: {
          ...mockConfig.eval,
          turnTimeoutMs: 60_000,
        },
      };

      const transcript = await new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        config,
      }).run(0);

      expect(transcript.errors).toContain(
        'AAB disconnected: io server disconnect',
      );
      const userTurns = transcript.turns.filter(
        (t) => t.role === 'user',
      );
      const assistantTurns = transcript.turns.filter(
        (t) => t.role === 'assistant',
      );
      expect(userTurns).toHaveLength(1);
      expect(assistantTurns).toHaveLength(0);
      expect(scenario.teardown).toHaveBeenCalledOnce();
    },
  );
});

describe('isFatalError', () => {
  it.each([
    ['AAB disconnected: io server disconnect'],
    ['AAB disconnected: transport close'],
    ['unauthorized access'],
    ['Unauthorized'],
    ['S2S token expired'],
    ['s2s token invalid'],
  ])('returns true for "%s"', (msg) => {
    expect(isFatalError(msg)).toBe(true);
  });

  it.each([
    ['some random error'],
    ['429 rate limit'],
    [''],
    ['connection reset'],
  ])('returns false for "%s"', (msg) => {
    expect(isFatalError(msg)).toBe(false);
  });
});

describe('GoalTracker integration', () => {
  let agentClient: MockAgentClient;

  beforeEach(() => {
    agentClient = new MockAgentClient();
  });

  it('passes GoalTracker as third arg to nextMessage', async () => {
    const scenario = makeScenario();
    let capturedTracker: unknown;
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockImplementation(
        async (
          _history: unknown,
          _scenario: unknown,
          tracker: unknown,
        ) => {
          capturedTracker = tracker;
          return null;
        },
      ),
    };

    await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(capturedTracker).toBeInstanceOf(GoalTracker);
  });

  it('marks goals in order across turns', async () => {
    const goals: ScenarioGoal[] = [
      { description: 'goal one', assertion: 'positive' },
      { description: 'goal two', assertion: 'positive' },
    ];
    const scenario = makeScenario({ goals });
    // Capture nextGoal() at the time each call is made — before the
    // simulation marks the active goal as requested.
    const seenGoals: (ScenarioGoal | null)[] = [];
    let callCount = 0;
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockImplementation(
        async (
          _history: unknown,
          _scenario: unknown,
          tracker?: GoalTracker,
        ) => {
          seenGoals.push(tracker?.nextGoal() ?? null);
          return ++callCount <= 2 ? 'message' : null;
        },
      ),
    };
    const agent = makeAutoAgent();

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    // Turn 1: goal one is active, not yet marked
    expect(seenGoals[0]).toEqual(goals[0]);
    // Turn 2: goal one was marked after turn 1, goal two is active
    expect(seenGoals[1]).toEqual(goals[1]);
    // Turn 3: all goals marked, nextGoal returns null
    expect(seenGoals[2]).toBeNull();
  });

  it('runs normally when scenario has no positive goals', async () => {
    const scenario = makeScenario({
      goals: [
        { description: 'avoid X', assertion: 'negative' },
      ],
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue(null),
    };

    const transcript = await new Simulation({
      scenario,
      agentClient,
      syntheticUser,
      config: mockConfig,
    }).run(0);

    expect(transcript.turns).toHaveLength(0);
  });
});

describe('first-turn inactivity timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws InactivityTimeoutError when no events arrive on first turn', async () => {
    vi.useFakeTimers();
    const config: ResolvedConfig = {
      ...mockConfig,
      eval: {
        ...mockConfig.eval,
        turnTimeoutMs: 900_000,
        firstTurnInactivityMs: 10_000,
      },
    };
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue('hello'),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn();

    const runPromise = new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config,
    }).run(0);

    const assertion = expect(runPromise).rejects.toThrow(
      InactivityTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(scenario.teardown).toHaveBeenCalledOnce();
  });

  it('resets the timer when an event arrives', async () => {
    vi.useFakeTimers();
    const config: ResolvedConfig = {
      ...mockConfig,
      eval: {
        ...mockConfig.eval,
        turnTimeoutMs: 900_000,
        firstTurnInactivityMs: 10_000,
      },
    };
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue('hello'),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn();

    const runPromise = new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config,
    }).run(0);

    // Advance to just before the deadline and emit an event
    await vi.advanceTimersByTimeAsync(9_000);
    agent.emit({ type: 'chunk', content: 'hi' });

    // Advance past the original deadline (10_000) but within reset window
    await vi.advanceTimersByTimeAsync(5_000);
    // No error yet since timer was reset at 9_000

    // Advance to trigger the reset deadline (9_000 + 10_000 = 19_000)
    const assertion = expect(runPromise).rejects.toThrow(
      InactivityTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('does not apply inactivity timeout on subsequent turns', async () => {
    vi.useFakeTimers();
    const config: ResolvedConfig = {
      ...mockConfig,
      eval: {
        ...mockConfig.eval,
        maxTurns: 2,
        turnTimeoutMs: 20_000,
        firstTurnInactivityMs: 5_000,
      },
    };
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue('hello'),
    };
    // Turn 1: responds immediately. Turn 2: never responds.
    let callCount = 0;
    const agent = new MockAgentClient();
    agent.send = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        Promise.resolve().then(() => {
          agent.emit({ type: 'complete', content: 'done' });
        });
      }
      // Turn 2: silence
    });

    const runPromise = new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config,
    }).run(0);

    // Advance past inactivity timeout but not hard timeout
    await vi.advanceTimersByTimeAsync(10_000);
    // If inactivity applied to turn 2, it would have fired at 5_000ms.
    // Instead, it should wait for the hard timeout at 20_000ms.

    const assertion = expect(runPromise).rejects.toThrow(
      'timed out after 20000ms',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('hard timeout fires first when smaller than inactivity timeout', async () => {
    vi.useFakeTimers();
    const config: ResolvedConfig = {
      ...mockConfig,
      eval: {
        ...mockConfig.eval,
        turnTimeoutMs: 3_000,
        firstTurnInactivityMs: 10_000,
      },
    };
    const scenario = makeScenario();
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi.fn().mockResolvedValue('hello'),
    };
    const agent = new MockAgentClient();
    agent.send = vi.fn();

    const runPromise = new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      config,
    }).run(0);

    const assertion = expect(runPromise).rejects.toThrow(
      'timed out after 3000ms',
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });
});

describe('onConversationComplete callback', () => {
  it('fires after conversation loop completes but before capture', async () => {
    const callOrder: string[] = [];
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ appId: 'app' }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const onConversationComplete = vi.fn().mockImplementation(async () => {
      callOrder.push('callback');
    });
    const mockSiteCapture = {
      capture: vi.fn().mockImplementation(async () => {
        callOrder.push('capture');
        return { snapshot: makeSnapshotMeta() };
      }),
    };
    const agent = makeAutoAgent();
    const captureContext: SimulationCaptureContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      siteCapture: mockSiteCapture as any,
      getTrialOutputDir: vi.fn().mockResolvedValue('/tmp/trials/0'),
    };

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      captureContext,
      config: mockConfig,
      onConversationComplete,
    }).run(0);

    expect(callOrder).toEqual(['callback', 'capture']);
  });

  it('receives partial transcript with turns but empty snapshots', async () => {
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ appId: 'app' }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    let capturedTranscript: Transcript | undefined;
    const onConversationComplete = vi
      .fn()
      .mockImplementation(async (_idx: number, t: Transcript) => {
        capturedTranscript = t;
      });
    const agent = makeAutoAgent('agent response');
    const mockSiteCapture = {
      capture: vi.fn().mockResolvedValue({ snapshot: makeSnapshotMeta() }),
    };
    const captureContext: SimulationCaptureContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      siteCapture: mockSiteCapture as any,
      getTrialOutputDir: vi.fn().mockResolvedValue('/tmp/trials/0'),
    };

    await new Simulation({
      scenario,
      agentClient: agent,
      syntheticUser,
      captureContext,
      config: mockConfig,
      onConversationComplete,
    }).run(2);

    expect(capturedTranscript).toBeDefined();
    expect(capturedTranscript!.turns.length).toBeGreaterThan(0);
    expect(capturedTranscript!.snapshots).toHaveLength(0);
    // trialIndex should match what was passed to run()
    expect(capturedTranscript!.trialIndex).toBe(2);
  });

  it('propagates onConversationComplete rejection to caller', async () => {
    const scenario = makeScenario({
      setup: vi.fn().mockResolvedValue({ appId: 'app' }),
    });
    const syntheticUser: SyntheticUserAgent = {
      nextMessage: vi
        .fn()
        .mockResolvedValueOnce('hello')
        .mockResolvedValue(null),
    };
    const onConversationComplete = vi
      .fn()
      .mockRejectedValue(new Error('write failed'));
    const agent = makeAutoAgent();

    await expect(
      new Simulation({
        scenario,
        agentClient: agent,
        syntheticUser,
        config: mockConfig,
        onConversationComplete,
      }).run(0),
    ).rejects.toThrow('write failed');

    expect(scenario.teardown).toHaveBeenCalledOnce();
  });
});

describe('InactivityGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arm() after dispose() is a no-op', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = new InactivityGuard(1_000, onTimeout);

    guard.arm();
    guard.dispose();
    guard.arm();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('arm() resets the timer on each call', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = new InactivityGuard(10_000, onTimeout);

    guard.arm();
    await vi.advanceTimersByTimeAsync(9_000);
    guard.arm();
    await vi.advanceTimersByTimeAsync(9_000);

    expect(onTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();

    guard.dispose();
  });
});
