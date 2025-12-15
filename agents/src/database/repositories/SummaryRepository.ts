import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import type { ConversationSummary } from '../schema.js';
import type { SummarizationResult } from '../../services/summarization/SummarizationStrategy.js';

/**
 * Repository for managing conversation summaries in the database
 */
export class SummaryRepository {
  private db = getDatabase();

  /**
   * Create a new conversation summary
   * 
   * @param summary - Summarization result to store
   * @param appId - ID of the app
   * @param conversationId - Optional conversation ID (nullable for multi-conversation summaries)
   * @returns The created summary
   */
  async create(
    summary: SummarizationResult,
    appId: string,
    conversationId?: string
  ): Promise<ConversationSummary> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversation_summaries (
        id, app_id, conversation_id, summary_text,
        message_range_start, message_range_end, message_count,
        original_token_count, summary_token_count, model_used, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      appId,
      conversationId || null,
      summary.summaryText,
      summary.messageRange.startId,
      summary.messageRange.endId,
      summary.messageCount,
      summary.originalTokenCount,
      summary.summaryTokenCount,
      summary.modelUsed,
      now
    );

    const result: ConversationSummary = {
      id,
      appId,
      summaryText: summary.summaryText,
      messageRangeStart: summary.messageRange.startId,
      messageRangeEnd: summary.messageRange.endId,
      messageCount: summary.messageCount,
      originalTokenCount: summary.originalTokenCount,
      summaryTokenCount: summary.summaryTokenCount,
      modelUsed: summary.modelUsed,
      createdAt: new Date(now),
    };

    if (conversationId) {
      result.conversationId = conversationId;
    }

    return result;
  }

  /**
   * Find all summaries for an app
   * 
   * @param appId - ID of the app
   * @returns Array of summaries ordered by creation time (oldest first)
   */
  async findByAppId(appId: string): Promise<ConversationSummary[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_summaries
      WHERE app_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(appId) as any[];

    return rows.map(row => ({
      id: row.id,
      appId: row.app_id,
      conversationId: row.conversation_id || undefined,
      summaryText: row.summary_text,
      messageRangeStart: row.message_range_start,
      messageRangeEnd: row.message_range_end,
      messageCount: row.message_count,
      originalTokenCount: row.original_token_count,
      summaryTokenCount: row.summary_token_count,
      modelUsed: row.model_used,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Find summary by message range
   * 
   * @param startId - Start message ID
   * @param endId - End message ID
   * @returns Summary if found, null otherwise
   */
  async findByMessageRange(startId: string, endId: string): Promise<ConversationSummary | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_summaries
      WHERE message_range_start = ? AND message_range_end = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(startId, endId) as any;

    if (!row) return null;

    return {
      id: row.id,
      appId: row.app_id,
      conversationId: row.conversation_id || undefined,
      summaryText: row.summary_text,
      messageRangeStart: row.message_range_start,
      messageRangeEnd: row.message_range_end,
      messageCount: row.message_count,
      originalTokenCount: row.original_token_count,
      summaryTokenCount: row.summary_token_count,
      modelUsed: row.model_used,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Find the latest summary for an app
   * 
   * @param appId - ID of the app
   * @returns Latest summary if found, null otherwise
   */
  async findLatestForApp(appId: string): Promise<ConversationSummary | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_summaries
      WHERE app_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(appId) as any;

    if (!row) return null;

    return {
      id: row.id,
      appId: row.app_id,
      conversationId: row.conversation_id || undefined,
      summaryText: row.summary_text,
      messageRangeStart: row.message_range_start,
      messageRangeEnd: row.message_range_end,
      messageCount: row.message_count,
      originalTokenCount: row.original_token_count,
      summaryTokenCount: row.summary_token_count,
      modelUsed: row.model_used,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Delete all summaries for an app
   * 
   * @param appId - ID of the app
   */
  async deleteByAppId(appId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM conversation_summaries WHERE app_id = ?');
    stmt.run(appId);
  }

  /**
   * Delete a specific summary by ID
   * 
   * @param summaryId - ID of the summary to delete
   */
  async deleteById(summaryId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM conversation_summaries WHERE id = ?');
    stmt.run(summaryId);
  }
}

