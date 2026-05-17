/**
 * Types for conversation history processing
 * 
 * This module defines normalized types for loading conversation history
 * from the database for LLM context. These types differ from the raw
 * database schema to ensure consistent processing.
 */

/**
 * Normalized tool call structure for LLM processing
 */
export interface NormalizedToolCall {
  id: string;
  toolName: string;
  toolArgs: any;
  toolResult?: any;
  error?: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  status: 'running' | 'success' | 'error';
}

/**
 * Normalized message segment for LLM processing
 */
export interface NormalizedMessageSegment {
  id: string;
  type: 'content' | 'tool_call';
  content?: string;
  tool_call?: NormalizedToolCall;
  timestamp: Date;
}

/**
 * Normalized conversation message for LLM processing
 * This is what the history loader expects to work with
 */
export interface NormalizedConversationMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  segments?: NormalizedMessageSegment[];
  origin: 'support' | 'customer';
  createdAt: Date;
}
