/**
 * Shared types for conversation messages
 * Used across repository and service layers to avoid circular dependencies
 */

import type { ToolCall } from '../database/schema.js';

/**
 * Raw database message with conversation context
 * This is a lightweight format optimized for history loading and summarization
 */
export interface DatabaseMessage {
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
  toolCalls?: ToolCall[];
  createdAt: Date;
}
