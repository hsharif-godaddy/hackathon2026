import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Aggregates multiple todoList mark_done operations into a single summary
 * Instead of showing verbose output for each completed item, shows a concise list
 */
export class TodoMarkDoneAggregator implements CompressionStrategy {
  readonly name = 'todo-mark-done-aggregator';
  
  private markDoneIndices: number[] = [];
  private completedItems: Array<{ id: string; title: string; messageIndex: number }> = [];
  private listId: string | null = null;

  /**
   * Extract completed item info from mark_done result (now JSON format)
   */
  private extractCompletedItems(content: string): Array<{ id: string; title: string }> {
    try {
      const result = JSON.parse(content);
      if (result.items && Array.isArray(result.items)) {
        return result.items.map((item: any) => ({
          id: item.id || '',
          title: item.title || 'Unknown item'
        }));
      }
      if (result.item) {
        return [{
          id: result.item.id || '',
          title: result.item.title || 'Unknown item'
        }];
      }
    } catch {
      // Fallback to old markdown format
      const match = content.match(/1\.\s*✅\s*([^\n]+)/);
      if (match && match[1]) {
        return [{ id: '', title: match[1].trim() }];
      }

      const titleMatch = content.match(/Affected Items.*?✅\s*([^\n]+)/s);
      if (titleMatch && titleMatch[1]) {
        return [{ id: '', title: titleMatch[1].trim() }];
      }
    }

    return [];
  }

  /**
   * Extract list ID from tool call arguments
   */
  private extractListId(message: LLMMessage, previousMessage?: LLMMessage): string | null {
    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );
      
      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          return args.listId || args.listName || null;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Check if this is a mark_done operation
   */
  private isMarkDone(message: LLMMessage, previousMessage?: LLMMessage): boolean {
    if (message.role !== 'tool' || message.name !== 'todoList') {
      return false;
    }

    // Check if previous message has mark_done operation
    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );
      
      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          return args.operation === 'mark_done';
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Fallback: check if result contains MARK DONE marker
    return message.content?.includes('MARK DONE') || false;
  }

  /**
   * First pass: collect all mark_done operations
   */
  analyzeMessages(messages: LLMMessage[]): void {
    this.markDoneIndices = [];
    this.completedItems = [];
    this.listId = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;
      const previousMessage = i > 0 ? messages[i - 1] : undefined;
      
      if (this.isMarkDone(message, previousMessage)) {
        this.markDoneIndices.push(i);
        
        if (!this.listId) {
          this.listId = this.extractListId(message, previousMessage);
        }
        
        const items = this.extractCompletedItems(message.content || '');
        items.forEach(item => {
          this.completedItems.push({
            id: item.id,
            title: item.title,
            messageIndex: i,
          });
        });
      }
    }
  }

  /**
   * Check if this is a mark_done that should be compressed
   */
  canCompress(context: CompressionContext): boolean {
    const { message, messageIndex, previousMessage } = context;

    if (!this.isMarkDone(message, previousMessage)) {
      return false;
    }

    // Only compress if there are multiple mark_done operations
    return this.markDoneIndices.length > 1;
  }

  /**
   * Compress by replacing with placeholder or summary
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { messageIndex } = context;

    const lastMarkDoneIndex = this.markDoneIndices[this.markDoneIndices.length - 1];
    if (lastMarkDoneIndex === undefined) {
      return null;
    }

    if (messageIndex === lastMarkDoneIndex) {
      // This is the last mark_done - replace with aggregate summary with IDs
      const itemList = this.completedItems
        .map((item, idx) => `${idx + 1}. ${item.title} (ID: ${item.id})`)
        .join('\n');

      const listIdStr = this.listId ? ` (List: ${this.listId})` : '';
      const itemIds = this.completedItems.map(item => item.id).filter(id => id).join(', ');
      return {
        ...context.message,
        content: `✅ Completed ${this.completedItems.length} item(s)${listIdStr}\nItem IDs: ${itemIds}\n\n${itemList}`,
      };
    } else {
      // Earlier mark_done - replace with placeholder
      const listIdStr = this.listId ? ` in list "${this.listId}"` : '';
      return {
        ...context.message,
        content: `[Todo item completed${listIdStr} - see summary below]`,
      };
    }
  }

  /**
   * Get statistics about mark_done operations
   */
  getStats(): {
    totalMarkDone: number;
    itemsCompleted: number;
  } {
    return {
      totalMarkDone: this.markDoneIndices.length,
      itemsCompleted: this.completedItems.length,
    };
  }

  /**
   * Clear internal state
   */
  clear(): void {
    this.markDoneIndices = [];
    this.completedItems = [];
    this.listId = null;
  }
}
