import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';
import type { HotFileInclusionStrategy } from './HotFileInclusionStrategy.js';
import { logger } from '../../../logging/index.js';

export class FileEditCompressionStrategy implements CompressionStrategy {
  readonly name = 'file-edit-compression';

  private hotFileStrategy: HotFileInclusionStrategy | undefined = undefined;

  constructor(hotFileStrategy?: HotFileInclusionStrategy) {
    this.hotFileStrategy = hotFileStrategy;
  }

  setHotFileStrategy(strategy: HotFileInclusionStrategy): void {
    this.hotFileStrategy = strategy;
  }

  canCompress(context: CompressionContext): boolean {
    const { message, previousMessage } = context;

    if (message.role !== 'tool' || message.name !== 'fileEdit') {
      return false;
    }

    if (!this.hotFileStrategy) {
      return false;
    }

    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );

      if (matchingToolCall) {
        // Parse arguments - this can legitimately fail with malformed JSON
        let args;
        try {
          args = JSON.parse(matchingToolCall.function.arguments);
        } catch (error) {
          // JSON parse failures may indicate integration issues
          logger.warn('compression.file.edit.parse.failed', {
            toolCallId: matchingToolCall.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }

        // Check if compression is applicable - this should not fail
        try {
          // Handle batch operations (new schema)
          if (args.operations && Array.isArray(args.operations)) {
            for (const op of args.operations) {
              const filePath: string | undefined = op.path || op.file_path || op.filePath;
              if (filePath && this.hotFileStrategy.isHotFile(filePath)) {
                return true;
              }
            }
          } else {
            // Handle single operation (legacy schema)
            const filePath: string | undefined = args.path || args.file_path || args.filePath;
            if (filePath && this.hotFileStrategy.isHotFile(filePath)) {
              return true;
            }
          }
        } catch (error) {
          // This shouldn't happen - indicates a bug in canCompress logic
          logger.error('compression.file.edit.can.compress.error', {
            toolCallId: matchingToolCall.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          return false;
        }
      }
    }

    return false;
  }

  compress(context: CompressionContext): LLMMessage | null {
    const { message, previousMessage } = context;

    if (!previousMessage?.tool_calls) {
      return null;
    }

    const matchingToolCall = previousMessage.tool_calls.find(
      (tc) => tc.id === message.tool_call_id
    );

    if (!matchingToolCall) {
      return null;
    }

    // Parse arguments - this can legitimately fail with malformed JSON
    let args;
    try {
      args = JSON.parse(matchingToolCall.function.arguments);
    } catch (error) {
      // JSON parse failures may indicate integration issues
      logger.warn('compression.file.edit.parse.failed', {
        toolCallId: matchingToolCall.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    // Process the compression logic - this should not fail, but handle defensively
    try {
      // Handle batch operations (new schema)
      if (args.operations && Array.isArray(args.operations)) {
        const hotFileOps = args.operations.filter((op: any) => {
          const filePath = op.path || op.file_path || op.filePath;
          return filePath && this.hotFileStrategy?.isHotFile(filePath);
        });

        if (hotFileOps.length === 0) {
          return null;
        }

        const summary =
          `Files edited (${hotFileOps.length} hot files):\n` +
          hotFileOps.map((op: any) => {
            const filePath = op.path || op.file_path || op.filePath;
            const mode = op.mode || 'edit';
            return `  • ${filePath} (${mode})`;
          }).join('\n') +
          `\n\n[Full file content available in hot files context]\n` +
          `[Edit details compressed - files are included in hot files]`;

        logger.debug('compression.file.edit.compressed', {
          fileCount: hotFileOps.length,
          originalLength: message.content?.length || 0,
          compressedLength: summary.length,
        });

        return {
          ...message,
          content: summary,
        };
      } else {
        // Handle single operation (legacy schema)
        const filePath: string | undefined = args.path || args.file_path || args.filePath;
        const mode = args.mode || 'edit';

        if (!filePath) {
          return null;
        }

        let linesChanged = 0;
        const content = message.content || '';
        const linesMatch = content.match(/(\d+)\s+lines?\s+changed/i);
        if (linesMatch && linesMatch[1]) {
          linesChanged = parseInt(linesMatch[1], 10);
        }

        const summary =
          `✅ File edited: ${filePath}\n` +
          `Mode: ${mode}\n` +
          `Lines changed: ${linesChanged > 0 ? linesChanged : 'unknown'}\n\n` +
          `[Full file content available in hot files context]\n` +
          `[Edit details compressed - file is included in hot files]`;

        logger.debug('compression.file.edit.compressed', {
          filePath,
          mode,
          linesChanged,
          originalLength: message.content?.length || 0,
          compressedLength: summary.length,
        });

        return {
          ...message,
          content: summary,
        };
      }
    } catch (error) {
      // This shouldn't happen - indicates a bug in compression logic
      logger.error('compression.file.edit.unexpected.error', {
        toolCallId: matchingToolCall.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }
}
