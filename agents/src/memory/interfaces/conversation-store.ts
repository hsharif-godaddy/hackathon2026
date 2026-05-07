import type { Conversation, ConversationMessage, ToolCall, MessageSegment } from '../../database/schema.js';
import type { WorkspaceScope } from './scope.js';

/**
 * Message shape optimized for history loading and summarization.
 * Deliberately decoupled from DatabaseMessage to avoid leaking
 * repository internals into the store interface.
 */
export interface HistoryMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  segments?: Array<{
    id: string;
    type: 'content' | 'tool_call';
    content?: string;
    tool_call?: {
      id: string;
      tool_name: string;
      tool_args: unknown;
      tool_result?: unknown;
      error?: string;
      status?: 'running' | 'success' | 'error';
    };
    timestamp: Date;
  }>;
  origin: 'support' | 'customer';
  createdAt: Date;
}

export type PaginatedMessagesResult =
  | { messages: ConversationMessage[]; hasMore: true; nextCursor: string; total: number }
  | { messages: ConversationMessage[]; hasMore: false; nextCursor: null; total: number };

export type MessageAddedHook = (message: ConversationMessage, conversationId: string) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Conversation lifecycle operations
// ---------------------------------------------------------------------------

export interface ConversationLifecycleStore {
  create(scope: WorkspaceScope, agentId: string, title?: string, id?: string): Promise<Conversation>;
  getById(conversationId: string): Promise<Conversation | null>;
  findByIds(conversationIds: string[]): Promise<Conversation[]>;
  getByAppId(scope: WorkspaceScope): Promise<Conversation[]>;
  getLatestForApp(scope: WorkspaceScope): Promise<Conversation | null>;
  findByAppAndAgent(scope: WorkspaceScope, agentId: string): Promise<Conversation[]>;
  updateTitle(conversationId: string, title: string): Promise<void>;
  updateAgentId(conversationId: string, agentId: string): Promise<void>;
  getOrCreateForApp(scope: WorkspaceScope, agentId: string, title?: string): Promise<{ conversation: Conversation; isNew: boolean }>;
  delete(conversationId: string): Promise<void>;
  getConversationsWithMessageCount(
    scope: WorkspaceScope,
    options?: { limit?: number; offset?: number }
  ): Promise<Array<Conversation & { messageCount: number }>>;
  getConversationCount(scope: WorkspaceScope): Promise<number>;
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

export interface MessageStore {
  addMessage(
    conversationId: string,
    sender: 'user' | 'agent',
    content: string,
    options?: {
      messageType?: 'status' | 'tool_result' | 'error';
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
      contextAttachments?: Array<{
        type: string;
        data: unknown;
        metadata?: Record<string, unknown>;
        persistence?: 'save' | 'ephemeral';
        renderStrategy?: 'before_prompt' | 'after_prompt' | 'replace_prompt' | 'hidden';
      }>;
      origin?: 'support' | 'customer';
    }
  ): Promise<ConversationMessage>;

  registerMessageAddedHook(hook: MessageAddedHook): void;
  unregisterMessageAddedHook(hook: MessageAddedHook): void;

  getMessageById(messageId: string): Promise<ConversationMessage | null>;
  updateMessageMetadata(messageId: string, metadataUpdates: Record<string, unknown>): Promise<void>;
  updateMessage(
    messageId: string,
    updates: {
      content?: string;
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void>;

  hasMessagesForApp(scope: WorkspaceScope): Promise<boolean>;
  getMessageCount(conversationId: string): Promise<number>;
  getMessages(conversationId: string): Promise<ConversationMessage[]>;
  getLastUserMessage(conversationId: string): Promise<string | null>;
  getMessagesPaginated(
    scope: WorkspaceScope,
    conversationId: string,
    options?: { limit?: number; before?: string }
  ): Promise<PaginatedMessagesResult>;
  getMessagesForHistory(conversationId: string): Promise<HistoryMessage[]>;
  getMessagesBatch(conversationIds: string[]): Promise<ConversationMessage[]>;
  deleteMessage(messageId: string): Promise<void>;
  generateTitle(firstMessage: string): string;
}

// ---------------------------------------------------------------------------
// Token estimation + summarization-support queries
// ---------------------------------------------------------------------------

export interface ConversationTokenStore {
  getEstimatedTokensAfterMessageId(scope: WorkspaceScope, afterMessageId: string): Promise<number | null>;
  getEstimatedTokensForApp(scope: WorkspaceScope): Promise<number>;
  getMessagesAfterMessageId(scope: WorkspaceScope, afterMessageId: string): Promise<HistoryMessage[]>;
  /** Global query — returns the most recent message timestamp across all apps (used for /health). */
  getLastMessageTimestamp(): Promise<string | null>;
}
