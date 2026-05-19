import { io, type Socket } from 'socket.io-client';
import type { Config } from '../../config/environments/types.js';
import type { AgentClient, AgentEvent, ToolInfo } from './agent-client.js';
import type { SetupContext } from '../scenarios/types.js';
import {
  toFiniteNumber,
} from '../util/to-finite-number.js';

/**
 * Inbound wire format: every server event arrives as a single
 * 'message' event with { type, content, data }.
 */
interface WireMessage {
  type: string;
  content: string;
  data: Record<string, unknown>;
}

interface RawTool {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

interface RawToolInputDelta {
  toolId: string;
  toolName: string;
  delta: string;
}

interface RawAgentEntry {
  id: string;
  name: string;
}

export interface AgentContext {
  siteId: string;
  agentProfile: string;
  agentProfileSelectorEnabled: boolean;
}

export interface AABClientOptions {
  socketUrl: Config['aab']['socketUrl'];
  auth?: {
    agentContext?: AgentContext;
  };
}

export class AABClient implements AgentClient {
  private socket: Socket;
  private readonly socketUrl: string;
  private handlers: ((event: AgentEvent) => void)[] = [];
  private appId?: string;
  private templateId?: string;
  private conversationId: string | undefined;
  private accumulatedChunks = '';

  constructor(config: AABClientOptions) {
    this.socketUrl = config.socketUrl;
    this.socket = io(config.socketUrl, {
      transports: ['websocket'],
      reconnection: false,
      ...(config.auth ? { auth: config.auth } : {}),
    });
    this.registerSocketHandlers();
  }

