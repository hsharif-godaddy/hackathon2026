import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Removes ALL todoList tool calls and results from conversation history
 * 
 * The persistent [Current Todo List] context section is the single source of truth
 * for todo list state. Historical todo list operations are redundant and consume
 * tokens unnecessarily.
 * 
 * This strategy removes:
 * - Assistant messages with todoList tool calls
 * - Tool result messages for todoList operations
 */
export class TodoListRemovalStrategy implements CompressionStrategy {
  readonly name = 'todo-list-removal';

  /**
   * Check if this message is a todoList tool call or result
   */
  canCompress(context: CompressionContext): boolean {
    const { message, previousMessage } = context;

    // Case 1: This is a tool result message for todoList
    if (message.role === 'tool' && message.name === 'todoList') {
      return true;
    }

    // Case 2: This is an assistant message with todoList tool calls
    if (message.role === 'assistant' && message.tool_calls) {
      const hasTodoListCall = message.tool_calls.some(
        (tc) => tc.function.name === 'todoList'
      );
      if (hasTodoListCall) {
        return true;
      }
    }

    return false;
  }

  /**
   * Remove the message completely by returning null
   */
  compress(context: CompressionContext): LLMMessage | null {
    // Returning null removes the message from history
    return null;
  }
}

