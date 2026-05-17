import { randomUUID } from 'node:crypto';
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
import { AsmClient } from './asm-client.js';
import { walkLinearChain } from './asm-chain.js';
import type { AsmMessage, AsmMessageInput, AsmSearchFilter, AsmContentInput } from './asm-types.js';
import { LABEL_APP_ID, labelFilter } from './asm-types.js';

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

  constructor(private readonly client: AsmClient) {}

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
    // Once we know messages exist for an app, the answer never reverts to false.
    if (this.hasMessagesCache.get(scope.appId)) return true;

    const filter: AsmSearchFilter = {
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async flushMessageToAsm(conversationId: string, message: ConversationMessage, participantContext?: ParticipantContext): Promise<void> {
    if (!message.content && !message.toolCalls?.length && !message.segments?.length) {
      return;
    }

    if (!this.lastMessageIdByConversation.has(conversationId)) {
      await this.seedLastMessageId(conversationId);
    }

    const responseTo = this.lastMessageIdByConversation.get(conversationId);
    const asmMessages = mapConversationMessageToAsmInputs(message, responseTo ? [responseTo] : undefined, participantContext);

    let lastFlushedId: string | undefined;
    for (const asmMsg of asmMessages) {
      const payload = { conversationId, messages: [asmMsg] };
      let payloadJson: string;
      try {
        payloadJson = JSON.stringify(payload);
      } catch (serErr) {
        logger.error('asm.message.serialize_failed', {
          messageId: message.id,
          conversationId,
          error: serErr instanceof Error ? serErr.message : String(serErr),
        });
        throw serErr;
      }

      const resp = await this.client.addMessages(payload);
      if (!resp.success) {
        const err = new Error(`ASM addMessages failed: ${resp.message ?? 'unknown'}`);
        logger.error('asm.message.flush_rejected', {
          messageId: asmMsg.id,
          conversationId,
          sender: message.sender,
          asmMessage: resp.message,
          payloadBytes: payloadJson.length,
        });
        throw err;
      }
      lastFlushedId = asmMsg.id;
    }

    if (lastFlushedId) {
      this.lastMessageIdByConversation.set(conversationId, lastFlushedId);
      if (this.flushedMessages.size >= FLUSHED_CACHE_MAX_SIZE) {
        const oldest = this.flushedMessages.keys().next().value;
        if (oldest) this.flushedMessages.delete(oldest);
      }
      this.flushedMessages.set(message.id, message);
    }
  }

  private async seedLastMessageId(conversationId: string): Promise<void> {
    try {
      const conv = await this.client.getConversation(conversationId, { last: 1 });
      const lastEdge = conv?.messages?.edges?.[0];
      if (lastEdge) {
        this.lastMessageIdByConversation.set(conversationId, lastEdge.node.id);
      }
    } catch (err) {
      logger.warn('asm.message.seed_last_id_failed', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async getLinearChain(conversationId: string): Promise<AsmMessage[]> {
    const allMessages: AsmMessage[] = [];
    let before: string | undefined;

    for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
      const conv = await this.client.getConversation(conversationId, { last: MESSAGE_PAGE_SIZE, before });
      const edges = conv?.messages?.edges;
      if (!edges || edges.length === 0) break;

      for (const edge of edges) {
        allMessages.push(edge.node);
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


/**
 * Re-aggregates split tool-call messages back into their parent agent message.
 * On write, each tool call is stored as a separate ASM message. On read, consecutive
 * AGENT messages that only contain tool content are merged into the preceding AGENT
 * message that has TextContent (or the first agent message in the run if there's no text).
 */
function aggregateToolMessages(chain: AsmMessage[]): AsmMessage[] {
  const result: AsmMessage[] = [];

  for (const msg of chain) {
    const hasText = msg.contents?.some((c) => c.__typename === 'TextContent') ?? false;
    const isToolOnly = !hasText && (msg.contents?.some((c) =>
      c.__typename === 'ToolRequestContent' || c.__typename === 'ToolResultContent'
    ) ?? false);
    const isAgent = msg.participant.type === 'AGENT';

    if (isAgent && isToolOnly && result.length > 0) {
      const prev = result[result.length - 1]!;
      if (prev.participant.type === 'AGENT') {
        prev.contents = [...(prev.contents ?? []), ...(msg.contents ?? [])];
        continue;
      }
    }

    result.push({ ...msg, contents: [...(msg.contents ?? [])] });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextFromContents(contents?: AsmMessage['contents']): string | null {
  if (!contents) return null;
  for (const c of contents) {
    if (c.__typename === 'TextContent') return c.text;
  }
  return null;
}

function extractToolCalls(contents?: AsmMessage['contents']): ToolCall[] {
  if (!contents) return [];
  const requests = new Map<string, ToolCall>();

  for (const c of contents) {
    if (c.__typename === 'ToolRequestContent') {
      requests.set(c.toolRequestId, {
        id: c.toolRequestId,
        toolName: c.toolName || 'unknown',
        toolArgs: c.parameters,
        status: 'running',
      });
    } else if (c.__typename === 'ToolResultContent') {
      const existing = requests.get(c.toolRequestId);
      if (existing) {
        existing.toolResult = c.result;
        existing.status = c.failed ? 'error' : 'success';
        if (!existing.toolName || existing.toolName === 'unknown') {
          existing.toolName = c.toolName || existing.toolName;
        }
      } else {
        requests.set(c.toolRequestId, {
          id: c.toolRequestId,
          toolName: c.toolName || 'unknown',
          toolArgs: {},
          toolResult: c.result,
          status: c.failed ? 'error' : 'success',
        });
      }
    }
  }

  return [...requests.values()];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapConversationMessageToAsmInputs(
  msg: ConversationMessage,
  responseTo?: string[],
  participantContext?: ParticipantContext,
): AsmMessageInput[] {
  const {
    segments: _segments,
    contextAttachments: _ctx,
    finalResult: _finalResult,
    ...safeMetadata
  } = msg.metadata ?? {};
  const baseMetadata: Record<string, unknown> = {
    ...safeMetadata,
    conversationId: msg.conversationId,
  };
  if (msg.messageType) baseMetadata.messageType = msg.messageType;
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

  const results: AsmMessageInput[] = [];

  // Text content as the primary message (carries the original message ID and metadata)
  if (msg.content) {
    results.push({
      id: msg.id,
      contents: [{ withTextContent: { text: msg.content } }],
      participant,
      responseTo,
      metadata: baseMetadata,
      messageCreatedAt: msg.createdAt.toISOString(),
    });
  }

  // Each tool call as a separate message chained to the previous
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      const toolName = tc.toolName;
      const toolArgs = tc.toolArgs;
      const toolResult = tc.toolResult;

      const contents: AsmContentInput[] = [
        {
          withToolRequestContent: {
            toolRequestId: tc.id,
            toolName,
            parameters: ensureJsonObject(truncatePayload(toolArgs, MAX_TOOL_ARG_LENGTH)),
          },
        },
      ];
      if (tc.status !== 'running') {
        contents.push({
          withToolResultContent: {
            toolRequestId: tc.id,
            toolName,
            result: ensureJsonObject(truncatePayload(toolResult ?? null, MAX_TOOL_RESULT_LENGTH)),
            failed: tc.status === 'error',
          },
        });
      }

      const prevId = results.length > 0 ? results[results.length - 1]!.id : undefined;
      const tcResponseTo = prevId ? [prevId] : responseTo;

      results.push({
        id: tc.id,
        contents,
        participant,
        responseTo: tcResponseTo,
        metadata: { conversationId: msg.conversationId, toolName },
        messageCreatedAt: msg.createdAt.toISOString(),
      });
    }
  }

  // If no content and no tool calls, produce a single empty message
  if (results.length === 0) {
    logger.error('asm.message.empty_contents', {
      messageId: msg.id,
      conversationId: msg.conversationId,
      sender: msg.sender,
      messageType: msg.messageType,
    });
    results.push({
      id: msg.id,
      contents: [],
      participant,
      responseTo,
      metadata: baseMetadata,
      messageCreatedAt: msg.createdAt.toISOString(),
    });
  }

  return results;
}

const ASM_INTERNAL_METADATA_KEYS = new Set([
  'conversationId', 'messageType', 'segments', 'contextAttachments', 'toolName',
]);

function mapAsmMessageToConversationMessage(asmMsg: AsmMessage, conversationId: string): ConversationMessage {
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

  const rawSegments = rawMetadata?.segments as MessageSegment[] | undefined;
  const segments = rawSegments ? normalizeStoredSegments(rawSegments) : undefined;

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
    origin: sender === 'user' ? 'customer' : 'support',
    createdAt: asmMsg.messageCreatedAt ? new Date(asmMsg.messageCreatedAt) : new Date(asmMsg.createdAt),
  };
}

function normalizeStoredSegments(segments: MessageSegment[]): MessageSegment[] {
  return segments.map((s) => {
    if (s.type !== 'tool_call') return s;
    const tc = extractSegmentToolCall(s);
    if (!tc) return s;
    const raw = tc as unknown as Record<string, unknown>;
    const normalized: ToolCall = {
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
    return { ...s, tool_call: normalized };
  });
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

function mapAsmMessageToHistoryMessage(asmMsg: AsmMessage, conversationId: string): HistoryMessage {
  const sender: 'user' | 'agent' = asmMsg.participant.type === 'USER' ? 'user' : 'agent';
  const text = getTextFromContents(asmMsg.contents) ?? '';
  const metadata = asmMsg.metadata as Record<string, unknown> | undefined;
  const segments = metadata?.segments as MessageSegment[] | undefined;

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
    origin: sender === 'user' ? 'customer' : 'support',
    createdAt: asmMsg.messageCreatedAt ? new Date(asmMsg.messageCreatedAt) : new Date(asmMsg.createdAt),
  };
}
