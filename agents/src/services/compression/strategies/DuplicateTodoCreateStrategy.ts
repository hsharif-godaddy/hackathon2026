import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Compresses duplicate todo list create operations
 * Similar to DuplicateFileReadStrategy but for todoList create_list operations
 */
export class DuplicateTodoCreateStrategy implements CompressionStrategy {
  readonly name = 'duplicate-todo-create';
  
  private todoCreates = new Map<string, number[]>(); // listName -> messageIndices

  /**
   * Extract list name from todoList create_list tool call
   */
  private extractListName(message: LLMMessage, previousMessage?: LLMMessage): string | null {
    if (message.role !== 'tool' || message.name !== 'todoList') {
      return null;
    }

    // Try to get list name from tool call arguments in previous assistant message
    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );
      
      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          if (args.operation === 'create_list') {
            return args.listName || args.list_name || null;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return null;
  }

  /**
   * First pass: collect all todo create operations to identify duplicates
   */
  analyzeMessages(messages: LLMMessage[]): void {
    this.todoCreates.clear();

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;
      const previousMessage = i > 0 ? messages[i - 1] : undefined;
      
      const listName = this.extractListName(message, previousMessage);
      if (listName) {
        if (!this.todoCreates.has(listName)) {
          this.todoCreates.set(listName, []);
        }
        this.todoCreates.get(listName)!.push(i);
      }
    }
  }

  /**
   * Check if this is a duplicate todo create that should be removed
   */
  canCompress(context: CompressionContext): boolean {
    const { message, messageIndex, previousMessage } = context;

    if (message.role !== 'tool' || message.name !== 'todoList') {
      return false;
    }

    const listName = this.extractListName(message, previousMessage);
    if (!listName) {
      return false;
    }

    const creates = this.todoCreates.get(listName);
    if (!creates || creates.length <= 1) {
      // Only one create of this list, keep it
      return false;
    }

    // Check if this is NOT the most recent create
    const mostRecentIndex = Math.max(...creates);
    return messageIndex < mostRecentIndex;
  }

  /**
   * Compress by replacing with a placeholder message
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message, previousMessage } = context;
    
    const listName = this.extractListName(message, previousMessage);
    if (!listName) {
      return null;
    }

    const creates = this.todoCreates.get(listName);
    const mostRecentIndex = creates ? Math.max(...creates) : -1;

    return {
      ...message,
      content: `[Duplicate todo list create removed - see message #${mostRecentIndex + 1} for most recent version of: ${listName}]`,
    };
  }

  /**
   * Get statistics about duplicate todo creates
   */
  getStats(): {
    totalLists: number;
    listsWithDuplicates: number;
    totalCreates: number;
    duplicateCreates: number;
  } {
    let totalCreates = 0;
    let duplicateCreates = 0;
    let listsWithDuplicates = 0;

    for (const creates of this.todoCreates.values()) {
      totalCreates += creates.length;
      if (creates.length > 1) {
        listsWithDuplicates++;
        duplicateCreates += creates.length - 1; // All but the most recent
      }
    }

    return {
      totalLists: this.todoCreates.size,
      listsWithDuplicates,
      totalCreates,
      duplicateCreates,
    };
  }

  /**
   * Clear internal state
   */
  clear(): void {
    this.todoCreates.clear();
  }
}
