import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';
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
    if (message.role !== 'tool' || message.name !== 'readFile') {
      return null;
    }

    // Try to get file path from tool call arguments in previous assistant message
    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
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

    // Fallback: try to extract from content
    // Look for patterns like "Read file: /path/to/file" or "File: /path/to/file"
    const match = message.content?.match(/(?:File|Path|file_path|path):\s*([^\n]+)/i);
    if (match && match[1]) {
      return match[1].trim();
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

    if (message.role !== 'tool' || message.name !== 'readFile') {
      return false;
    }

    const filePath = this.extractFilePath(message, previousMessage);
    if (!filePath) {
      return false;
    }

    if (this.hotFileStrategy?.isHotFile(filePath)) {
      return true;
    }

    const reads = this.fileReads.get(filePath);
    if (!reads || reads.length <= 1) {
      return false;
    }

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

    if (this.hotFileStrategy?.isHotFile(filePath)) {
      return {
        ...message,
        content: `[File "${filePath}" is included in hot files context - redundant read removed]`,
      };
    }

    const reads = this.fileReads.get(filePath);
    const mostRecentIndex = reads ? Math.max(...reads) : -1;

    return {
      ...message,
      content: `[Duplicate file read removed - see message #${mostRecentIndex + 1} for most recent read of: ${filePath}]`,
    };
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
