import { randomUUID } from 'node:crypto';
import type { Message, SearchFilter, MessageInput, ContentInput, StatsInput } from '@gd-asm/asm-client';
import { logger } from '../../../logging/index.js';
import type { ConversationMessage, ToolCall, MessageSegment } from '../../../database/schema.js';
import type {
  MessageStore,
  PaginatedMessagesResult,
  HistoryMessage,
  MessageAddedHook,
  StoredContextAttachment,
} from '../../interfaces/conversation-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';
import type { AsmClientWrapper } from './asm-client-wrapper.js';
import { walkLinearChain } from './asm-chain.js';
import { LABEL_APP_ID, labelFilter } from './asm-conversation-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_MAX_LENGTH = 60;
const MAX_TOOL_ARG_LENGTH = 50_000;
const MAX_TOOL_RESULT_LENGTH = 50_000;
const FLUSHED_CACHE_MAX_SIZE = 1024;
const MESSAGE_PAGE_SIZE = 500;
const MAX_MESSAGE_PAGES = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParticipantContext {
  customerId?: string;
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class AsmMessageStore implements MessageStore {
  private readonly hooks: Set<MessageAddedHook> = new Set();
  private readonly inProgressBuffer: Map<string, ConversationMessage> = new Map();
  private readonly flushedMessages: Map<string, ConversationMessage> = new Map();
  private readonly participantContextByMessage: Map<string, ParticipantContext> = new Map();
  private readonly lastMessageIdByConversation: Map<string, string> = new Map();
  private readonly hasMessagesCache: Map<string, boolean> = new Map();

  constructor(private readonly client: AsmClientWrapper) {}

  async addMessage(
    conversationId: string,
    sender: 'user' | 'agent',
    content: string,
    options?: {
      messageType?: 'status' | 'tool_result' | 'error';
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
      contextAttachments?: StoredContextAttachment[];
      origin?: 'support' | 'customer';
      customerId?: string;
      agentId?: string;
    }
  ): Promise<ConversationMessage> {
    const id = randomUUID();
    const now = new Date();
    const isInProgress = options?.metadata?.inProgress === true;

    const message: ConversationMessage = {
      id,
      conversationId,
      sender,
      content,
      messageType: options?.messageType,
      toolCalls: options?.toolCalls,
      segments: options?.segments,
      metadata: options?.metadata,
      contextAttachments: options?.contextAttachments,
      origin: options?.origin ?? (sender === 'user' ? 'customer' : 'support'),
      createdAt: now,
    };

    const pCtx: ParticipantContext = {
      customerId: options?.customerId,
      agentId: options?.agentId,
    };

    if (isInProgress && sender !== 'user') {
      this.inProgressBuffer.set(id, message);
      this.participantContextByMessage.set(id, pCtx);
    } else {
      await this.flushMessageToAsm(conversationId, message, pCtx);
    }

    await this.notifyHooks(message, conversationId);
    return message;
  }

  registerMessageAddedHook(hook: MessageAddedHook): void {
    this.hooks.add(hook);
  }

  unregisterMessageAddedHook(hook: MessageAddedHook): void {
    this.hooks.delete(hook);
  }

  async getMessageById(messageId: string): Promise<ConversationMessage | null> {
    const buffered = this.inProgressBuffer.get(messageId);
    if (buffered) return buffered;

    const flushed = this.flushedMessages.get(messageId);
    if (flushed) return flushed;

    return null;
  }

  async updateMessageMetadata(messageId: string, metadataUpdates: Record<string, unknown>): Promise<void> {
    const buffered = this.inProgressBuffer.get(messageId);
    if (buffered) {
      buffered.metadata = { ...buffered.metadata, ...metadataUpdates };
      if (metadataUpdates.inProgress === false) {
        this.inProgressBuffer.delete(messageId);
        const pCtx = this.participantContextByMessage.get(messageId);
        this.participantContextByMessage.delete(messageId);
        await this.flushMessageToAsm(buffered.conversationId, buffered, pCtx);
      }
      return;
    }
    logger.warn('asm.message.update_metadata_noop', {
      messageId,
      reason: 'message not in buffer; ASM is append-only',
    });
  }

  async updateMessage(
    messageId: string,
    updates: {
      content?: string;
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const buffered = this.inProgressBuffer.get(messageId);
    if (buffered) {
      if (updates.content !== undefined) buffered.content = updates.content;
      if (updates.toolCalls !== undefined) buffered.toolCalls = updates.toolCalls;
      if (updates.segments !== undefined) buffered.segments = updates.segments;
      if (updates.metadata !== undefined) {
        buffered.metadata = { ...buffered.metadata, ...updates.metadata };
      }
      if (updates.metadata?.inProgress === false) {
        this.inProgressBuffer.delete(messageId);
        const pCtx = this.participantContextByMessage.get(messageId);
        this.participantContextByMessage.delete(messageId);
        await this.flushMessageToAsm(buffered.conversationId, buffered, pCtx);
      }
      return;
    }
    logger.warn('asm.message.update_noop', {
      messageId,
      reason: 'message not in buffer; ASM is append-only',
    });
  }

  async hasMessagesForApp(scope: WorkspaceScope): Promise<boolean> {
    if (!scope.appId) return false;
    if (this.hasMessagesCache.get(scope.appId)) return true;

    const filter: SearchFilter = {
      matchAll: labelFilter(LABEL_APP_ID, scope.appId),
    };
    const resp = await this.client.searchConversations(filter, { first: 1 });
    const firstConvId = resp.conversationIds[0];
    if (!firstConvId) return false;
    const conv = await this.client.getConversation(firstConvId, { first: 1 });
    const has = (conv?.messages?.edges?.length ?? 0) > 0;
    if (has) this.hasMessagesCache.set(scope.appId, true);
    return has;
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const messages = await this.getLinearChain(conversationId);
    return messages.length;
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const chain = await this.getLinearChain(conversationId);
    const mapped = chain.map((m) => mapAsmMessageToConversationMessage(m, conversationId));
    for (const msg of this.inProgressBuffer.values()) {
      if (msg.conversationId === conversationId) {
        mapped.push(msg);
      }
    }
    return mapped;
  }

  async getLastUserMessage(conversationId: string): Promise<string | null> {
    const chain = await this.getLinearChain(conversationId);
    for (let i = chain.length - 1; i >= 0; i--) {
      const msg = chain[i]!;
      if (msg.participant.type === 'USER') {
        return getTextFromContents(msg.contents);
      }
    }
    return null;
  }

  async getMessagesPaginated(
    _scope: WorkspaceScope,
    conversationId: string,
    options?: { limit?: number; before?: string }
  ): Promise<PaginatedMessagesResult> {
    const allMessages = await this.getMessages(conversationId);
    const limit = options?.limit ?? 50;

    let slice: ConversationMessage[];
    if (options?.before) {
      const idx = allMessages.findIndex((m) => m.id === options.before);
      const endIdx = idx === -1 ? allMessages.length : idx;
      const startIdx = Math.max(0, endIdx - limit);
      slice = allMessages.slice(startIdx, endIdx);
    } else {
      slice = allMessages.slice(-limit);
    }

    const hasMore = slice.length < allMessages.length;
    if (hasMore && slice.length > 0) {
      return { messages: slice, hasMore: true, nextCursor: slice[0]!.id, total: allMessages.length };
    }
    return { messages: slice, hasMore: false, nextCursor: null, total: allMessages.length };
  }

  async getMessagesForHistory(conversationId: string): Promise<HistoryMessage[]> {
    const chain = await this.getLinearChain(conversationId);
    return chain.map((m) => mapAsmMessageToHistoryMessage(m, conversationId));
  }

  async getMessagesBatch(conversationIds: string[]): Promise<ConversationMessage[]> {
    const results = await Promise.all(
      conversationIds.map((id) => this.getMessages(id))
    );
    return results.flat();
  }

  async deleteMessage(messageId: string): Promise<void> {
    logger.warn('asm.message.delete_noop', { messageId, reason: 'ASM is append-only' });
  }

  generateTitle(firstMessage: string): string {
    if (firstMessage.length <= TITLE_MAX_LENGTH) return firstMessage;
    return firstMessage.slice(0, TITLE_MAX_LENGTH - 3) + '...';
  }

  /**
   * Dual-write entry point. The dual-write layer owns SQLite (the source of
   * truth) and only ever hands us already-finalized messages, so this skips the
   * in-progress buffer / flush lifecycle entirely and writes the complete
   * message straight to Venus. Ordering is guaranteed by the dual-write layer's
   * own serial mirror chain, so no per-conversation locking is needed here.
   */
  async mirrorCompleteMessage(
    conversationId: string,
    message: ConversationMessage,
    participantContext?: ParticipantContext
  ): Promise<void> {
    const isIncomplete = message.metadata?.incomplete === true;
    if (
      !message.content &&
      !message.toolCalls?.length &&
      !message.segments?.length &&
      !isIncomplete
    ) {
      return;
    }
    const asmMessage: ConversationMessage = {
      ...message,
      id: randomUUID(),
      metadata: { ...message.metadata, sqliteMessageId: message.id },
    };
    await this.dispatchToAsm(conversationId, asmMessage, participantContext);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  // Standalone-mode primary path: buffer → accumulate → flush on completion.
  // Caches the flushed message so reads (getMessageById) can serve it before it
  // round-trips through Venus.
  private async flushMessageToAsm(
    conversationId: string,
    message: ConversationMessage,
    participantContext?: ParticipantContext
  ): Promise<void> {
    if (!message.content && !message.toolCalls?.length && !message.segments?.length) {
      return;
    }

    const lastFlushedId = await this.dispatchToAsm(conversationId, message, participantContext);

    if (lastFlushedId) {
      if (this.flushedMessages.size >= FLUSHED_CACHE_MAX_SIZE) {
        const oldest = this.flushedMessages.keys().next().value;
        if (oldest) this.flushedMessages.delete(oldest);
      }
      this.flushedMessages.set(message.id, message);
    }
  }

  // Maps a complete message to Venus inputs and writes them, advancing the
  // per-conversation responseTo chain. Returns the id of the last input written
  // (undefined if nothing was sent). Shared by the standalone flush path and the
  // dual-write mirror path.
  private async dispatchToAsm(
    conversationId: string,
    message: ConversationMessage,
    participantContext?: ParticipantContext
  ): Promise<string | undefined> {
    if (!this.lastMessageIdByConversation.has(conversationId)) {
      await this.seedLastMessageId(conversationId);
    }

    const lastId = this.lastMessageIdByConversation.get(conversationId);
    const responseTo = lastId ? [lastId] : undefined;

    const asmMessages = mapConversationMessageToAsmInputs(message, responseTo, participantContext);

    let lastFlushedId: string | undefined;
    for (const asmMsg of asmMessages) {
      let payloadJson: string;
      try {
        payloadJson = JSON.stringify({ conversationId, messages: [asmMsg] });
      } catch (serErr) {
        logger.error('asm.message.serialize_failed', {
          messageId: message.id,
          conversationId,
          error: serErr instanceof Error ? serErr.message : String(serErr),
        });
        throw serErr;
      }

      const resp = await this.client.addMessages(conversationId, [asmMsg]);
      if (!resp?.success) {
        const reason = resp?.message ?? 'unknown';
        const err = new Error(`ASM addMessages failed: ${reason}`);
        logger.error('asm.message.flush_rejected', {
          messageId: asmMsg.id ?? message.id,
          conversationId,
          sender: message.sender,
          response: resp,
          payloadBytes: payloadJson.length,
        });
        throw err;
      }
      lastFlushedId = asmMsg.id ?? undefined;
    }

    if (lastFlushedId) {
      this.lastMessageIdByConversation.set(conversationId, lastFlushedId);
    }
    return lastFlushedId;
  }

  private async seedLastMessageId(conversationId: string): Promise<void> {
    const conv = await this.client.getConversation(conversationId, { last: 1 });
    const lastEdge = conv?.messages?.edges?.[0];
    if (lastEdge?.node) {
      this.lastMessageIdByConversation.set(conversationId, lastEdge.node.id);
    }
  }

  private async getLinearChain(conversationId: string): Promise<Message[]> {
    const allMessages: Message[] = [];
    let before: string | undefined;

    for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
      const conv = await this.client.getConversation(conversationId, { last: MESSAGE_PAGE_SIZE, before });
      const edges = conv?.messages?.edges;
      if (!edges || edges.length === 0) break;

      for (const edge of edges) {
        if (edge?.node) allMessages.push(edge.node);
      }

      const pageInfo = conv?.messages?.pageInfo;
      if (!pageInfo?.hasPreviousPage) break;
      before = pageInfo.startCursor ?? undefined;
    }

    if (allMessages.length === 0) return [];
    const rawChain = walkLinearChain(allMessages);
    return aggregateToolMessages(rawChain);
  }

  private async notifyHooks(message: ConversationMessage, conversationId: string): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook(message, conversationId);
      } catch (err) {
        logger.warn('asm.message.hook_failed', {
          messageId: message.id,
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}


function aggregateToolMessages(chain: Message[]): Message[] {
  const result: Message[] = [];
  let lastTailSourceId: string | undefined;

  for (const msg of chain) {
    const hasText = msg.contents?.some((c) => 'text' in c) ?? false;
    const isToolOnly = !hasText && (msg.contents?.some((c) =>
      'toolRequestId' in c && ('parameters' in c || 'result' in c)
    ) ?? false);
    const isAgent = msg.participant.type === 'AGENT';

    if (isAgent && isToolOnly && result.length > 0) {
      const prev = result[result.length - 1]!;
      const sameTurn = Array.isArray(msg.responseTo)
        && lastTailSourceId !== undefined
        && msg.responseTo.includes(lastTailSourceId);
      const prevMeta = prev.metadata as Record<string, unknown> | undefined;
      const prevIsMergeable = prev.participant.type === 'AGENT'
        && (prev.contents?.length ?? 0) > 0
        && prevMeta?.incomplete !== true;
      if (sameTurn && prevIsMergeable) {
        prev.contents = [...(prev.contents ?? []), ...(msg.contents ?? [])];
        lastTailSourceId = msg.id;
        continue;
      }
    }

    result.push({ ...msg, contents: [...(msg.contents ?? [])] });
    lastTailSourceId = msg.id;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextFromContents(contents?: Message['contents']): string | null {
  if (!contents) return null;
  for (const c of contents) {
    if ('text' in c) return (c as { text: string }).text;
  }
  return null;
}

function extractToolCalls(contents?: Message['contents']): ToolCall[] {
  if (!contents) return [];
  const requests = new Map<string, ToolCall>();

  for (const c of contents) {
    if ('toolRequestId' in c && 'parameters' in c && !('result' in c)) {
      const req = c as { toolRequestId: string; toolName: string; parameters: unknown };
      requests.set(req.toolRequestId, {
        id: req.toolRequestId,
        toolName: req.toolName || 'unknown',
        toolArgs: req.parameters,
        status: 'running',
      });
    } else if ('toolRequestId' in c && 'result' in c) {
      const res = c as { toolRequestId: string; toolName: string; result: unknown; failed?: boolean };
      const { result, error } = unwrapToolResult(res.result, res.failed);
      const existing = requests.get(res.toolRequestId);
      if (existing) {
        existing.toolResult = result;
        existing.error = error;
        existing.status = res.failed ? 'error' : 'success';
        if (!existing.toolName || existing.toolName === 'unknown') {
          existing.toolName = res.toolName || existing.toolName;
        }
      } else {
        requests.set(res.toolRequestId, {
          id: res.toolRequestId,
          toolName: res.toolName || 'unknown',
          toolArgs: {},
          toolResult: result,
          error,
          status: res.failed ? 'error' : 'success',
        });
      }
    }
  }

  return [...requests.values()];
}

// On write we wrap a failed tool's payload as `{ error, result? }` so the
// debugger-relevant error text survives the round-trip; on read, peel that
// envelope back so callers see `tc.error` and `tc.toolResult` separately.
function unwrapToolResult(raw: unknown, failed: boolean | undefined): { result: unknown; error?: string } {
  if (!failed || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: raw };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.error !== 'string') {
    return { result: raw };
  }
  return { result: obj.result, error: obj.error };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapConversationMessageToAsmInputs(
  msg: ConversationMessage,
  responseTo?: string[],
  participantContext?: ParticipantContext,
): MessageInput[] {
  const {
    segments: _segments,
    contextAttachments: _ctx,
    finalResult: _finalResult,
    socketId: _socketId,
    userId: _userId,
    agentName: _agentName,
    inputTokens: _inputTokens,
    outputTokens: _outputTokens,
    latency: _latency,
    stopReason: _stopReason,
    ...safeMetadata
  } = msg.metadata ?? {};
  const baseMetadata: Record<string, unknown> = {
    ...safeMetadata,
  };
  if (msg.messageType) baseMetadata.messageType = msg.messageType;
  if (msg.origin) baseMetadata.origin = msg.origin;
  if (msg.contextAttachments) baseMetadata.contextAttachments = msg.contextAttachments;
  const stats = extractStatsFromMetadata(msg.metadata);
  if (msg.segments) {
    baseMetadata.segments = msg.segments.map((s) => {
      const tc = extractSegmentToolCall(s);
      const { tool_call: _tc, toolCall: _tcCamel, ...segmentWithoutTool } = s as unknown as Record<string, unknown>;
      return {
        ...segmentWithoutTool,
        tool_call: tc ? {
          id: tc.id,
          toolName: tc.toolName,
          status: tc.status,
          durationMs: tc.durationMs,
        } : undefined,
      };
    });
  }

  const participant = msg.sender === 'user'
    ? { withCustomer: { id: participantContext?.customerId ?? 'unknown' } }
    : { withAgent: { id: participantContext?.agentId ?? 'airo-agent', name: 'airo-agent' } };

  const contents: ContentInput[] = [];

  if (msg.content) {
    contents.push({ withTextContent: { text: msg.content } });
  }

  if (msg.toolCalls) {
    for (const rawTc of msg.toolCalls) {
      const tc = normalizeToolCall(rawTc);
      contents.push({
        withToolRequestContent: {
          toolRequestId: tc.id,
          toolName: tc.toolName,
          parameters: ensureJsonObject(truncatePayload(tc.toolArgs, MAX_TOOL_ARG_LENGTH)),
        },
      });
      if (tc.status !== 'running') {
        // For failed tool calls, prefer the error string (more useful to debuggers
        // than an empty result) and stash it so the round-trip can restore tc.error.
        const failed = tc.status === 'error';
        const resultPayload = failed && tc.error
          ? { error: tc.error, ...(tc.toolResult != null ? { result: tc.toolResult } : {}) }
          : (tc.toolResult ?? null);
        contents.push({
          withToolResultContent: {
            toolRequestId: tc.id,
            toolName: tc.toolName,
            result: ensureJsonObject(truncatePayload(resultPayload, MAX_TOOL_RESULT_LENGTH)),
            failed,
          },
        });
      }
    }
  }

  const results: MessageInput[] = [];

  if (contents.length > 0) {
    results.push({
      id: msg.id,
      contents,
      participant,
      responseTo,
      metadata: baseMetadata,
      messageCreatedAt: msg.createdAt,
      ...(stats ? { stats } : {}),
    });
  }

  // If no content and no tool calls, produce a placeholder. For incomplete turns
  // (errored / disconnected before any LLM output) the placeholder preserves the
  // record of the attempt; otherwise we still log and emit (kept for parity with
  // prior behavior — empty messages are unexpected outside the incomplete path).
  if (results.length === 0) {
    const incomplete = msg.metadata?.incomplete === true;
    if (!incomplete) {
      logger.error('asm.message.empty_contents', {
        messageId: msg.id,
        conversationId: msg.conversationId,
        sender: msg.sender,
        messageType: msg.messageType,
      });
    }
    const outcomeLabel = typeof msg.metadata?.outcome === 'string' ? msg.metadata.outcome : 'incomplete';
    const placeholderText = incomplete
      ? `[turn ${outcomeLabel} before agent response]`
      : '';
    results.push({
      id: msg.id,
      contents: placeholderText
        ? [{ withTextContent: { text: placeholderText } }]
        : [],
      participant,
      responseTo,
      metadata: baseMetadata,
      messageCreatedAt: msg.createdAt,
      ...(stats ? { stats } : {}),
    });
  }

  return results;
}

const ASM_INTERNAL_METADATA_KEYS = new Set([
  'conversationId', 'messageType', 'segments', 'contextAttachments', 'toolName', 'origin',
]);

function mapAsmMessageToConversationMessage(asmMsg: Message, conversationId: string): ConversationMessage {
  const sender: 'user' | 'agent' = asmMsg.participant.type === 'USER' ? 'user' : 'agent';
  const text = getTextFromContents(asmMsg.contents) ?? '';
  const toolCalls = extractToolCalls(asmMsg.contents);
  const rawMetadata = asmMsg.metadata as Record<string, unknown> | undefined;

  let publicMetadata: Record<string, unknown> | undefined;
  if (rawMetadata) {
    publicMetadata = {};
    for (const [key, value] of Object.entries(rawMetadata)) {
      if (!ASM_INTERNAL_METADATA_KEYS.has(key)) {
        publicMetadata[key] = value;
      }
    }
    if (Object.keys(publicMetadata).length === 0) publicMetadata = undefined;
  }

  // Surface stats back into metadata so callers that read tokens/latency/stopReason
  // off the SQLite shape continue to work after a round-trip through ASM.
  if (asmMsg.stats) {
    const statsMeta = statsToMetadata(asmMsg.stats);
    if (statsMeta) {
      publicMetadata = { ...(publicMetadata ?? {}), ...statsMeta };
    }
  }

  const rawSegments = rawMetadata?.segments as MessageSegment[] | undefined;
  const segments = rawSegments ? normalizeStoredSegments(rawSegments) : undefined;
  const storedOrigin = rawMetadata?.origin;
  const origin: 'support' | 'customer' = storedOrigin === 'support' || storedOrigin === 'customer'
    ? storedOrigin
    : sender === 'user' ? 'customer' : 'support';

  return {
    id: asmMsg.id,
    conversationId: (rawMetadata?.conversationId as string) ?? conversationId,
    sender,
    content: text,
    messageType: rawMetadata?.messageType as ConversationMessage['messageType'],
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    segments,
    contextAttachments: rawMetadata?.contextAttachments as ConversationMessage['contextAttachments'],
    metadata: publicMetadata,
    origin,
    createdAt: toDate(asmMsg.messageCreatedAt) ?? toDate(asmMsg.createdAt) ?? new Date(),
  };
}

function normalizeStoredSegments(segments: MessageSegment[]): MessageSegment[] {
  return segments.map((s) => {
    if (s.type !== 'tool_call') return s;
    const tc = extractSegmentToolCall(s);
    if (!tc) return s;
    return { ...s, tool_call: normalizeToolCall(tc) };
  });
}

function normalizeToolCall(tc: ToolCall): ToolCall {
  const raw = tc as unknown as Record<string, unknown>;
  return {
    id: (raw.id as string) ?? 'unknown',
    toolName: (raw.toolName ?? raw.tool_name ?? raw.name ?? 'unknown') as string,
    toolArgs: raw.toolArgs ?? raw.tool_args ?? raw.input ?? {},
    toolResult: raw.toolResult ?? raw.tool_result ?? raw.result ?? raw.output,
    error: raw.error as string | undefined,
    startTime: (raw.startTime ?? raw.start_time) as number | undefined,
    endTime: (raw.endTime ?? raw.end_time) as number | undefined,
    durationMs: (raw.durationMs ?? raw.duration_ms ?? raw.duration) as number | undefined,
    status: normalizeToolStatus(raw),
  };
}

function normalizeToolStatus(raw: Record<string, unknown>): 'running' | 'success' | 'error' {
  if (raw.status === 'completed' || raw.status === 'success') return 'success';
  if (raw.status === 'error') return 'error';
  if (raw.status === 'running') return 'running';
  const hasResult = (raw.toolResult ?? raw.tool_result ?? raw.result ?? raw.output) != null;
  return hasResult ? 'success' : 'running';
}

interface LegacySegment {
  tool_call?: ToolCall;
  toolCall?: ToolCall;
}

function extractSegmentToolCall(segment: MessageSegment): ToolCall | undefined {
  if (segment.tool_call) return segment.tool_call;
  return (segment as unknown as LegacySegment).toolCall;
}

function truncatePayload(value: unknown, maxLength: number): unknown {
  if (value === null || value === undefined) return value;
  let serialized: string;
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return { _error: 'non_serializable' };
  }
  if (serialized.length <= maxLength) return value;
  return { _truncated: true, originalLength: serialized.length };
}

function ensureJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function mapAsmMessageToHistoryMessage(asmMsg: Message, conversationId: string): HistoryMessage {
  const sender: 'user' | 'agent' = asmMsg.participant.type === 'USER' ? 'user' : 'agent';
  const text = getTextFromContents(asmMsg.contents) ?? '';
  const metadata = asmMsg.metadata as Record<string, unknown> | undefined;
  const segments = metadata?.segments as MessageSegment[] | undefined;
  const storedOrigin = metadata?.origin;
  const origin: 'support' | 'customer' = storedOrigin === 'support' || storedOrigin === 'customer'
    ? storedOrigin
    : sender === 'user' ? 'customer' : 'support';

  return {
    id: asmMsg.id,
    conversationId: (metadata?.conversationId as string) ?? conversationId,
    sender,
    content: text,
    segments: segments?.map((s) => ({
      id: s.id,
      type: s.type,
      content: s.content,
      tool_call: s.tool_call,
      timestamp: new Date(s.timestamp),
    })),
    origin,
    createdAt: toDate(asmMsg.messageCreatedAt) ?? toDate(asmMsg.createdAt) ?? new Date(),
  };
}

// Defensive: package may return Date or ISO string depending on transport.
function toDate(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

// Map known SQLite metadata keys (token counts, latency, stop reason) into the
// StatsInput shape so Venus can surface them. Not all messages carry stats —
// returns undefined when nothing is set so we don't send empty objects.
function extractStatsFromMetadata(metadata: Record<string, unknown> | undefined): StatsInput | undefined {
  if (!metadata) return undefined;
  const inputTokens = numericMetadata(metadata, ['inputTokens', 'tokensIn', 'promptTokens']);
  const outputTokens = numericMetadata(metadata, ['outputTokens', 'tokensOut', 'completionTokens']);
  const latency = numericMetadata(metadata, ['latency', 'latencyMs', 'durationMs']);
  const stopReason = stringMetadata(metadata, ['stopReason', 'finishReason']);

  const hasTokens = inputTokens !== undefined && outputTokens !== undefined;
  if (!hasTokens && latency === undefined && !stopReason) return undefined;

  const stats: StatsInput = {};
  if (latency !== undefined) stats.latency = latency;
  if (hasTokens || stopReason) {
    stats.modelUsage = {};
    if (hasTokens) {
      stats.modelUsage.tokens = { input: inputTokens, output: outputTokens };
    }
    if (stopReason) stats.modelUsage.stopReason = stopReason;
  }
  return stats;
}

function statsToMetadata(stats: NonNullable<Message['stats']>): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  if (typeof stats.latency === 'number') result.latency = stats.latency;
  const tokens = stats.modelUsage?.tokens;
  if (tokens && typeof tokens.input === 'number' && typeof tokens.output === 'number') {
    result.inputTokens = tokens.input;
    result.outputTokens = tokens.output;
  }
  if (typeof stats.modelUsage?.stopReason === 'string') {
    result.stopReason = stats.modelUsage.stopReason;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function numericMetadata(metadata: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringMetadata(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