  /**
   * Resolves when the socket connects; rejects after timeoutMs with a
   * clear error so the caller can surface "AAB not reachable" early.
   */
  waitForConnection(timeoutMs = 10_000): Promise<void> {
    if (this.socket.connected) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `AAB not reachable at ${this.socketUrl} ` +
            `(timeout ${timeoutMs}ms). Is AAB running?`,
          ),
        );
      }, timeoutMs);

      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });

      this.socket.once('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(new Error(`AAB connection failed: ${err.message}`));
      });
    });
  }

  private registerSocketHandlers(): void {
    this.socket.on(
      'disconnect',
      (reason: string) => {
        // 'io client disconnect' is our own teardown call
        // (this.socket.disconnect()) — not an error.
        if (reason === 'io client disconnect') return;
        this.dispatch({
          type: 'error',
          error: `AAB disconnected: ${reason}`,
        });
      },
    );

    this.socket.on('message', (payload: WireMessage) => {
      if (process.env.PROBE_DEBUG_EVENTS) {
        let suffix = '';
        if (payload.type.startsWith('tool_')) {
          const toolName =
            (payload.data.tool as RawTool | undefined)?.name ??
            (payload.data as unknown as RawToolInputDelta).toolName ??
            '';
          if (toolName) suffix = ` ${toolName}`;
        } else if (payload.type === 'conversation_info') {
          suffix = ` conversationId=${String(
            payload.data.conversationId ?? 'unknown',
          )}`;
        } else if (payload.type === 'step_start') {
          suffix = ` agentId=${String(payload.data.agentName ?? '')}`;
        }
        process.stderr.write(`[aab] ${payload.type}${suffix}\n`);
      }
      switch (payload.type) {
        case 'chunk':
          this.dispatch({ type: 'chunk', content: payload.content });
          this.accumulatedChunks += payload.content;
          break;

        case 'complete': {
          const hasData = Object.keys(payload.data).length > 0;
          this.dispatch({
            type: 'complete',
            content: payload.content || this.accumulatedChunks,
            ...(hasData ? { data: payload.data } : {}),
          });
          this.accumulatedChunks = '';
          break;
        }

        case 'tool_start': {
          const raw = payload.data.tool as RawTool | undefined;
          if (raw) {
            this.dispatch({
              type: 'tool_start',
              tool: this.toToolInfo(raw),
            });
          }
          break;
        }

        case 'tool_call': {
          const raw = payload.data.tool as RawTool | undefined;
          if (raw) {
            this.dispatch({
              type: 'tool_call',
              tool: this.toToolInfo(raw),
            });
          }
          break;
        }

        case 'tool_input_delta': {
          const d = payload.data as unknown as RawToolInputDelta;
          this.dispatch({
            type: 'tool_input_delta',
            tool: { id: d.toolId, name: d.toolName },
            delta: d.delta ?? '',
          });
          break;
        }

        case 'tool_result': {
          const raw = payload.data.tool as RawTool | undefined;
          if (raw) {
            this.dispatch({
              type: 'tool_result',
              tool: this.toToolInfo(raw),
            });
          }
          break;
        }

        case 'error':
          this.dispatch({
            type: 'error',
            error: payload.content ||
              String(payload.data.error ?? 'Unknown error'),
          });
          break;

        case 'agents_available': {
          const entries =
            payload.data.agents as RawAgentEntry[] | undefined;
          const names = (entries ?? []).map((a) => a.name ?? a.id);
          this.dispatch({ type: 'agents_available', agents: names });
          break;
        }

        case 'step_complete': {
          const hasData = Object.keys(payload.data).length > 0;
          this.dispatch({
            type: 'step_complete',
            content: payload.content,
            ...(hasData ? { data: payload.data } : {}),
          });
          break;
        }

        case 'conversation_info': {
          const convId = payload.data.conversationId;
          if (typeof convId === 'string') {
            this.conversationId = convId;
          }
          break;
        }

        case 'step_start': {
          const agentName =
            typeof payload.data.agentName === 'string'
              ? payload.data.agentName
              : '';
          this.dispatch({ type: 'step_start', agentName });
          break;
        }

        // Ignore replay/catchup/history/config events — not relevant
        // to simulation transcripts.
        default:
          break;
      }
    });

    this.socket.on(
      'stream.timing.summary',
      (data: Record<string, unknown>) => {
        this.dispatch({
          type: 'stream_timing_summary',
          timeToStreamStartMs: toFiniteNumber(
            data.timeToStreamStartMs, 0,
          ),
          timeToFirstTextChunkMs:
            data.timeToFirstTextChunkMs == null
              ? null
              : toFiniteNumber(
                  data.timeToFirstTextChunkMs, 0,
                ),
          maxChunkGapMs: toFiniteNumber(
            data.maxChunkGapMs, 0,
          ),
          chunksRead: toFiniteNumber(
            data.chunksRead, 0,
          ),
          streamDurationMs: toFiniteNumber(
            data.streamDurationMs, 0,
          ),
        });
      },
    );

    this.socket.on(
      'stream.chunk.slow_gap',
      (data: Record<string, unknown>) => {
        this.dispatch({
          type: 'stream_chunk_slow_gap',
          gapMs: toFiniteNumber(data.gapMs, 0),
          chunksRead: toFiniteNumber(
            data.chunksRead, 0,
          ),
          streamElapsedMs: toFiniteNumber(
            data.streamElapsedMs, 0,
          ),
        });
      },
    );

    this.socket.on(
      'stream.chunk.timeout',
      (data: Record<string, unknown>) => {
        this.dispatch({
          type: 'stream_chunk_timeout',
          chunksRead: toFiniteNumber(
            data.chunksRead, 0,
          ),
          streamElapsedMs: toFiniteNumber(
            data.streamElapsedMs, 0,
          ),
          timeToFirstTextChunkMs: toFiniteNumber(
            data.timeToFirstTextChunkMs, 0,
          ),
          maxChunkGapMs: toFiniteNumber(
            data.maxChunkGapMs, 0,
          ),
          error: String(data.error ?? ''),
        });
      },
    );

    this.socket.on(
      'token.usage.summary',
      (data: Record<string, unknown>) => {
        this.dispatch({
          type: 'token_usage_summary',
          inputTokens: toFiniteNumber(data.inputTokens, 0),
          outputTokens: toFiniteNumber(data.outputTokens, 0),
          totalTokens: toFiniteNumber(data.totalTokens, 0),
          cachedInputTokensRead: toFiniteNumber(
            data.cachedInputTokensRead, 0,
          ),
          cachedInputTokensWrite: toFiniteNumber(
            data.cachedInputTokensWrite, 0,
          ),
          modelName: String(data.modelName ?? ''),
          totalCost: toFiniteNumber(data.totalCost, 0),
          inputCost: toFiniteNumber(data.inputCost, 0),
          outputCost: toFiniteNumber(data.outputCost, 0),
          cachedInputCost: toFiniteNumber(data.cachedInputCost, 0),
          savings: toFiniteNumber(data.savings, 0),
          currency: String(data.currency ?? ''),
        });
      },
    );
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
    this.templateId = typeof ctx.templateId === 'string' ? ctx.templateId : undefined;
    this.conversationId = undefined;
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
    this.socket.emit('chat_message', {
      message,
      timestamp: new Date().toISOString(),
      context: {
        metadata: {
          appId: this.appId,
          userId: 'current-user',
          sessionId: this.socket.id,
          userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(this.templateId && { templateId: this.templateId }),
        },
        conversation: {
          conversationId: this.conversationId,
          maxMessages: 10,
          includeHistory: true,
        },
        appContext: {
          includeDirectoryListing: true,
          includePackageInfo: true,
          includeDependencyStatus: true,
          maxDirectoryDepth: 3,
        },
      },
    });
  }

  onMessage(handler: (event: AgentEvent) => void): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
