import { randomUUID } from 'node:crypto';
import { EventSource } from 'eventsource';
import type { Config } from '../../config/environments/types.js';
import type { AgentClient, AgentEvent, ToolInfo } from './agent-client.js';
import type { SetupContext } from '../scenarios/types.js';
import { toFiniteNumber } from '../util/to-finite-number.js';

interface RawTool {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

interface RawAgentEntry {
  id: string;
  name: string;
}

export interface AgentContext {
  siteId: string;
  /** Optional: only set for scenarios that pin an agent profile. */
  agentProfile?: string;
  /** Optional: EVAL_SHOPPER_ID, to exercise the turnscript TLA gate (3-char = TLA). */
  shopperId?: string;
}

export interface AABClientOptions {
  /** HTTP base URL of the AAB agents server (e.g. `:4000`); the SSE/HTTP base. */
  agentsUrl: Config['aab']['agentsUrl'];
  auth?: {
    agentContext?: AgentContext;
    /**
     * Unsigned mock JWT. In AUTH_TYPE=mock the AAB handshake rebuilds its own
     * agentContext and sources `agentProfile` ONLY from this token's decoded
     * claims, discarding the structured `agentContext` field above. So an
     * agentProfile arm MUST also be encoded here or it never reaches the
     * develop agent. Built by `mockAuthToken()`.
     */
    token?: string;
  };
}

/**
 * Mints an UNSIGNED JWT (header.payload.unsigned) carrying the given claims.
 * AAB mock auth never verifies the signature — it base64url-decodes the payload
 * segment and reads claims like `agentProfile` — so a placeholder signature is
 * sufficient and intentionally not a real credential. Local eval / mock auth only.
 */
export function mockAuthToken(claims: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode(claims);
  return `${header}.${payload}.unsigned`;
}

export class AABClient implements AgentClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly sessionId: string;
  private handlers: ((event: AgentEvent) => void)[] = [];
  private appId?: string;
  private templateId?: string;
  private designKitSlug?: string;
  private conversationId?: string;
  private accumulatedChunks = '';
  private eventSource: InstanceType<typeof EventSource> | null = null;
  private closing = false;

  constructor(config: AABClientOptions) {
    this.baseUrl = config.agentsUrl;
    this.token = config.auth?.token ?? '';
    // No socket.id under SSE — mint a stable per-client session id once.
    this.sessionId = randomUUID();
  }

