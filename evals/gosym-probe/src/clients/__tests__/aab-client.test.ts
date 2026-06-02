import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentEvent } from '../agent-client.js';

const { socketHandlers, mockSocket } = vi.hoisted(() => {
  const socketHandlers: Record<string, (data: unknown) => void> = {};
  const mockSocket = {
    emit: vi.fn(),
    on: vi.fn(
      function (event: string, handler: (data: unknown) => void) {
        socketHandlers[event] = handler;
      },
    ),
    once: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    id: 'mock-socket-id',
    io: { uri: 'http://localhost:4000' },
  };
  return { socketHandlers, mockSocket };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(function () { return mockSocket; }),
}));

import { AABClient } from '../aab-client.js';

/** Fire a message event with the AAB wire format. */
function emit(
  type: string,
  content: string,
  data: Record<string, unknown>,
): void {
  socketHandlers['message']?.({ type, content, data });
}

/** Extract the payload from the last mockSocket.emit call. */
function lastEmitPayload(): Record<string, unknown> {
  const calls = mockSocket.emit.mock.calls;
  return calls[calls.length - 1]?.[1] as Record<string, unknown>;
}

describe('AABClient', () => {
  let client: AABClient;
  let received: AgentEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(socketHandlers)) {
      delete socketHandlers[key];
    }
    received = [];
    client = new AABClient({ socketUrl: 'http://localhost:4000' });
    client.onMessage((e) => received.push(e));
  });

  describe('send()', () => {
    it('emits chat_message event', () => {
      client.send('build me a landing page');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chat_message',
        expect.any(Object),
      );
    });

    it('emits exactly one socket event per send()', () => {
      client.send('hello');
      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
    });

    it('includes message field in payload', () => {
      client.send('build a page');
      expect(lastEmitPayload().message).toBe('build a page');
    });

    it('includes timestamp as ISO string', () => {
      client.send('hello');
      expect(lastEmitPayload().timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it('includes appId in context.metadata when configured', () => {
      client.configure({ appId: 'app-123' });
      client.send('build a page');
      const ctx = lastEmitPayload().context as {
        metadata: Record<string, unknown>;
      };
      expect(ctx.metadata.appId).toBe('app-123');
    });

    it('includes userId "current-user" in context.metadata', () => {
      client.send('hello');
      const ctx = lastEmitPayload().context as {
        metadata: Record<string, unknown>;
      };
      expect(ctx.metadata.userId).toBe('current-user');
    });

    it('includes sessionId equal to socket.id in context.metadata', () => {
      client.send('hello');
      const ctx = lastEmitPayload().context as {
        metadata: Record<string, unknown>;
      };
      expect(ctx.metadata.sessionId).toBe('mock-socket-id');
    });

    it('includes userTimezone string in context.metadata', () => {
      client.send('hello');
      const ctx = lastEmitPayload().context as {
        metadata: Record<string, unknown>;
      };
      expect(typeof ctx.metadata.userTimezone).toBe('string');
    });

    it(
      'includes conversation block with maxMessages and ' +
        'includeHistory',
      () => {
        client.send('hello');
        const ctx = lastEmitPayload().context as {
          conversation: Record<string, unknown>;
        };
        expect(ctx.conversation).toMatchObject({
          maxMessages: 10,
          includeHistory: true,
        });
      },
    );

    it(
      'omits conversationId from conversation before ' +
        'any conversation_info event',
      () => {
        client.send('hello');
        const ctx = lastEmitPayload().context as {
          conversation: Record<string, unknown>;
        };
        expect(ctx.conversation.conversationId).toBeUndefined();
      },
    );

    it('includes appContext block with all required fields', () => {
      client.send('hello');
      const ctx = lastEmitPayload().context as {
        appContext: Record<string, unknown>;
      };
      expect(ctx.appContext).toEqual({
        includeDirectoryListing: true,
        includePackageInfo: true,
        includeDependencyStatus: true,
        maxDirectoryDepth: 3,
      });
    });
  });

  describe('disconnect()', () => {
    it('disconnects the underlying socket', () => {
      client.disconnect();
      expect(mockSocket.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('socket disconnect handling', () => {
    it('ignores graceful client-initiated disconnect', () => {
      socketHandlers['disconnect']?.('io client disconnect');
      expect(received).toHaveLength(0);
    });

    it(
      'dispatches error event on server-initiated disconnect',
      () => {
        socketHandlers['disconnect']?.(
          'io server disconnect',
        );
        expect(received).toEqual([
          {
            type: 'error',
            error:
              'AAB disconnected: io server disconnect',
          },
        ]);
      },
    );

    it(
      'dispatches error event on transport close',
      () => {
        socketHandlers['disconnect']?.('transport close');
        expect(received).toEqual([
          {
            type: 'error',
            error: 'AAB disconnected: transport close',
          },
        ]);
      },
    );
  });

  describe('socket initialization', () => {
    it(
      'registers a single message handler ' +
        '(unified AAB wire format)',
      () => {
        const registered = mockSocket.on.mock.calls.map((c) => c[0]);
        expect(registered).toContain('message');
      },
    );
  });

  describe('conversationId tracking', () => {
    it(
      'includes conversationId in send() after ' +
        'conversation_info event',
      () => {
        emit('conversation_info', '', { conversationId: 'conv-abc' });
        client.send('follow up');
        const ctx = lastEmitPayload().context as {
          conversation: Record<string, unknown>;
        };
        expect(ctx.conversation.conversationId).toBe('conv-abc');
      },
    );

    it('resets conversationId in send() after configure()', () => {
      emit('conversation_info', '', { conversationId: 'conv-abc' });
      client.configure({ appId: 'app-456' });
      client.send('after reconfigure');
      const ctx = lastEmitPayload().context as {
        conversation: Record<string, unknown>;
      };
      expect(ctx.conversation.conversationId).toBeUndefined();
    });

    it(
      'does not dispatch conversation_info as an AgentEvent',
      () => {
        emit('conversation_info', '', { conversationId: 'conv-abc' });
        expect(received).toHaveLength(0);
      },
    );
  });

  describe('event mapping', () => {
    it('dispatches chunk events to handlers', () => {
      emit('chunk', 'hello', {});
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ type: 'chunk', content: 'hello' });
    });

    it(
      'enriches complete with accumulated chunks ' +
        'when content is empty',
      () => {
        emit('chunk', 'Here is ', {});
        emit('chunk', 'your page.', {});
        emit('complete', '', {});
        // Two chunk events + one complete event
        expect(received).toHaveLength(3);
        expect(received.at(-1)).toEqual({
          type: 'complete',
          content: 'Here is your page.',
        });
      },
    );

    it(
      'prefers complete content over accumulated chunks',
      () => {
        emit('chunk', 'streamed text', {});
        emit('complete', 'final text', {});
        // chunk event dispatched first, complete event dispatched last
        expect(received.at(-1)).toEqual({
          type: 'complete',
          content: 'final text',
        });
      },
    );

    it('resets accumulated chunks on send()', () => {
      emit('chunk', 'stale', {});
      client.send('new message');
      emit('complete', '', {});
      // chunk event + complete event; complete uses fresh accumulator
      expect(received.at(-1)).toEqual({
        type: 'complete',
        content: '',
      });
    });

    it('maps tool_start event with tool info', () => {
      emit('tool_start', 'Using read_file...', {
        tool: { id: 't1', name: 'read_file', input: { path: '/foo' } },
      });
      expect(received[0]).toMatchObject({
        type: 'tool_start',
        tool: { id: 't1', name: 'read_file', input: { path: '/foo' } },
      });
    });

    it('ignores tool_start when data.tool is absent', () => {
      emit('tool_start', '', {});
      expect(received).toHaveLength(0);
    });

    it('maps tool_call event', () => {
      emit('tool_call', 'write_file input ready', {
        tool: { id: 't2', name: 'write_file', input: {} },
      });
      expect(received[0]).toMatchObject({
        type: 'tool_call',
        tool: { id: 't2', name: 'write_file' },
      });
    });

    it('maps tool_input_delta event with delta', () => {
      emit('tool_input_delta', '', {
        toolId: 't3',
        toolName: 'search',
        delta: 'abc',
      });
      expect(received[0]).toMatchObject({
        type: 'tool_input_delta',
        tool: { id: 't3', name: 'search' },
        delta: 'abc',
      });
    });

    it('defaults delta to empty string when missing', () => {
      emit('tool_input_delta', '', {
        toolId: 't3',
        toolName: 'search',
      });
      const e = received[0];
      expect(e.type).toBe('tool_input_delta');
      if (e.type === 'tool_input_delta') {
        expect(e.delta).toBe('');
      }
    });

    it('maps tool_result event with output', () => {
      emit('tool_result', 'run_cmd completed', {
        tool: { id: 't4', name: 'run_cmd', output: 'exit 0' },
      });
      expect(received[0]).toMatchObject({
        type: 'tool_result',
        tool: { id: 't4', name: 'run_cmd', output: 'exit 0' },
      });
    });

    it('maps tool_result event with error field', () => {
      emit('tool_result', 'run_cmd completed', {
        tool: { id: 't5', name: 'run_cmd', error: 'exit 1' },
      });
      const e = received[0];
      expect(e.type).toBe('tool_result');
      if (e.type === 'tool_result') {
        expect(e.tool.error).toBe('exit 1');
      }
    });

    it('maps complete event', () => {
      emit('complete', 'All done', {});
      expect(received[0]).toEqual({
        type: 'complete',
        content: 'All done',
      });
    });

    it(
      'passes data field through on complete when ' +
        'payload data has entries',
      () => {
        emit('complete', 'done', {
          commitHash: 'abc123',
          agentId: 'develop',
          duration: 4200,
        });
        expect(received[0]).toEqual({
          type: 'complete',
          content: 'done',
          data: {
            commitHash: 'abc123',
            agentId: 'develop',
            duration: 4200,
          },
        });
      },
    );

    it(
      'omits data field on complete when payload data is empty',
      () => {
        emit('complete', 'done', {});
        expect(received[0]).toEqual({
          type: 'complete',
          content: 'done',
        });
      },
    );

    it('maps error event from content field', () => {
      emit('error', 'socket timeout', { error: 'socket timeout' });
      expect(received[0]).toEqual({
        type: 'error',
        error: 'socket timeout',
      });
    });

    it('falls back to data.error when content is empty', () => {
      emit('error', '', { error: 'connection lost' });
      expect(received[0]).toEqual({
        type: 'error',
        error: 'connection lost',
      });
    });

    it(
      'defaults error to "Unknown error" when content and ' +
        'data are empty',
      () => {
        emit('error', '', {});
        expect(received[0]).toEqual({
          type: 'error',
          error: 'Unknown error',
        });
      },
    );

    it(
      'maps agents_available event — agents is array of objects',
      () => {
        emit('agents_available', '', {
          agents: [
            { id: 'aab', name: 'aab' },
            { id: 'coder', name: 'coder' },
          ],
        });
        expect(received[0]).toEqual({
          type: 'agents_available',
          agents: ['aab', 'coder'],
        });
      },
    );

    it('dispatches step_complete event with content and data', () => {
      emit('step_complete', 'Agent response here', {
        agentId: 'develop',
        stepIndex: 1,
      });
      expect(received[0]).toEqual({
        type: 'step_complete',
        content: 'Agent response here',
        data: { agentId: 'develop', stepIndex: 1 },
      });
    });

    it(
      'dispatches step_complete without data when payload ' +
        'data is empty',
      () => {
        emit('step_complete', 'Agent response', {});
        expect(received[0]).toEqual({
          type: 'step_complete',
          content: 'Agent response',
        });
      },
    );

    it('dispatches step_start event with agentName', () => {
      emit('step_start', '', { agentName: 'develop' });
      expect(received[0]).toEqual({
        type: 'step_start',
        agentName: 'develop',
      });
    });

    it('dispatches step_start with empty agentName when absent', () => {
      emit('step_start', '', {});
      expect(received[0]).toEqual({
        type: 'step_start',
        agentName: '',
      });
    });

    it('ignores unknown event types silently', () => {
      emit('server_config', '', { config: {} });
      emit('catchup_status', '', {});
      expect(received).toHaveLength(0);
    });

    it('dispatches to all registered onMessage handlers', () => {
      const r2: AgentEvent[] = [];
      client.onMessage((e) => r2.push(e));
      emit('complete', 'hi', {});
      expect(received).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });
  });

  describe('diagnostic Socket.IO events (EVALS_OVER_SOCKET)', () => {
    function emitDirect(event: string, data: unknown): void {
      socketHandlers[event]?.(data);
    }

    it('registers stream.timing.summary handler', () => {
      const registered = mockSocket.on.mock.calls.map((c) => c[0]);
      expect(registered).toContain('stream.timing.summary');
    });

    it('registers stream.chunk.slow_gap handler', () => {
      const registered = mockSocket.on.mock.calls.map((c) => c[0]);
      expect(registered).toContain('stream.chunk.slow_gap');
    });

    it('registers stream.chunk.timeout handler', () => {
      const registered = mockSocket.on.mock.calls.map((c) => c[0]);
      expect(registered).toContain('stream.chunk.timeout');
    });

    it('dispatches stream_timing_summary with timing fields', () => {
      emitDirect('stream.timing.summary', {
        timeToStreamStartMs: 5000,
        timeToFirstTextChunkMs: 12000,
        maxChunkGapMs: 3000,
        chunksRead: 42,
        streamDurationMs: 18000,
        socketId: 'ignored',
        agentName: 'ignored',
      });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 5000,
        timeToFirstTextChunkMs: 12000,
        maxChunkGapMs: 3000,
        chunksRead: 42,
        streamDurationMs: 18000,
      });
    });

    it('dispatches stream_chunk_slow_gap with gap fields', () => {
      emitDirect('stream.chunk.slow_gap', {
        gapMs: 45000,
        chunksRead: 3,
        streamElapsedMs: 60000,
        socketId: 'ignored',
        modelName: 'ignored',
      });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: 'stream_chunk_slow_gap',
        gapMs: 45000,
        chunksRead: 3,
        streamElapsedMs: 60000,
      });
    });

    it('dispatches stream_chunk_timeout with timeout fields', () => {
      emitDirect('stream.chunk.timeout', {
        chunksRead: 5,
        streamElapsedMs: 125000,
        timeToFirstTextChunkMs: 8000,
        maxChunkGapMs: 120000,
        error: 'AbortError: chunk timeout',
        socketId: 'ignored',
      });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: 'stream_chunk_timeout',
        chunksRead: 5,
        streamElapsedMs: 125000,
        timeToFirstTextChunkMs: 8000,
        maxChunkGapMs: 120000,
        error: 'AbortError: chunk timeout',
      });
    });

    it('defaults error to empty string when absent', () => {
      emitDirect('stream.chunk.timeout', {
        chunksRead: 0,
        streamElapsedMs: 120000,
        timeToFirstTextChunkMs: 0,
        maxChunkGapMs: 0,
      });
      const e = received[0];
      expect(e.type).toBe('stream_chunk_timeout');
      if (e.type === 'stream_chunk_timeout') {
        expect(e.error).toBe('');
      }
    });

    it(
      'coerces non-numeric strings to 0 in ' +
        'stream.timing.summary',
      () => {
        emitDirect('stream.timing.summary', {
          timeToStreamStartMs: 'garbage',
          timeToFirstTextChunkMs: 'bad',
          maxChunkGapMs: 'nope',
          chunksRead: 'xyz',
          streamDurationMs: 'abc',
        });
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({
          type: 'stream_timing_summary',
          timeToStreamStartMs: 0,
          timeToFirstTextChunkMs: 0,
          maxChunkGapMs: 0,
          chunksRead: 0,
          streamDurationMs: 0,
        });
      },
    );

    it(
      'preserves null timeToFirstTextChunkMs in ' +
        'stream.timing.summary',
      () => {
        emitDirect('stream.timing.summary', {
          timeToStreamStartMs: 100,
          timeToFirstTextChunkMs: null,
          maxChunkGapMs: 50,
          chunksRead: 1,
          streamDurationMs: 200,
        });
        const e = received[0];
        expect(e.type).toBe('stream_timing_summary');
        if (e.type === 'stream_timing_summary') {
          expect(e.timeToFirstTextChunkMs).toBeNull();
        }
      },
    );

    it(
      'coerces non-numeric strings to 0 in ' +
        'stream.chunk.slow_gap',
      () => {
        emitDirect('stream.chunk.slow_gap', {
          gapMs: 'bad',
          chunksRead: 'bad',
          streamElapsedMs: 'bad',
        });
        expect(received[0]).toEqual({
          type: 'stream_chunk_slow_gap',
          gapMs: 0,
          chunksRead: 0,
          streamElapsedMs: 0,
        });
      },
    );

    it(
      'coerces non-numeric strings to 0 in ' +
        'stream.chunk.timeout',
      () => {
        emitDirect('stream.chunk.timeout', {
          chunksRead: 'bad',
          streamElapsedMs: 'bad',
          timeToFirstTextChunkMs: 'bad',
          maxChunkGapMs: 'bad',
          error: 'some error',
        });
        expect(received[0]).toEqual({
          type: 'stream_chunk_timeout',
          chunksRead: 0,
          streamElapsedMs: 0,
          timeToFirstTextChunkMs: 0,
          maxChunkGapMs: 0,
          error: 'some error',
        });
      },
    );

    it('registers token.usage.summary handler', () => {
      const registered = mockSocket.on.mock.calls.map((c) => c[0]);
      expect(registered).toContain('token.usage.summary');
    });

    it('dispatches token_usage_summary with all fields', () => {
      emitDirect('token.usage.summary', {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200,
        cachedInputTokensWrite: 100,
        modelName: 'claude-sonnet-4-6',
        totalCost: 0.0045,
        inputCost: 0.003,
        outputCost: 0.0015,
        cachedInputCost: 0.0001,
        savings: 0.0002,
        currency: 'USD',
        socketId: 'ignored',
      });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: 'token_usage_summary',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokensRead: 200,
        cachedInputTokensWrite: 100,
        modelName: 'claude-sonnet-4-6',
        totalCost: 0.0045,
        inputCost: 0.003,
        outputCost: 0.0015,
        cachedInputCost: 0.0001,
        savings: 0.0002,
        currency: 'USD',
      });
    });

    it(
      'coerces non-numeric values to 0 in token.usage.summary',
      () => {
        emitDirect('token.usage.summary', {
          inputTokens: 'bad',
          outputTokens: 'bad',
          totalTokens: 'bad',
          cachedInputTokensRead: 'bad',
          cachedInputTokensWrite: 'bad',
          modelName: 'claude-sonnet-4-6',
          totalCost: 'bad',
          inputCost: 'bad',
          outputCost: 'bad',
          cachedInputCost: 'bad',
          savings: 'bad',
          currency: 'USD',
        });
        expect(received[0]).toEqual({
          type: 'token_usage_summary',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokensRead: 0,
          cachedInputTokensWrite: 0,
          modelName: 'claude-sonnet-4-6',
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
          cachedInputCost: 0,
          savings: 0,
          currency: 'USD',
        });
      },
    );

    it(
      'passes through string fields in token.usage.summary',
      () => {
        emitDirect('token.usage.summary', {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokensRead: 0,
          cachedInputTokensWrite: 0,
          modelName: 'claude-opus-4-6',
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
          cachedInputCost: 0,
          savings: 0,
          currency: 'USD',
        });
        const e = received[0];
        expect(e.type).toBe('token_usage_summary');
        if (e.type === 'token_usage_summary') {
          expect(e.modelName).toBe('claude-opus-4-6');
          expect(e.currency).toBe('USD');
        }
      },
    );
  });
});
