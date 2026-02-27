import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDatabase } from '../connection.js';
import type { Conversation, ConversationMessage, ToolCall, MessageSegment } from '../schema.js';
import type { DatabaseMessage } from '../../types/conversation-messages.js';
import { logger } from '../../logging/index.js';

/**
 * Pagination result type for getMessagesPaginated
 */
export interface PaginatedMessagesResult {
  messages: ConversationMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

/**
 * Callback type for message addition hooks
 */
export type MessageAddedHook = (message: ConversationMessage, conversationId: string) => void | Promise<void>;

export class ConversationRepository {
  private db = getDatabase();
  private messageAddedHooks: MessageAddedHook[] = [];

  /**
   * Create a new conversation
   * @param appId - The app ID
   * @param agentId - The agent ID
   * @param title - Optional title for the conversation
   * @param id - Optional conversation ID. If not provided, a new ID will be generated
   * @returns The created conversation
   */
  async create(appId: string, agentId: string, title?: string, id?: string): Promise<Conversation> {
    const conversationId = id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, app_id, agent_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(conversationId, appId, agentId, title, now, now);

    const conversation: Conversation = {
      id: conversationId,
      appId,
      agentId,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    };

    if (title) {
      conversation.title = title;
    }

    return conversation;
  }

  /**
   * Get conversation by ID
   */
  async getById(conversationId: string): Promise<Conversation | null> {
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = stmt.get(conversationId) as any;

    if (!row) return null;

    return {
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Get multiple conversations by IDs in a single query (batch operation)
   */
  async findByIds(conversationIds: string[]): Promise<Conversation[]> {
    if (conversationIds.length === 0) {
      return [];
    }

    const placeholders = conversationIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE id IN (${placeholders})
    `);
    const rows = stmt.all(...conversationIds) as any[];

    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Get all conversations for an app
   */
  async getByAppId(appId: string): Promise<Conversation[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE app_id = ?
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all(appId) as any[];

    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Get the most recently updated conversation for an app (async)
   */
  async getLatestForApp(appId: string): Promise<Conversation | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE app_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = stmt.get(appId) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Get all conversations for an app (synchronous version for agent router)
   */
  getByAppIdSync(appId: string): Conversation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE app_id = ?
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all(appId) as any[];

    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Get the most recently updated conversation for an app (sync)
   * This is an alias for convenience that returns the first result from getByAppIdSync()
   */
  getLatestForAppSync(appId: string): Conversation | null {
    const conversations = this.getByAppIdSync(appId);
    return conversations[0] ?? null;
  }

  /**
   * Get all conversations for an app and specific agent
   */
  async findByAppAndAgent(appId: string, agentId: string): Promise<Conversation[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE app_id = ? AND agent_id = ?
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all(appId, agentId) as any[];

    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  /**
   * Update conversation title
   */
  async updateTitle(conversationId: string, title: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(title, conversationId);
  }

  /**
   * Update the agent ID for a conversation (called during agent handoff).
   * This ensures the conversation row reflects which agent is currently handling it,
   * which is used by metrics/logging to track initial vs. develop agent activity.
   */
  async updateAgentId(conversationId: string, agentId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET agent_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(agentId, conversationId);
  }

  /**
   * Get the latest conversation for an app, or create a new one if none exists.
   * This is the primary method for single-conversation-per-app pattern.
   *
   * Note: There is a small race window between checking for existing conversation
   * and creating a new one. This is acceptable as single-conversation-per-app is
   * a soft pattern, and the system still supports multiple conversations per app
   * for future use cases.
   *
   * @returns Object with conversation and isNew flag indicating if it was just created
   */
  async getOrCreateForApp(appId: string, agentId: string, title?: string): Promise<{ conversation: Conversation; isNew: boolean }> {
    const existing = await this.getLatestForApp(appId);

    if (existing) {
      return { conversation: existing, isNew: false };
    }

    const conversation = await this.create(appId, agentId, title);
    return { conversation, isNew: true };
  }

  /**
   * Delete conversation and all its messages
   */
  async delete(conversationId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    stmt.run(conversationId);
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(
    conversationId: string,
    sender: 'user' | 'agent',
    content: string,
    options: {
      messageType?: 'status' | 'tool_result' | 'error';
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, any>;
      contextAttachments?: Array<{
        type: string;
        data: any;
        metadata?: Record<string, any>;
        persistence?: 'save' | 'ephemeral';
        renderStrategy?: 'before_prompt' | 'after_prompt' | 'replace_prompt' | 'hidden';
      }>;
    } = {}
  ): Promise<ConversationMessage> {
    const id = nanoid(12);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversation_messages
      (id, conversation_id, sender, content, message_type, tool_calls, segments, metadata, context_attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      conversationId,
      sender,
      content,
      options.messageType || null,
      options.toolCalls ? JSON.stringify(options.toolCalls) : null,
      options.segments ? JSON.stringify(options.segments) : null,
      options.metadata ? JSON.stringify(options.metadata) : null,
      options.contextAttachments ? JSON.stringify(options.contextAttachments) : null,
      now
    );

    const message: ConversationMessage = {
      id,
      conversationId,
      sender,
      content,
      createdAt: new Date(now)
    };

    if (options.messageType) {
      message.messageType = options.messageType;
    }
    if (options.toolCalls) {
      message.toolCalls = options.toolCalls;
    } else {
      message.toolCalls = [];
    }
    if (options.segments) {
      message.segments = options.segments;
    } else {
      message.segments = [];
    }
    if (options.metadata) {
      message.metadata = options.metadata;
    }
    if (options.contextAttachments) {
      message.contextAttachments = options.contextAttachments;
    }

    // Trigger hooks asynchronously (don't await to avoid blocking)
    for (const hook of this.messageAddedHooks) {
      const result = hook(message, conversationId);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          logger.error('conversation.repository.hook.failure', {
            messageId: message.id,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    return message;
  }

  /**
   * Register a hook to be called after messages are added
   * Useful for triggering background summarization
   * 
   * @param hook - Callback function to call after message is added
   */
  registerMessageAddedHook(hook: MessageAddedHook): void {
    this.messageAddedHooks.push(hook);
  }

  /**
   * Remove a message added hook
   * 
   * @param hook - Hook to remove
   */
  unregisterMessageAddedHook(hook: MessageAddedHook): void {
    const index = this.messageAddedHooks.indexOf(hook);
    if (index !== -1) {
      this.messageAddedHooks.splice(index, 1);
    }
  }

  /**
   * Get a single message by ID
   */
  async getMessageById(messageId: string): Promise<ConversationMessage | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_messages
      WHERE id = ?
    `);
    const row = stmt.get(messageId) as any;

    if (!row) return null;

    return {
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender,
      content: row.content,
      messageType: row.message_type,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      segments: row.segments ? JSON.parse(row.segments) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      contextAttachments: row.context_attachments ? JSON.parse(row.context_attachments) : undefined,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Update message metadata by merging with existing metadata
   * This preserves existing metadata fields while adding/updating new ones
   */
  async updateMessageMetadata(
    messageId: string,
    metadataUpdates: Record<string, any>
  ): Promise<void> {
    const stmt = this.db.prepare(`
      SELECT metadata FROM conversation_messages WHERE id = ?
    `);
    const row = stmt.get(messageId) as any;

    if (!row) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    const existingMetadata = row.metadata ? JSON.parse(row.metadata) : {};
    const mergedMetadata = { ...existingMetadata, ...metadataUpdates };

    const updateStmt = this.db.prepare(`
      UPDATE conversation_messages
      SET metadata = ?
      WHERE id = ?
    `);

    updateStmt.run(JSON.stringify(mergedMetadata), messageId);
  }

  /**
   * Update a message (useful for streaming updates)
   * Metadata is merged with existing metadata to preserve previous fields
   */
  async updateMessage(
    messageId: string,
    updates: {
      content?: string;
      toolCalls?: ToolCall[];
      segments?: MessageSegment[];
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const updateFields: string[] = [];
    const values: any[] = [];

    if (updates.content !== undefined) {
      updateFields.push('content = ?');
      values.push(updates.content);
    }

    if (updates.toolCalls !== undefined) {
      updateFields.push('tool_calls = ?');
      values.push(JSON.stringify(updates.toolCalls));
    }

    if (updates.segments !== undefined) {
      updateFields.push('segments = ?');
      values.push(JSON.stringify(updates.segments));
    }

    if (updates.metadata !== undefined) {
      const currentStmt = this.db.prepare(`
        SELECT metadata FROM conversation_messages WHERE id = ?
      `);
      const row = currentStmt.get(messageId) as any;

      if (row) {
        const existingMetadata = row.metadata ? JSON.parse(row.metadata) : {};
        const mergedMetadata = { ...existingMetadata, ...updates.metadata };
        updateFields.push('metadata = ?');
        values.push(JSON.stringify(mergedMetadata));
      } else {
        updateFields.push('metadata = ?');
        values.push(JSON.stringify(updates.metadata));
      }
    }

    if (updateFields.length === 0) return;

    values.push(messageId);

    const stmt = this.db.prepare(`
      UPDATE conversation_messages
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);
  }

  /**
   * Get the count of messages in a conversation (efficient for checking if conversation is empty)
   */
  async getMessageCount(conversationId: string): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM conversation_messages
      WHERE conversation_id = ?
    `);
    const row = stmt.get(conversationId) as { count: number };
    return row.count;
  }

  /**
   * Get all messages for a conversation
   */
  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(conversationId) as any[];

    return rows.map(row => {
      const segments = row.segments ? this.normalizeSegments(JSON.parse(row.segments)) : [];
      return {
        id: row.id,
        conversationId: row.conversation_id,
        sender: row.sender,
        content: row.content,
        messageType: row.message_type,
        toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        segments,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        contextAttachments: row.context_attachments ? JSON.parse(row.context_attachments) : undefined,
        createdAt: new Date(row.created_at)
      };
    });
  }

  /**
   * Get messages for a conversation with cursor-based pagination
   * Returns messages in chronological order (oldest first within the page)
   *
   * Uses compound ordering (created_at, rowid) to ensure deterministic pagination
   * even when messages have identical timestamps. SQLite's implicit rowid is used
   * as the tie-breaker because it guarantees insertion order.
   *
   * @param conversationId - The conversation ID
   * @param appId - The app ID (ownership validated via JOIN — returns empty if mismatch)
   * @param options.limit - Max messages to return (default 20, max 100)
   * @param options.before - Cursor (message ID) to fetch messages before
   * @returns Paginated messages with cursor for next page
   */
  async getMessagesPaginated(
    conversationId: string,
    appId: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<PaginatedMessagesResult> {
    const limit = Math.min(options.limit ?? 20, 100); // Enforce max 100

    // Count only messages whose conversation belongs to this app (ownership check via JOIN)
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM conversation_messages cm
      JOIN conversations c ON cm.conversation_id = c.id
      WHERE cm.conversation_id = ? AND c.app_id = ?
    `);
    const countRow = countStmt.get(conversationId, appId) as { count: number };
    const total = countRow.count;

    if (total === 0) {
      return { messages: [], hasMore: false, nextCursor: null, total: 0 };
    }

    let rows: any[];

    if (options.before) {
      const cursorStmt = this.db.prepare(`
        SELECT cm.rowid FROM conversation_messages cm
        JOIN conversations c ON cm.conversation_id = c.id
        WHERE cm.id = ? AND c.app_id = ?
      `);
      const cursorRow = cursorStmt.get(options.before, appId) as { rowid: number } | undefined;

      if (!cursorRow) {
        return { messages: [], hasMore: false, nextCursor: null, total };
      }

      const stmt = this.db.prepare(`
        SELECT cm.*, cm.rowid FROM conversation_messages cm
        JOIN conversations c ON cm.conversation_id = c.id
        WHERE cm.conversation_id = ? AND c.app_id = ?
          AND cm.rowid < ?
        ORDER BY cm.rowid DESC
        LIMIT ?
      `);
      rows = stmt.all(conversationId, appId, cursorRow.rowid, limit + 1) as any[];
    } else {
      const stmt = this.db.prepare(`
        SELECT cm.*, cm.rowid FROM conversation_messages cm
        JOIN conversations c ON cm.conversation_id = c.id
        WHERE cm.conversation_id = ? AND c.app_id = ?
        ORDER BY cm.rowid DESC
        LIMIT ?
      `);
      rows = stmt.all(conversationId, appId, limit + 1) as any[];
    }

    // Check if there are more messages
    const hasMore = rows.length > limit;
    if (hasMore) {
      rows = rows.slice(0, limit); // Remove the extra row
    }

    // Reverse to get chronological order (oldest first)
    rows = rows.reverse();

    // Get cursor for next page (oldest message in current result)
    const nextCursor = hasMore && rows.length > 0 ? rows[0].id : null;

    // Map to ConversationMessage format
    const messages = rows.map(row => {
      const segments = row.segments ? this.normalizeSegments(JSON.parse(row.segments)) : [];
      return {
        id: row.id,
        conversationId: row.conversation_id,
        sender: row.sender,
        content: row.content,
        messageType: row.message_type,
        toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        segments,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        contextAttachments: row.context_attachments ? JSON.parse(row.context_attachments) : undefined,
        createdAt: new Date(row.created_at)
      };
    });

    return { messages, hasMore, nextCursor, total };
  }

  /**
   * Normalize segments to support both camelCase (database) and snake_case (schema) formats
   * Keeps both formats for backward compatibility with API clients
   */
  private normalizeSegments(segments: any[]): any[] {
    return segments.map(segment => {
      if (segment.type === 'tool_call') {
        const toolCall = segment.toolCall || segment.tool_call;
        if (toolCall) {
          const normalizedToolCall = {
            ...toolCall,
            tool_name: toolCall.name || toolCall.tool_name,
            tool_args: toolCall.input || toolCall.tool_args,
            tool_result: toolCall.result || toolCall.output || toolCall.tool_result
          };

          return {
            ...segment,
            tool_call: normalizedToolCall,
            toolCall: normalizedToolCall
          };
        }
      }
      return segment;
    });
  }

  /**
   * Get messages for conversation history processing (LLM context)
   * Returns normalized format with snake_case field names
   *
   * This method is specifically for history loading and ensures consistent
   * field naming regardless of how data is stored in the database.
   */
  async getMessagesForHistory(conversationId: string): Promise<Array<{
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
        tool_args: any;
        tool_result?: any;
        error?: string;
        status?: 'running' | 'success' | 'error';
      };
      timestamp: Date;
    }>;
    createdAt: Date;
  }>> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(conversationId) as any[];

    return rows.map(row => {
      const message: any = {
        id: row.id,
        conversationId: row.conversation_id,
        sender: row.sender,
        content: row.content,
        createdAt: new Date(row.created_at)
      };

      if (row.segments) {
        const rawSegments = JSON.parse(row.segments);
        message.segments = rawSegments.map((seg: any) => {
          const normalized: any = {
            id: seg.id,
            type: seg.type,
            timestamp: new Date(seg.timestamp)
          };

          if (seg.type === 'content') {
            normalized.content = seg.content;
          } else if (seg.type === 'tool_call') {
            const toolCall = seg.toolCall || seg.tool_call;
            if (toolCall) {
              normalized.tool_call = {
                id: toolCall.id,
                tool_name: toolCall.name || toolCall.tool_name,
                tool_args: toolCall.input || toolCall.tool_args,
                tool_result: toolCall.result || toolCall.output || toolCall.tool_result,
                error: toolCall.error
              };
            }
          }

          return normalized;
        });
      }

      return message;
    });
  }

  /**
   * Get messages from multiple conversations in a single query (batch operation)
   */
  async getMessagesBatch(conversationIds: string[]): Promise<ConversationMessage[]> {
    if (conversationIds.length === 0) {
      return [];
    }

    // Create placeholders for the IN clause
    const placeholders = conversationIds.map(() => '?').join(',');

    const stmt = this.db.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id IN (${placeholders})
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(...conversationIds) as any[];

    return rows.map(row => {
      const segments = row.segments ? this.normalizeSegments(JSON.parse(row.segments)) : [];
      return {
        id: row.id,
        conversationId: row.conversation_id,
        sender: row.sender,
        content: row.content,
        messageType: row.message_type,
        toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        segments,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: new Date(row.created_at)
      };
    });
  }

  /**
   * Get estimated token count for messages after a specific message ID
   * Uses content + segments length as a proxy (chars / 4 ≈ tokens)
   * Used for efficient threshold checks before loading full message content
   *
   * @param appId - The app ID to filter conversations
   * @param afterMessageId - Count messages after this message ID (by created_at and rowid)
   * @returns Promise resolving to estimated token count, or null if reference message not found or belongs to different app
   */
  async getEstimatedTokensAfterMessageId(appId: string, afterMessageId: string): Promise<number | null> {
    // Get the timestamp and rowid of the reference message, validating it belongs to the specified appId
    // This prevents cross-app reference bugs where a message ID from another app could be used
    const refStmt = this.db.prepare(`
      SELECT cm.created_at, cm.rowid
      FROM conversation_messages cm
      JOIN conversations c ON cm.conversation_id = c.id
      WHERE cm.id = ? AND c.app_id = ?
    `);
    const refRow = refStmt.get(afterMessageId, appId) as { created_at: string; rowid: number } | undefined;

    if (!refRow) {
      // Reference message not found or belongs to different app
      return null;
    }

    // Sum content lengths after the reference using timestamp + rowid for tie-breaking
    // Uses a single JOIN query for better performance (avoids separate conversation ID fetch)
    // Estimate tokens as total_chars / 4 (rough char-to-token ratio for mixed content)
    const stmt = this.db.prepare(`
      SELECT SUM(LENGTH(cm.content) + LENGTH(COALESCE(cm.segments, ''))) as total_chars
      FROM conversation_messages cm
      JOIN conversations c ON cm.conversation_id = c.id
      WHERE c.app_id = ?
        AND (
          cm.created_at > ?
          OR (cm.created_at = ? AND cm.rowid > ?)
        )
    `);

    const row = stmt.get(appId, refRow.created_at, refRow.created_at, refRow.rowid) as { total_chars: number | null };
    // Convert chars to estimated tokens (4 chars ≈ 1 token)
    return Math.ceil((row.total_chars ?? 0) / 4);
  }

  /**
   * Get estimated token count for all messages in an app
   * Uses content + segments length as a proxy (chars / 4 ≈ tokens)
   * Used for efficient threshold checks before loading full message content
   *
   * @param appId - The app ID
   * @returns Promise resolving to estimated token count
   */
  async getEstimatedTokensForApp(appId: string): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT SUM(LENGTH(cm.content) + LENGTH(COALESCE(cm.segments, ''))) as total_chars
      FROM conversation_messages cm
      JOIN conversations c ON cm.conversation_id = c.id
      WHERE c.app_id = ?
    `);
    const row = stmt.get(appId) as { total_chars: number | null };
    // Convert chars to estimated tokens (4 chars ≈ 1 token)
    return Math.ceil((row.total_chars ?? 0) / 4);
  }

  /**
   * Get messages for an app that come after a specific message ID
   * Used for incremental summarization to load only new messages
   *
   * @param appId - The app ID to filter conversations
   * @param afterMessageId - Load messages after this message ID (by created_at and id)
   * @returns Promise resolving to array of messages
   */
  async getMessagesAfterMessageId(appId: string, afterMessageId: string): Promise<DatabaseMessage[]> {
    // First get the timestamp and rowid of the reference message
    const refStmt = this.db.prepare(`
      SELECT created_at, rowid FROM conversation_messages WHERE id = ?
    `);
    const refRow = refStmt.get(afterMessageId) as { created_at: string; rowid: number } | undefined;

    if (!refRow) {
      // Reference message not found; caller must check getMessageById to distinguish
      // between "no new messages" and "reference missing"
      return [];
    }

    // Get all conversations for this app
    const conversationsStmt = this.db.prepare(`
      SELECT id FROM conversations WHERE app_id = ?
    `);
    const conversations = conversationsStmt.all(appId) as Array<{ id: string }>;

    if (conversations.length === 0) {
      return [];
    }

    // Get all messages after the reference using timestamp + rowid for tie-breaking
    // rowid is monotonically increasing and guarantees correct ordering
    // This handles messages created in the same millisecond (created_at has ms precision)
    const conversationIds = conversations.map(c => c.id);
    const placeholders = conversationIds.map(() => '?').join(',');

    const stmt = this.db.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id IN (${placeholders})
        AND (
          created_at > ?
          OR (created_at = ? AND rowid > ?)
        )
      ORDER BY created_at ASC, rowid ASC
    `);

    const rows = stmt.all(...conversationIds, refRow.created_at, refRow.created_at, refRow.rowid) as any[];

    return rows.map(row => {
      const message: any = {
        id: row.id,
        conversationId: row.conversation_id,
        sender: row.sender,
        content: row.content,
        createdAt: new Date(row.created_at)
      };

      if (row.segments) {
        const rawSegments = JSON.parse(row.segments);
        message.segments = rawSegments.map((seg: any) => {
          const normalized: any = {
            id: seg.id,
            type: seg.type,
            timestamp: new Date(seg.timestamp)
          };

          if (seg.type === 'content') {
            normalized.content = seg.content;
          } else if (seg.type === 'tool_call') {
            const toolCall = seg.toolCall || seg.tool_call;
            if (toolCall) {
              normalized.tool_call = {
                id: toolCall.id,
                tool_name: toolCall.name || toolCall.tool_name,
                tool_args: toolCall.input || toolCall.tool_args,
                tool_result: toolCall.result || toolCall.output || toolCall.tool_result,
                error: toolCall.error
              };
            }
          }

          return normalized;
        });
      }

      return message;
    });
  }

  /**
   * Generate a title from the first user message (truncated)
   */
  generateTitle(firstMessage: string): string {
    const maxLength = 50;
    const cleaned = firstMessage.trim().replace(/\n/g, ' ');

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    return cleaned.substring(0, maxLength - 3) + '...';
  }

  /**
   * Get conversation with message count for UI display
   */
  async getConversationsWithMessageCount(
    appId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Array<Conversation & { messageCount: number }>> {
    const { limit = 50, offset = 0 } = options;

    const stmt = this.db.prepare(`
      SELECT
        c.id,
        c.app_id,
        c.agent_id,
        c.title,
        c.created_at,
        c.updated_at,
        COUNT(cm.id) as message_count
      FROM conversations c
      LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
      WHERE c.app_id = ?
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(appId, limit, offset) as any[];

    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      agentId: row.agent_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      messageCount: row.message_count
    }));
  }

  /**
   * Get total count of conversations for an app
   */
  async getConversationCount(appId: string): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM conversations
      WHERE app_id = ?
    `);

    const row = stmt.get(appId) as any;
    return row.count;
  }

  /**
   * Delete a message by ID
   */
  async deleteMessage(messageId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM conversation_messages WHERE id = ?');
    stmt.run(messageId);
  }

  /**
   * Get the timestamp of the most recent message across all conversations
   *
   * @returns Promise resolving to ISO timestamp string of the last message, or null if no messages exist
   */
  async getLastMessageTimestamp(): Promise<string | null> {
    const result = this.db.prepare('SELECT created_at FROM conversation_messages ORDER BY created_at DESC LIMIT 1').get() as { created_at: string } | undefined;
    return result?.created_at || null;
  }
}
