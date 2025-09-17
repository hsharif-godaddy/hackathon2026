import { getDatabase } from '../connection.js';
import { nanoid } from 'nanoid';
import type { TokenUsage } from '../schema.js';

export class TokenUsageRepository {
  private db = getDatabase();

  /**
   * Record token usage for an operation
   */
  async recordUsage(
    appId: string,
    operation: 'llm_request' | 'file_edit' | 'tool_execution',
    promptTokens: number,
    completionTokens: number,
    options: {
      model?: string | undefined;
      conversationId?: string | undefined;
      description?: string | undefined;
      cost?: number | undefined;
      cacheReadTokens?: number | undefined;
      cacheWriteTokens?: number | undefined;
    } = {}
  ): Promise<TokenUsage> {
    const id = nanoid(12);
    const now = new Date().toISOString();
    const totalTokens = promptTokens + completionTokens;
    
    // Calculate cost if not provided (rough estimates)
    let cost = options.cost;
    if (!cost && options.model) {
      cost = this.calculateCost(options.model, promptTokens, completionTokens);
    }

    const stmt = this.db.prepare(`
      INSERT INTO token_usage (
        id, app_id, operation, prompt_tokens, completion_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, model, cost, conversation_id, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      appId,
      operation,
      promptTokens,
      completionTokens,
      totalTokens,
      options.cacheReadTokens || 0,
      options.cacheWriteTokens || 0,
      options.model || null,
      cost || 0,
      options.conversationId || null,
      options.description || null,
      now
    );

    return {
      id,
      appId,
      operation,
      promptTokens,
      completionTokens,
      totalTokens,
      cacheReadTokens: options.cacheReadTokens || 0,
      cacheWriteTokens: options.cacheWriteTokens || 0,
      model: options.model || undefined,
      cost: cost || undefined,
      conversationId: options.conversationId || undefined,
      description: options.description || undefined,
      createdAt: new Date(now)
    };
  }

  /**
   * Get basic token usage info for an app
   */
  getUsageInfo(appId: string): {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    operationCounts: {
      llm_request: number;
      file_edit: number;
      tool_execution: number;
    };
    lastUsed: Date | null;
  } | null {
    const stmt = this.db.prepare(`
      SELECT 
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        SUM(cost) as total_cost,
        COUNT(CASE WHEN operation = 'llm_request' THEN 1 END) as llm_requests,
        COUNT(CASE WHEN operation = 'file_edit' THEN 1 END) as file_edits,
        COUNT(CASE WHEN operation = 'tool_execution' THEN 1 END) as tool_executions,
        MAX(created_at) as last_used
      FROM token_usage 
      WHERE app_id = ?
    `);

    const result = stmt.get(appId) as any;
    if (!result || !result.total_tokens) return null;

    return {
      totalTokens: result.total_tokens || 0,
      promptTokens: result.prompt_tokens || 0,
      completionTokens: result.completion_tokens || 0,
      totalCost: result.total_cost || 0,
      operationCounts: {
        llm_request: result.llm_requests || 0,
        file_edit: result.file_edits || 0,
        tool_execution: result.tool_executions || 0
      },
      lastUsed: result.last_used ? new Date(result.last_used) : null
    };
  }

  /**
   * Get detailed token usage history for an app
   */
  getUsageHistory(
    appId: string,
    options: {
      limit?: number;
      offset?: number;
      operation?: 'llm_request' | 'file_edit' | 'tool_execution';
      conversationId?: string;
    } = {}
  ): TokenUsage[] {
    const { limit = 50, offset = 0, operation, conversationId } = options;
    
    let query = `
      SELECT * FROM token_usage 
      WHERE app_id = ?
    `;
    const params: any[] = [appId];

    if (operation) {
      query += ` AND operation = ?`;
      params.push(operation);
    }

    if (conversationId) {
      query += ` AND conversation_id = ?`;
      params.push(conversationId);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params) as any[];

    return results.map(row => ({
      id: row.id,
      appId: row.app_id,
      operation: row.operation,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      model: row.model,
      cost: row.cost,
      conversationId: row.conversation_id,
      description: row.description,
      createdAt: new Date(row.created_at)
    }));
  }



  /**
   * Delete all token usage records for an app
   */
  deleteAppUsage(appId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM token_usage WHERE app_id = ?`);
    const result = stmt.run(appId);
    return result.changes > 0;
  }

  /**
   * Calculate estimated cost based on model and token usage
   * These are rough estimates - you should update with actual pricing
   */
  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Pricing per 1K tokens, rough estimates as of 2025
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 }, // Claude 3 Sonnet
      'claude-haiku-3': { input: 0.00025, output: 0.00125 }, // Claude 3 Haiku
      'gpt-4o': { input: 0.005, output: 0.015 }, // GPT-4o
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // GPT-4o mini
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 }, // GPT-3.5 Turbo
      'gpt-5': { input: 0.00125, output: 0.010 },    // GPT-5 – $1.25/m input, $10/m output
      'gpt-5-mini': { input: 0.00025, output: 0.002 },    // GPT-5 mini – $0.25/m input, $2/m output
      'gpt-5-nano': { input: 0.00005, output: 0.0004 },   // GPT-5 nano – $0.05/m input, $0.40/m output
    };

    const modelPricing = pricing[model] || pricing['claude-sonnet-4-20250514']; // Default to Claude pricing
    
    if (!modelPricing) {
      return 0; // Return 0 cost if pricing not found
    }
    
    const inputCost = (promptTokens / 1000) * modelPricing.input;
    const outputCost = (completionTokens / 1000) * modelPricing.output;
    
    return inputCost + outputCost;
  }

  /**
   * Get token usage statistics by time period
   */
  getUsageByPeriod(
    appId: string,
    period: 'day' | 'week' | 'month',
    limit: number = 30
  ): Array<{ date: string; totalTokens: number; cost: number }> {
    let dateFormat: string;
    switch (period) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-%W';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
    }

    const stmt = this.db.prepare(`
      SELECT 
        strftime('${dateFormat}', created_at) as date,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as cost
      FROM token_usage 
      WHERE app_id = ?
      GROUP BY strftime('${dateFormat}', created_at)
      ORDER BY date DESC
      LIMIT ?
    `);

    const results = stmt.all(appId, limit) as any[];
    return results.map(row => ({
      date: row.date,
      totalTokens: row.total_tokens || 0,
      cost: row.cost || 0
    }));
  }
}
