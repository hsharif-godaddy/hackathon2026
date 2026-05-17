import { ConversationRepository } from '../../../database/repositories/ConversationRepository.js';
import { logger } from '../../../logging/index.js';
import type {
  ConversationLifecycleStore,
  ConversationTokenStore,
  HistoryMessage,
  MessageAddedHook,
  MessageStore,
  PaginatedMessagesResult,
  StoredContextAttachment,
} from '../../interfaces/conversation-store.js';
import type { WorkspaceScope } from '../../interfaces/scope.js';
import type { Conversation, ConversationMessage, ToolCall, MessageSegment } from '../../../database/schema.js';

/**
 * SQLite-backed conversation store adapter.
 * Delegates to ConversationRepository, resolving WorkspaceScope → appId.
 */
export class SqliteConversationLifecycleStore implements ConversationLifecycleStore {
  constructor(private repo = new ConversationRepository()) {}

  async create(scope: WorkspaceScope, agentId: string, title?: string, id?: string): Promise<Conversation> {
    return this.repo.create(scope.appId, agentId, title, id);
  }

  async getById(conversationId: string) {
    return this.repo.getById(conversationId);
  }

  async findByIds(conversationIds: string[]) {
    return this.repo.findByIds(conversationIds);
  }

  async getByAppId(scope: WorkspaceScope) {
    return this.repo.getByAppId(scope.appId);
  }

  async getLatestForApp(scope: WorkspaceScope) {
    return this.repo.getLatestForApp(scope.appId);
  }

  async findByAppAndAgent(scope: WorkspaceScope, agentId: string) {
    return this.repo.findByAppAndAgent(scope.appId, agentId);
  }

  async updateTitle(conversationId: string, title: string) {
    return this.repo.updateTitle(conversationId, title);
  }

  async updateAgentId(conversationId: string, agentId: string) {
    return this.repo.updateAgentId(conversationId, agentId);
  }

  async getOrCreateForApp(scope: WorkspaceScope, agentId: string, title?: string) {
    return this.repo.getOrCreateForApp(scope.appId, agentId, title);
  }

  async delete(conversationId: string) {
    return this.repo.delete(conversationId);
  }

  async getConversationsWithMessageCount(scope: WorkspaceScope, options?: { limit?: number; offset?: number }) {
    return this.repo.getConversationsWithMessageCount(scope.appId, options);
  }

  async getConversationCount(scope: WorkspaceScope) {
    return this.repo.getConversationCount(scope.appId);
  }
}

export class SqliteMessageStore implements MessageStore {
  constructor(private repo = new ConversationRepository()) {}

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
  ) {
    return this.repo.addMessage(conversationId, sender, content, options);
  }

  registerMessageAddedHook(hook: MessageAddedHook) {
    this.repo.registerMessageAddedHook(hook);
  }

  unregisterMessageAddedHook(hook: MessageAddedHook) {
    this.repo.unregisterMessageAddedHook(hook);
  }

  async getMessageById(messageId: string) {
    return this.repo.getMessageById(messageId);
  }

  async updateMessageMetadata(messageId: string, metadataUpdates: Record<string, unknown>) {
    return this.repo.updateMessageMetadata(messageId, metadataUpdates);
  }

  async updateMessage(
    messageId: string,
    updates: {
      content?: string;
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, unknown>;
    }
  ) {
    return this.repo.updateMessage(messageId, updates);
  }

  async hasMessagesForApp(scope: WorkspaceScope) {
    // SQLite is inherently sync; the repo method name reflects that. Remote adapters will be truly async.
    return this.repo.hasMessagesForAppSync(scope.appId);
  }

  async getMessageCount(conversationId: string) {
    return this.repo.getMessageCount(conversationId);
  }

  async getMessages(conversationId: string) {
    return this.repo.getMessages(conversationId);
  }

  async getLastUserMessage(conversationId: string) {
    return this.repo.getLastUserMessage(conversationId);
  }

  async getMessagesPaginated(scope: WorkspaceScope, conversationId: string, options?: { limit?: number; before?: string }): Promise<PaginatedMessagesResult> {
    const result = await this.repo.getMessagesPaginated(conversationId, scope.appId, options);
    if (result.hasMore && result.nextCursor) {
      return { messages: result.messages, hasMore: true, nextCursor: result.nextCursor, total: result.total };
    }
    if (result.hasMore) {
      logger.warn('message.pagination.cursorMissing', { conversationId, appId: scope.appId });
    }
    return { messages: result.messages, hasMore: false, nextCursor: null, total: result.total };
  }

  async getMessagesForHistory(conversationId: string): Promise<HistoryMessage[]> {
    return this.repo.getMessagesForHistory(conversationId);
  }

  async getMessagesBatch(conversationIds: string[]) {
    return this.repo.getMessagesBatch(conversationIds);
  }

  async deleteMessage(messageId: string) {
    return this.repo.deleteMessage(messageId);
  }

  generateTitle(firstMessage: string) {
    return this.repo.generateTitle(firstMessage);
  }
}

export class SqliteConversationTokenStore implements ConversationTokenStore {
  constructor(private repo = new ConversationRepository()) {}

  async getEstimatedTokensAfterMessageId(scope: WorkspaceScope, afterMessageId: string) {
    return this.repo.getEstimatedTokensAfterMessageId(scope.appId, afterMessageId);
  }

  async getEstimatedTokensForApp(scope: WorkspaceScope) {
    return this.repo.getEstimatedTokensForApp(scope.appId);
  }

  async getMessagesAfterMessageId(scope: WorkspaceScope, afterMessageId: string): Promise<HistoryMessage[]> {
    return this.repo.getMessagesAfterMessageId(scope.appId, afterMessageId);
  }

  async getLastMessageTimestamp() {
    return this.repo.getLastMessageTimestamp();
  }
}
