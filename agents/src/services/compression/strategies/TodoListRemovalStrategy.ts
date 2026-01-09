import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import { type LLMMessage, isAIToolMessage, isOpenAIMessage } from '../../ConversationHistoryLoader.js';

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
  readonly strategyType = 'removal' as const;

  /**
   * Check if this message is a todoList tool call or result
   */
  canCompress(context: CompressionContext): boolean {
    const { message } = context;

    // Case 1: Tool result message for todoList (AI SDK v6 format)
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (toolResult?.toolName === 'todoList') {
        return true;
      }
    }

    // Case 2: Tool result message for todoList (OpenAI format from convertToLLMMessages)
    if (message.role === 'tool' && isOpenAIMessage(message) && message.name === 'todoList') {
      return true;
    }

    // Case 3: Assistant message with todoList tool calls (OpenAI format)
    if (message.role === 'assistant' && isOpenAIMessage(message) && message.tool_calls) {
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

