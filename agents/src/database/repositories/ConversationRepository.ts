import { nanoid } from 'nanoid';
import { getDatabase } from '../connection.js';
import type { Conversation, ConversationMessage, ToolCall, MessageSegment } from '../schema.js';

export class ConversationRepository {
  private db = getDatabase();

  /**
   * Create a new conversation
   */
  async create(appId: string, agentId: string, title?: string): Promise<Conversation> {
    const id = nanoid(12);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, app_id, agent_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, appId, agentId, title, now, now);

    const conversation: Conversation = {
      id,
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
    } = {}
  ): Promise<ConversationMessage> {
    const id = nanoid(12);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversation_messages 
      (id, conversation_id, sender, content, message_type, tool_calls, segments, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    return message;
  }

  /**
   * Update a message (useful for streaming updates)
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
      updateFields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
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
   * Get all messages for a conversation
   */
  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_messages 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(conversationId) as any[];

    return rows.map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender,
      content: row.content,
      messageType: row.message_type,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      segments: row.segments ? JSON.parse(row.segments) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at)
    }));
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

    return rows.map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender,
      content: row.content,
      messageType: row.message_type,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      segments: row.segments ? JSON.parse(row.segments) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at)
    }));
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
}