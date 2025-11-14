import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';
import type { HotFileInclusionStrategy } from './HotFileInclusionStrategy.js';
import { logger } from '../../../logging/index.js';

/**
 * Compresses fileEdit tool call inputs when the file was successfully created/rewritten
 * and is included in hot files. Removes the large 'content' field from input to save tokens.
 */
export class FileEditInputCompressionStrategy implements CompressionStrategy {
  readonly name = 'file-edit-input-compression';

  private hotFileStrategy: HotFileInclusionStrategy | undefined = undefined;

  constructor(hotFileStrategy?: HotFileInclusionStrategy) {
    this.hotFileStrategy = hotFileStrategy;
  }

  setHotFileStrategy(strategy: HotFileInclusionStrategy): void {
    this.hotFileStrategy = strategy;
  }

  analyzeMessages(messages: LLMMessage[]): void {
    // No pre-analysis needed
  }

  canCompress(context: CompressionContext): boolean {
    const { message } = context;

    if (message.role !== 'assistant' || !message.tool_calls) {
      return false;
    }

    if (!this.hotFileStrategy) {
      return false;
    }

    const hasCompressibleFileEdit = message.tool_calls.some((tc) => {
      if (tc.function.name !== 'fileEdit') {
        return false;
      }

      try {
        const args = JSON.parse(tc.function.arguments);
        const mode = args.mode;
        const filePath: string | undefined = args.path || args.file_path || args.filePath;

        if (!filePath || !args.content) {
          return false;
        }

        if (mode !== 'create' && mode !== 'rewrite') {
          return false;
        }

        return this.hotFileStrategy!.isHotFile(filePath);
      } catch {
        return false;
      }
    });

    return hasCompressibleFileEdit;
  }

  compress(context: CompressionContext): LLMMessage | null {
    const { message, nextMessage } = context;

    if (!message.tool_calls) {
      return null;
    }

    let totalSavings = 0;
    const compressedToolCalls = message.tool_calls.map((tc) => {
      if (tc.function.name !== 'fileEdit') {
        return tc;
      }

      try {
        const args = JSON.parse(tc.function.arguments);
        const mode = args.mode;
        const filePath: string | undefined = args.path || args.file_path || args.filePath;

        if (!filePath || !args.content) {
          return tc;
        }

        if (mode !== 'create' && mode !== 'rewrite') {
          return tc;
        }

        if (!this.hotFileStrategy!.isHotFile(filePath)) {
          return tc;
        }

        const originalContentLength = args.content.length;
        const compressedArgs = { ...args };
        delete compressedArgs.content;
        compressedArgs._compressed = true;
        compressedArgs._original_content_length = originalContentLength;

        totalSavings += originalContentLength;

        return {
          ...tc,
          function: {
            ...tc.function,
            arguments: JSON.stringify(compressedArgs),
          },
        };
      } catch {
        return tc;
      }
    });

    if (totalSavings > 0) {
      logger.debug('compression.file_edit_input.compressed', {
        messageIndex: context.messageIndex,
        originalToolCalls: message.tool_calls.length,
        compressedToolCalls: compressedToolCalls.length,
        totalSavings,
      });

      return {
        ...message,
        tool_calls: compressedToolCalls,
      };
    }

    return null;
  }
}
