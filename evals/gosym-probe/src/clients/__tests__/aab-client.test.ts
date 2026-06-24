import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEvent } from '../agent-client.js';

/**
 * Controllable fake of the `eventsource` package's `EventSource`, defined inside
 * `vi.hoisted` so the hoisted `vi.mock` factory can reference it. Captures the
 * url + init options, records `addEventListener` handlers keyed by type, exposes
 * an `onerror` setter and a `close()` spy, and lets the test drive `open` and
 * named-event dispatch (with a JSON `data` string) through the client's
 * listeners. One instance is opened per stream; `lastInstance` exposes it.
 */
const { FakeEventSource } = vi.hoisted(() => {
  class FakeEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    static instances: FakeEventSource[] = [];
    static lastInstance(): FakeEventSource {
      const inst = FakeEventSource.instances.at(-1);
      if (!inst) throw new Error('no FakeEventSource constructed');
      return inst;
    }

    readonly url: string;
    readonly init: unknown;
    readyState = FakeEventSource.CONNECTING;
    readonly close = vi.fn(() => {
      this.readyState = FakeEventSource.CLOSED;
    });
    onerror: ((ev: unknown) => void) | null = null;
    private listeners: Record<string, Array<(ev: unknown) => void>> = {};

    constructor(url: string, init?: unknown) {
      this.url = url;
      this.init = init;
      FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, cb: (ev: unknown) => void): void {
      (this.listeners[type] ??= []).push(cb);
    }

    removeEventListener(type: string, cb: (ev: unknown) => void): void {
      this.listeners[type] = (this.listeners[type] ?? []).filter(
        (h) => h !== cb,
      );
    }

    /** Fire the `open` event so the client's `waitForOpen` resolves. */
    fireOpen(): void {
      this.readyState = FakeEventSource.OPEN;
      for (const cb of this.listeners['open'] ?? []) cb(new Event('open'));
    }

    /**
     * Fire a handshake-failure `error` (the `addEventListener('error')` path)
     * with the source CLOSED, so `waitForOpen` rejects immediately.
     */
    fireOpenError(): void {
      this.readyState = FakeEventSource.CLOSED;
      for (const cb of this.listeners['error'] ?? []) cb(new Event('error'));
    }

    /**
     * Fire a transient pre-open `error` while still CONNECTING (the library
     * would auto-retry); `waitForOpen` must NOT reject on this.
     */
    fireTransientError(): void {
      for (const cb of this.listeners['error'] ?? []) cb(new Event('error'));
    }

    /** Dispatch a named SSE event carrying a JSON-stringified `data` payload. */
    dispatch(type: string, data: Record<string, unknown>): void {
      const ev = { data: JSON.stringify(data) };
      for (const cb of this.listeners[type] ?? []) cb(ev);
    }

    /** Dispatch a named SSE event carrying a raw (possibly malformed) data string. */
    dispatchRaw(type: string, raw: string): void {
      const ev = { data: raw };
      for (const cb of this.listeners[type] ?? []) cb(ev);
    }

    /** Trigger the transport-level error path (`onerror`). */
    fireError(): void {
      this.onerror?.(new Event('error'));
    }
  }
  return { FakeEventSource };
});

type FakeEventSource = InstanceType<typeof FakeEventSource>;

vi.mock('eventsource', () => ({ EventSource: FakeEventSource }));

import { AABClient } from '../aab-client.js';

const TOKEN = 'header.payload.unsigned';