  /**
   * Resolves when the AAB server is reachable; rejects after timeoutMs with a
   * clear error so the caller can surface "AAB not reachable" early. Uses an
   * unauthenticated `/health` probe rather than opening a stream.
   */
  async waitForConnection(timeoutMs = 10_000): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          `AAB not reachable at ${this.baseUrl} ` +
            `(timeout ${timeoutMs}ms). Is AAB running?`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `AAB not reachable at ${this.baseUrl} ` +
            `(timeout ${timeoutMs}ms). Is AAB running?`,
        );
      }
      throw new Error(
        `AAB connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private toToolInfo(raw: RawTool): ToolInfo {
    return {
      id: raw.id ?? '',
      name: raw.name,
      input: raw.input,
      output: raw.output,
      error: raw.error,
    };
  }

  private dispatch(event: AgentEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  configure(ctx: SetupContext): void {
    this.appId = ctx.appId;
    this.templateId =
      typeof ctx.templateId === 'string' ? ctx.templateId : undefined;
    this.designKitSlug =
      typeof ctx.designKitSlug === 'string' ? ctx.designKitSlug : undefined;
    this.conversationId = undefined;
    this.accumulatedChunks = '';
    // Each trial is a fresh conversation — drop any open stream from a prior
    // configure() so the next ensureStream() opens against the new id.
    this.closing = true;
    this.eventSource?.close();
    this.eventSource = null;
    this.closing = false;
  }

  /**
   * Idempotently creates the conversation (server assigns the id) and opens the
   * SSE stream, resolving once the stream is open so a subsequent message POST's
   * response events are not missed.
   */
  private async ensureStream(): Promise<void> {
    if (this.eventSource && this.conversationId) return;

    const createRes = await fetch(
      `${this.baseUrl}/api/conversations/${this.appId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(this.templateId ? { templateId: this.templateId } : {}),
      },
    );
    if (!createRes.ok) {
      throw new Error(`AAB conversation create failed: ${createRes.status}`);
    }
    const { conversationId } = (await createRes.json()) as {
      conversationId: string;
    };
    this.conversationId = conversationId;

    const token = this.token;
    this.eventSource = new EventSource(
      `${this.baseUrl}/api/conversations/${this.appId}/${conversationId}/stream`,
      {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            headers: {
              ...init?.headers,
              Authorization: `Bearer ${token}`,
            },
          }),
      },
    );
    this.registerListeners(this.eventSource);

    try {
      await this.waitForOpen(this.eventSource);
    } catch (err) {
      // The stream never opened (timeout or failed handshake). Tear it down so
      // a subsequent send() re-runs ensureStream() instead of POSTing into a
      // dead stream (the early-return guard above keys off both fields).
      this.eventSource.close();
      this.eventSource = null;
      this.conversationId = undefined;
      throw err;
    }
  }

  private waitForOpen(
    source: InstanceType<typeof EventSource>,
    timeoutMs = 10_000,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`AAB stream open timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        // A failed handshake (401/404/500) fires `error` and never `open`;
        // reject as soon as the source gives up (CLOSED) rather than waiting
        // out the timeout. Transient pre-open drops keep retrying (not CLOSED).
        if (source.readyState === EventSource.CLOSED) {
          cleanup();
          reject(new Error('AAB stream open failed (connection closed)'));
        }
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        source.removeEventListener('open', onOpen);
        source.removeEventListener('error', onError);
      };
      source.addEventListener('open', onOpen);
      source.addEventListener('error', onError);
    });
  }

  private registerListeners(
    source: InstanceType<typeof EventSource>,
  ): void {
    const debug = (type: string, data: Record<string, unknown>): void => {
      if (!process.env.PROBE_DEBUG_EVENTS) return;
      let suffix = '';
      if (type.startsWith('tool_')) {
        const toolName =
          (data.tool as RawTool | undefined)?.name ??
          (data.toolName as string | undefined) ??
          '';
        if (toolName) suffix = ` ${toolName}`;
      } else if (type === 'step_start') {
        suffix = ` agentId=${String(data.agentName ?? '')}`;
      }
      process.stderr.write(`[aab] ${type}${suffix}\n`);
    };

    // Register a JSON SSE listener. A malformed frame is surfaced as an error
    // AgentEvent rather than thrown into the EventSource dispatch machinery,
    // where it would be swallowed and the event silently dropped.
    const on = (
      type: string,
      handler: (data: Record<string, unknown>) => void,
    ): void => {
      source.addEventListener(type, (ev) => {
        const raw = (ev as MessageEvent).data;
        // Transport-level events (notably a failed/closed `error` event) reach
        // the same 'error' listeners but carry no JSON payload; they're handled
        // by `onerror`/`waitForOpen`, so don't mis-report them as malformed frames.
        if (typeof raw !== 'string') return;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch (err) {
          this.dispatch({
            type: 'error',
            error: `AAB malformed SSE frame (${type}): ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        debug(type, data);
        handler(data);
      });
    };

    on('chunk', (data) => {
      const content = String(data.content ?? '');
      this.dispatch({ type: 'chunk', content });
      this.accumulatedChunks += content;
    });

    on('complete', (data) => {
      // SSE spreads all fields at the top level — extract known evaluator fields.
      const evalData: Record<string, unknown> = {};
      if (data.totalSteps !== undefined) evalData.totalSteps = data.totalSteps;
      if (data.duration !== undefined) evalData.duration = data.duration;
      if (data.finishReason !== undefined) evalData.finishReason = data.finishReason;
      if (data.commitHash !== undefined) evalData.commitHash = data.commitHash;
      if (data.agentId !== undefined) evalData.agentId = data.agentId;
      const hasData = Object.keys(evalData).length > 0;
      this.dispatch({
        type: 'complete',
        content: (data.content as string) || this.accumulatedChunks,
        ...(hasData ? { data: evalData } : {}),
      });
      this.accumulatedChunks = '';
    });

    for (const type of ['tool_start', 'tool_call', 'tool_result'] as const) {
      on(type, (data) => {
        const raw = data.tool as RawTool | undefined;
        if (raw) {
          this.dispatch({ type, tool: this.toToolInfo(raw) });
        }
      });
    }

    on('tool_input_delta', (data) => {
      this.dispatch({
        type: 'tool_input_delta',
        tool: {
          id: String(data.toolId ?? ''),
          name: String(data.toolName ?? ''),
        },
        delta: String(data.delta ?? ''),
      });
    });

    for (const type of ['error', 'stream_error'] as const) {
      on(type, (data) => {
        this.dispatch({
          type: 'error',
          error:
            (data.error as string) ||
            (data.message as string) ||
            'Unknown error',
        });
      });
    }

    on('agents_available', (data) => {
      const entries = data.agents as RawAgentEntry[] | undefined;
      const names = (entries ?? []).map((a) => a.name ?? a.id);
      this.dispatch({ type: 'agents_available', agents: names });
    });

    on('step_complete', (data) => {
      this.dispatch({
        type: 'step_complete',
        content: data.content as string,
      });
    });

    on('step_start', (data) => {
      this.dispatch({
        type: 'step_start',
        agentName:
          typeof data.agentName === 'string' ? data.agentName : '',
      });
    });

    on('token_usage_summary', (data) => {
      this.dispatch({
        type: 'token_usage_summary',
        inputTokens: toFiniteNumber(data.inputTokens, 0),
        outputTokens: toFiniteNumber(data.outputTokens, 0),
        totalTokens: toFiniteNumber(data.totalTokens, 0),
        cachedInputTokensRead: toFiniteNumber(data.cachedInputTokensRead, 0),
        cachedInputTokensWrite: toFiniteNumber(data.cachedInputTokensWrite, 0),
        modelName: String(data.modelName ?? ''),
        totalCost: toFiniteNumber(data.totalCost, 0),
        inputCost: toFiniteNumber(data.inputCost, 0),
        outputCost: toFiniteNumber(data.outputCost, 0),
        cachedInputCost: toFiniteNumber(data.cachedInputCost, 0),
        savings: toFiniteNumber(data.savings, 0),
        currency: String(data.currency ?? ''),
      });
    });

    on('stream_timing_summary', (data) => {
      this.dispatch({
        type: 'stream_timing_summary',
        timeToStreamStartMs: toFiniteNumber(data.timeToStreamStartMs, 0),
        timeToFirstTextChunkMs:
          data.timeToFirstTextChunkMs == null
            ? null
            : toFiniteNumber(data.timeToFirstTextChunkMs, 0),
        maxChunkGapMs: toFiniteNumber(data.maxChunkGapMs, 0),
        chunksRead: toFiniteNumber(data.chunksRead, 0),
        streamDurationMs: toFiniteNumber(data.streamDurationMs, 0),
      });
    });

    on('stream_chunk_slow_gap', (data) => {
      this.dispatch({
        type: 'stream_chunk_slow_gap',
        gapMs: toFiniteNumber(data.gapMs, 0),
        chunksRead: toFiniteNumber(data.chunksRead, 0),
        streamElapsedMs: toFiniteNumber(data.streamElapsedMs, 0),
      });
    });

    on('stream_chunk_timeout', (data) => {
      this.dispatch({
        type: 'stream_chunk_timeout',
        chunksRead: toFiniteNumber(data.chunksRead, 0),
        streamElapsedMs: toFiniteNumber(data.streamElapsedMs, 0),
        timeToFirstTextChunkMs: toFiniteNumber(data.timeToFirstTextChunkMs, 0),
        maxChunkGapMs: toFiniteNumber(data.maxChunkGapMs, 0),
        error: String(data.error ?? ''),
      });
    });

    on('skill_diagnostics', (data) => {
      if (data.event === 'ready') {
        this.dispatch({ type: 'skill_diagnostics', event: 'ready' });
        return;
      }
      const event = data.event === 'unload' ? 'unload' : 'load';
      const skill = typeof data.skill === 'string' ? data.skill : '';
      if (!skill) return;
      this.dispatch({ type: 'skill_diagnostics', event, skill });
    });

    source.onerror = (ev: unknown): void => {
      // Intentional teardown (configure/disconnect closes the stream) is not an
      // error. The eventsource pkg auto-reconnects otherwise; mirror the prior
      // WS restraint and surface a single transport error rather than fighting
      // its backoff.
      if (this.closing) return;
      const e = ev as { code?: unknown; message?: unknown } | null | undefined;
      const detail = [e?.code, e?.message].filter((v) => v != null).join(' ');
      this.dispatch({
        type: 'error',
        error: detail ? `AAB stream error: ${detail}` : 'AAB stream error',
      });
    };
  }

  send(message: string): void {
    this.accumulatedChunks = '';
    if (process.env.PROBE_DEBUG_EVENTS) {
      process.stderr.write(
        `[aab] → chat_message appId=${this.appId ?? 'none'} ` +
          `conversationId=${this.conversationId ?? 'none'} ` +
          `len=${message.length}\n`,
      );
    }
    void this.ensureStream()
      .then(() =>
        fetch(
          `${this.baseUrl}/api/conversations/${this.appId}/${this.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify({
              content: message,
              sessionId: this.sessionId,
              userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              ...(this.templateId && { templateId: this.templateId }),
              ...(this.designKitSlug && { designKitSlug: this.designKitSlug }),
            }),
          },
        ),
      )
      .then((res) => {
        if (!res.ok) {
          this.dispatch({
            type: 'error',
            error: `AAB send failed: ${res.status}`,
          });
        }
      })
      .catch((err: unknown) => {
        this.dispatch({
          type: 'error',
          error: `AAB send failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }

  onMessage(handler: (event: AgentEvent) => void): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    this.closing = true;
    this.eventSource?.close();
    this.eventSource = null;
  }
}
