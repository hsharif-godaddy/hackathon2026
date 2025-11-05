import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Compresses todoList create_list results by removing duplicate data
 * The result contains the same information as the input (list name, items, etc.)
 * so we can replace it with a concise summary
 */
export class TodoCreateResultSummarizer implements CompressionStrategy {
  readonly name = 'todo-create-result-summarizer';

  /**
   * Check if this is a todoList create_list result
   */
  canCompress(context: CompressionContext): boolean {
    const { message, previousMessage } = context;

    if (message.role !== 'tool' || message.name !== 'todoList') {
      return false;
    }

    // Check if the previous message has a create_list operation
    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );
      
      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          return args.operation === 'create_list';
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Fallback: check if result contains CREATE_LIST marker
    return message.content?.includes('Todo List CREATE LIST') || false;
  }

  /**
   * Compress the create_list result to a concise summary
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message, previousMessage } = context;

    // Extract info from the tool call arguments and result
    let listName = 'Unknown List';
    let listId = '';
    let itemIds: string[] = [];

    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );
      
      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          listName = args.listName || args.list_name || listName;
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Parse the JSON result to get list ID and item IDs
    try {
      const result = JSON.parse(message.content || '{}');
      if (result.list) {
        listId = result.list.id || '';
        itemIds = result.list.items?.map((item: any) => item.id) || [];
      }
    } catch {
      // Ignore parse errors
    }

    // Create concise summary with IDs
    const summary = `✅ Created todo list: "${listName}"\nList ID: ${listId}\nItem IDs: ${itemIds.join(', ')}`;

    return {
      ...message,
      content: summary,
    };
  }
}