/** Mock `fetch` covering /health, conversation create, and message POST. */
function installFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return { ok: true } as Response;
    }
    if (url.endsWith('/messages')) {
      return { ok: true, status: 202 } as Response;
    }
    // conversation create: POST /api/conversations/:appId
    return {
      ok: true,
      json: async () => ({ conversationId: 'conv-1', isNew: true }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Drive a `send()` to completion: await the create + open + message POST chain.
 * `send()` is fire-and-forget, so we flush microtasks until the EventSource is
 * constructed, fire `open` to resolve `ensureStream`, then flush again so the
 * message POST settles. No real timers.
 */
async function settleSend(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => {
    expect(FakeEventSource.instances.length).toBeGreaterThan(0);
  });
  FakeEventSource.lastInstance().fireOpen();
  await vi.waitFor(() => {
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/messages'))).toBe(true);
  });
}

describe('AABClient (SSE)', () => {
  let client: AABClient;
  let received: AgentEvent[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    fetchMock = installFetch();
    received = [];
    client = new AABClient({
      agentsUrl: 'http://localhost:4000',
      auth: { token: TOKEN },
    });
    client.onMessage((e) => received.push(e));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Open a stream to completion and return its EventSource, with `received`
   * cleared so the test sees only events it dispatches afterwards.
   */
  async function openStream(): Promise<FakeEventSource> {
    client.configure({ appId: 'app-123' });
    client.send('hi');
    await settleSend(fetchMock);
    received.length = 0;
    return FakeEventSource.lastInstance();
  }

  describe('waitForConnection()', () => {
    it('resolves when /health responds ok', async () => {
      await expect(client.waitForConnection()).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/health',
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it('rejects when /health is not ok', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false } as Response);
      await expect(client.waitForConnection()).rejects.toThrow(
        /not reachable/,
      );
    });

    it('rejects when fetch itself rejects', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(client.waitForConnection()).rejects.toThrow(
        /connection failed: ECONNREFUSED/,
      );
    });
  });

  describe('send() — conversation lifecycle', () => {
    it(
      'creates the conversation, opens the stream at the right URL, ' +
        'then POSTs the message',
      async () => {
        client.configure({ appId: 'app-123' });
        client.send('hi');
        await settleSend(fetchMock);

        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls).toContain(
          'http://localhost:4000/api/conversations/app-123',
        );
        expect(FakeEventSource.lastInstance().url).toBe(
          'http://localhost:4000/api/conversations/app-123/conv-1/stream',
        );
        expect(urls).toContain(
          'http://localhost:4000/api/conversations/app-123/conv-1/messages',
        );
      },
    );

    it('sends Authorization: Bearer <token> on create and messages', async () => {
      client.configure({ appId: 'app-123' });
      client.send('hi');
      await settleSend(fetchMock);

      const createCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === 'http://localhost:4000/api/conversations/app-123',
      );
      const messagesCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).endsWith('/messages'),
      );
      const createHeaders = (createCall?.[1] as RequestInit).headers as Record<
        string,
        string
      >;
      const messagesHeaders = (messagesCall?.[1] as RequestInit)
        .headers as Record<string, string>;
      expect(createHeaders.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(messagesHeaders.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('messages body carries content, sessionId and userTimezone', async () => {
      client.configure({ appId: 'app-123' });
      client.send('build me a landing page');
      await settleSend(fetchMock);

      const messagesCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).endsWith('/messages'),
      );
      const body = JSON.parse(
        String((messagesCall?.[1] as RequestInit).body),
      ) as Record<string, unknown>;
      expect(body.content).toBe('build me a landing page');
      expect(typeof body.sessionId).toBe('string');
      expect(body.sessionId).not.toBe('');
      expect(typeof body.userTimezone).toBe('string');
    });

    it('dispatches an error AgentEvent when the message POST is not ok', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/messages')) {
          return { ok: false, status: 500 } as Response;
        }
        return {
          ok: true,
          json: async () => ({ conversationId: 'conv-1', isNew: true }),
        } as unknown as Response;
      });
      client.configure({ appId: 'app-123' });
      client.send('hi');
      await vi.waitFor(() => {
        expect(FakeEventSource.instances.length).toBeGreaterThan(0);
      });
      FakeEventSource.lastInstance().fireOpen();
      await vi.waitFor(() => {
        expect(received).toContainEqual({
          type: 'error',
          error: 'AAB send failed: 500',
        });
      });
    });
  });

  describe('SSE event mapping', () => {
    let source: FakeEventSource;

    beforeEach(async () => {
      source = await openStream();
    });

    it('maps chunk events and accumulates into a later empty complete', () => {
      source.dispatch('chunk', { content: 'Here is ' });
      source.dispatch('chunk', { content: 'your page.' });
      source.dispatch('complete', {});
      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({ type: 'chunk', content: 'Here is ' });
      expect(received[1]).toEqual({ type: 'chunk', content: 'your page.' });
      expect(received.at(-1)).toEqual({
        type: 'complete',
        content: 'Here is your page.',
      });
    });

    it('coerces a content-less chunk to empty string (never literal "undefined")', () => {
      source.dispatch('chunk', {});
      source.dispatch('complete', {});
      expect(received[0]).toEqual({ type: 'chunk', content: '' });
      expect(received.at(-1)).toEqual({ type: 'complete', content: '' });
    });

    it('surfaces a malformed SSE frame as an error AgentEvent', () => {
      source.dispatchRaw('chunk', 'not-json{');
      expect(received).toHaveLength(1);
      const e = received[0];
      expect(e.type).toBe('error');
      if (e.type === 'error') {
        expect(e.error).toMatch(/malformed SSE frame \(chunk\)/);
      }
    });

    it('prefers complete content over accumulated chunks', () => {
      source.dispatch('chunk', { content: 'streamed' });
      source.dispatch('complete', { content: 'final text' });
      expect(received.at(-1)).toEqual({
        type: 'complete',
        content: 'final text',
      });
    });

    it('collects commitHash and agentId from top-level complete payload', () => {
      source.dispatch('complete', {
        content: 'done',
        commitHash: 'abc123',
        agentId: 'develop',
      });
      expect(received[0]).toEqual({
        type: 'complete',
        content: 'done',
        data: { commitHash: 'abc123', agentId: 'develop' },
      });
    });

    it('collects totalSteps, finishReason, and duration from top-level complete payload', () => {
      source.dispatch('complete', {
        content: 'done',
        totalSteps: 12,
        finishReason: 'end_turn',
        duration: '4321ms',
      });
      expect(received[0]).toEqual({
        type: 'complete',
        content: 'done',
        data: { totalSteps: 12, finishReason: 'end_turn', duration: '4321ms' },
      });
    });

    it('omits data on complete when no evaluator fields are present', () => {
      source.dispatch('complete', { content: 'done' });
      expect(received[0]).toEqual({ type: 'complete', content: 'done' });
    });

    it('maps tool_start with full ToolInfo', () => {
      source.dispatch('tool_start', {
        tool: { id: 't1', name: 'read_file', input: { path: '/foo' } },
      });
      expect(received[0]).toEqual({
        type: 'tool_start',
        tool: {
          id: 't1',
          name: 'read_file',
          input: { path: '/foo' },
          output: undefined,
          error: undefined,
        },
      });
    });

    it('ignores tool_start when data.tool is absent', () => {
      source.dispatch('tool_start', {});
      expect(received).toHaveLength(0);
    });

    it('maps tool_call', () => {
      source.dispatch('tool_call', {
        tool: { id: 't2', name: 'write_file', input: {} },
      });
      expect(received[0]).toMatchObject({
        type: 'tool_call',
        tool: { id: 't2', name: 'write_file' },
      });
    });

    it('maps tool_result with output', () => {
      source.dispatch('tool_result', {
        tool: { id: 't4', name: 'run_cmd', output: 'exit 0' },
      });
      expect(received[0]).toMatchObject({
        type: 'tool_result',
        tool: { id: 't4', name: 'run_cmd', output: 'exit 0' },
      });
    });

    it('maps tool_result with error field', () => {
      source.dispatch('tool_result', {
        tool: { id: 't5', name: 'run_cmd', error: 'exit 1' },
      });
      const e = received[0];
      expect(e.type).toBe('tool_result');
      if (e.type === 'tool_result') {
        expect(e.tool.error).toBe('exit 1');
      }
    });

    it('maps tool_input_delta with delta', () => {
      source.dispatch('tool_input_delta', {
        toolId: 't3',
        toolName: 'search',
        delta: 'abc',
      });
      expect(received[0]).toEqual({
        type: 'tool_input_delta',
        tool: { id: 't3', name: 'search' },
        delta: 'abc',
      });
    });

    it('defaults tool_input_delta delta to empty string when missing', () => {
      source.dispatch('tool_input_delta', { toolId: 't3', toolName: 'search' });
      const e = received[0];
      expect(e.type).toBe('tool_input_delta');
      if (e.type === 'tool_input_delta') {
        expect(e.delta).toBe('');
      }
    });

    it('maps error event from data.error', () => {
      source.dispatch('error', { error: 'socket timeout' });
      expect(received[0]).toEqual({
        type: 'error',
        error: 'socket timeout',
      });
    });

    it('maps stream_error event to an error AgentEvent', () => {
      source.dispatch('stream_error', { message: 'connection lost' });
      expect(received[0]).toEqual({
        type: 'error',
        error: 'connection lost',
      });
    });

    it('defaults error to "Unknown error" when fields are empty', () => {
      source.dispatch('error', {});
      expect(received[0]).toEqual({ type: 'error', error: 'Unknown error' });
    });

    it('maps agents_available (array of objects) to names', () => {
      source.dispatch('agents_available', {
        agents: [
          { id: 'aab', name: 'aab' },
          { id: 'coder', name: 'coder' },
        ],
      });
      expect(received[0]).toEqual({
        type: 'agents_available',
        agents: ['aab', 'coder'],
      });
    });

    it('maps step_start with agentName', () => {
      source.dispatch('step_start', { agentName: 'develop' });
      expect(received[0]).toEqual({ type: 'step_start', agentName: 'develop' });
    });

    it('maps step_start with empty agentName when absent', () => {
      source.dispatch('step_start', {});
      expect(received[0]).toEqual({ type: 'step_start', agentName: '' });
    });

    it('maps step_complete with content only (no data forwarded)', () => {
      source.dispatch('step_complete', { content: 'Agent response here' });
      expect(received[0]).toEqual({
        type: 'step_complete',
        content: 'Agent response here',
      });
    });

    it('dispatches to all registered onMessage handlers', () => {
      const r2: AgentEvent[] = [];
      client.onMessage((e) => r2.push(e));
      source.dispatch('complete', { content: 'hi' });
      expect(received).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });
  });

  describe('SSE diagnostic events', () => {
    let source: FakeEventSource;

    beforeEach(async () => {
      source = await openStream();
    });

    it('dispatches token_usage_summary with the full breakdown', () => {
      source.dispatch('token_usage_summary', {
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

    it('coerces non-numeric token_usage_summary fields to 0', () => {
      source.dispatch('token_usage_summary', {
        inputTokens: 'bad',
        outputTokens: 'bad',
        totalTokens: 'bad',
        cachedInputTokensRead: 'bad',
        cachedInputTokensWrite: 'bad',
        modelName: 'claude-opus-4-6',
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
        modelName: 'claude-opus-4-6',
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cachedInputCost: 0,
        savings: 0,
        currency: 'USD',
      });
    });

    it('dispatches stream_timing_summary and preserves null TTFC', () => {
      source.dispatch('stream_timing_summary', {
        timeToStreamStartMs: 5000,
        timeToFirstTextChunkMs: null,
        maxChunkGapMs: 3000,
        chunksRead: 42,
        streamDurationMs: 18000,
      });
      const e = received[0];
      expect(e).toEqual({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 5000,
        timeToFirstTextChunkMs: null,
        maxChunkGapMs: 3000,
        chunksRead: 42,
        streamDurationMs: 18000,
      });
    });

    it('coerces non-numeric stream_timing_summary fields to 0', () => {
      source.dispatch('stream_timing_summary', {
        timeToStreamStartMs: 'garbage',
        timeToFirstTextChunkMs: 12000,
        maxChunkGapMs: 'nope',
        chunksRead: 'xyz',
        streamDurationMs: 'abc',
      });
      expect(received[0]).toEqual({
        type: 'stream_timing_summary',
        timeToStreamStartMs: 0,
        timeToFirstTextChunkMs: 12000,
        maxChunkGapMs: 0,
        chunksRead: 0,
        streamDurationMs: 0,
      });
    });

    it('dispatches stream_chunk_slow_gap with gap fields', () => {
      source.dispatch('stream_chunk_slow_gap', {
        gapMs: 45000,
        chunksRead: 3,
        streamElapsedMs: 60000,
      });
      expect(received[0]).toEqual({
        type: 'stream_chunk_slow_gap',
        gapMs: 45000,
        chunksRead: 3,
        streamElapsedMs: 60000,
      });
    });

    it('dispatches stream_chunk_timeout with timeout fields', () => {
      source.dispatch('stream_chunk_timeout', {
        chunksRead: 5,
        streamElapsedMs: 125000,
        timeToFirstTextChunkMs: 8000,
        maxChunkGapMs: 120000,
        error: 'AbortError: chunk timeout',
      });
      expect(received[0]).toEqual({
        type: 'stream_chunk_timeout',
        chunksRead: 5,
        streamElapsedMs: 125000,
        timeToFirstTextChunkMs: 8000,
        maxChunkGapMs: 120000,
        error: 'AbortError: chunk timeout',
      });
    });

    it('defaults stream_chunk_timeout error to empty string when absent', () => {
      source.dispatch('stream_chunk_timeout', {
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
  });

  describe('disconnect()', () => {
    it('closes the EventSource and a later onerror does not dispatch', async () => {
      const source = await openStream();

      client.disconnect();
      expect(source.close).toHaveBeenCalledOnce();

      // The closing guard must suppress the transport error after teardown.
      source.fireError();
      expect(received).toHaveLength(0);
    });

    it('dispatches a transport error via onerror while the stream is live', async () => {
      const source = await openStream();

      source.fireError();
      expect(received).toEqual([{ type: 'error', error: 'AAB stream error' }]);
    });
  });

  describe('stream open failure', () => {
    it('rejects open on a CLOSED handshake error and surfaces a send error', async () => {
      client.configure({ appId: 'app-123' });
      client.send('hi');
      await vi.waitFor(() => {
        expect(FakeEventSource.instances).toHaveLength(1);
      });

      FakeEventSource.lastInstance().fireOpenError();

      await vi.waitFor(() => {
        expect(received.some((e) => e.type === 'error')).toBe(true);
      });
      expect(received[0]).toMatchObject({
        type: 'error',
        error: expect.stringContaining('stream open failed'),
      });
      // The message must not be POSTed into a stream that never opened.
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith('/messages'))).toBe(false);
    });

    it('does not reject open on a transient (still-connecting) error', async () => {
      client.configure({ appId: 'app-123' });
      client.send('hi');
      await vi.waitFor(() => {
        expect(FakeEventSource.instances).toHaveLength(1);
      });

      const source = FakeEventSource.lastInstance();
      source.fireTransientError();
      source.fireOpen();

      await vi.waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.endsWith('/messages'))).toBe(true);
      });
      expect(received.some((e) => e.type === 'error')).toBe(false);
    });

    it('tears the dead stream down so the next send opens a fresh one', async () => {
      client.configure({ appId: 'app-123' });
      client.send('first');
      await vi.waitFor(() => {
        expect(FakeEventSource.instances).toHaveLength(1);
      });
      const first = FakeEventSource.lastInstance();
      first.fireOpenError();
      await vi.waitFor(() => {
        expect(received.some((e) => e.type === 'error')).toBe(true);
      });
      expect(first.close).toHaveBeenCalled();

      received.length = 0;
      client.send('second');
      await vi.waitFor(() => {
        expect(FakeEventSource.instances).toHaveLength(2);
      });
      FakeEventSource.lastInstance().fireOpen();
      await vi.waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.endsWith('/messages'))).toBe(true);
      });
    });
  });
});
