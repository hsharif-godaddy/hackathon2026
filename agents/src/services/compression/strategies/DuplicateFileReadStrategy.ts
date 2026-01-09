import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import {
  type LLMMessage,
  type AIToolMessage,
  type ToolResultPart,
  isAIToolMessage,
  isOpenAIMessage,
} from '../../ConversationHistoryLoader.js';
import type { HotFileInclusionStrategy } from './HotFileInclusionStrategy.js';

/**
 * Compresses duplicate file reads by keeping only the most recent read of each file
 * Removes older reads of the same file from the conversation history
 * Skips files that are in hot files list (they're already included)
 */
export class DuplicateFileReadStrategy implements CompressionStrategy {
  readonly name = 'duplicate-file-read';
  
  private fileReads = new Map<string, number[]>(); // filePath -> messageIndices
  private hotFileStrategy: HotFileInclusionStrategy | undefined = undefined;

  constructor(hotFileStrategy?: HotFileInclusionStrategy) {
    this.hotFileStrategy = hotFileStrategy;
  }

  setHotFileStrategy(strategy: HotFileInclusionStrategy): void {
    this.hotFileStrategy = strategy;
  }

  /**
   * Extract file path from readFile tool call arguments
   */
  private extractFilePath(message: LLMMessage, previousMessage?: LLMMessage): string | null {
    if (message.role !== 'tool') {
      return null;
    }

    let toolCallId: string | undefined;
    let contentToSearch: string | undefined;

    // Check AI SDK v6 format
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (!toolResult || toolResult.toolName !== 'readFile') {
        return null;
      }
      toolCallId = toolResult.toolCallId;
      const output = toolResult.output;
      if (output && typeof output === 'object' && 'type' in output && output.type === 'text' && 'value' in output) {
        contentToSearch = (output as { type: 'text'; value: string }).value;
      }
    }
    // Check OpenAI format (from convertToLLMMessages)
    else if (isOpenAIMessage(message) && message.name === 'readFile') {
      toolCallId = message.tool_call_id;
      contentToSearch = message.content;
    } else {
      return null;
    }

    // Try to get file path from tool call arguments in previous assistant message
    if (toolCallId && previousMessage?.role === 'assistant' && isOpenAIMessage(previousMessage) && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === toolCallId
      );

      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          return args.file_path || args.path || args.filePath || null;
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Fallback: try to extract from output content
    if (contentToSearch) {
      const match = contentToSearch.match(/(?:File|Path|file_path|path):\s*([^\n]+)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * First pass: collect all file reads to identify duplicates
   * This needs to be called before compression
   */
  analyzeMessages(messages: LLMMessage[]): void {
    this.fileReads.clear();

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;
      const previousMessage = i > 0 ? messages[i - 1] : undefined;
      
      const filePath = this.extractFilePath(message, previousMessage);
      if (filePath) {
        if (!this.fileReads.has(filePath)) {
          this.fileReads.set(filePath, []);
        }
        this.fileReads.get(filePath)!.push(i);
      }
    }
  }

  /**
   * Check if this is a duplicate file read that should be removed
   */
  canCompress(context: CompressionContext): boolean {
    const { message, messageIndex, previousMessage } = context;

    if (message.role !== 'tool') {
      return false;
    }

    // Check AI SDK v6 format
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (!toolResult || toolResult.toolName !== 'readFile') {
        return false;
      }
    }
    // Check OpenAI format (from convertToLLMMessages)
    else if (isOpenAIMessage(message) && message.name === 'readFile') {
      // Valid OpenAI format readFile message
    } else {
      return false;
    }

    const filePath = this.extractFilePath(message, previousMessage);
    if (!filePath) {
      return false;
    }

    // CRITICAL: Hot files are already included in hot files context
    // Remove ALL reads of hot files, even if it's the only read
    if (this.hotFileStrategy?.isHotFile(filePath)) {
      return true;
    }

    const reads = this.fileReads.get(filePath);
    if (!reads || reads.length <= 1) {
      return false;
    }

    // Always keep the most recent read, compress older ones
    const mostRecentIndex = Math.max(...reads);
    return messageIndex < mostRecentIndex;
  }

  /**
   * Compress by replacing with a placeholder message
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message, previousMessage } = context;

    const filePath = this.extractFilePath(message, previousMessage);
    if (!filePath) {
      return null;
    }

    let compressedText: string;
    if (this.hotFileStrategy?.isHotFile(filePath)) {
      compressedText = `[File "${filePath}" is included in hot files context - redundant read removed]`;
    } else {
      const reads = this.fileReads.get(filePath);
      const mostRecentIndex = reads ? Math.max(...reads) : -1;
      compressedText = `[Duplicate file read removed - see message #${mostRecentIndex + 1} for most recent read of: ${filePath}]`;
    }

    // Return in same format as input
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (!toolResult) {
        return null;
      }
      const compressedResult: ToolResultPart = {
        type: 'tool-result',
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        output: { type: 'text', value: compressedText },
      };
      return { role: 'tool', content: [compressedResult] } as AIToolMessage;
    } else if (isOpenAIMessage(message) && message.role === 'tool' && message.tool_call_id && message.name) {
      // Return OpenAI format for OpenAI input
      return {
        role: 'tool',
        content: compressedText,
        tool_call_id: message.tool_call_id,
        name: message.name,
      };
    }

    return null;
  }

  /**
   * Get statistics about duplicate file reads
   */
  getStats(): {
    totalFiles: number;
    filesWithDuplicates: number;
    totalReads: number;
    duplicateReads: number;
  } {
    let totalReads = 0;
    let duplicateReads = 0;
    let filesWithDuplicates = 0;

    for (const reads of this.fileReads.values()) {
      totalReads += reads.length;
      if (reads.length > 1) {
        filesWithDuplicates++;
        duplicateReads += reads.length - 1; // All but the most recent
      }
    }

    return {
      totalFiles: this.fileReads.size,
      filesWithDuplicates,
      totalReads,
      duplicateReads,
    };
  }

  /**
   * Clear internal state
   */
  clear(): void {
    this.fileReads.clear();
  }
}
