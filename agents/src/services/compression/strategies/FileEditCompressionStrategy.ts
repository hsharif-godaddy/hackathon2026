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
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          const filePath: string | undefined = args.path || args.file_path || args.filePath;

          if (filePath && this.hotFileStrategy.isHotFile(filePath)) {
            return true;
          }
        } catch {
          // Ignore JSON parse errors
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

    let filePath: string | undefined;
    let mode = 'edit';
    let linesChanged = 0;

    try {
      const args = JSON.parse(matchingToolCall.function.arguments);
      filePath = args.path || args.file_path || args.filePath;
      mode = args.mode || 'edit';

      const content = message.content || '';
      const linesMatch = content.match(/(\d+)\s+lines?\s+changed/i);
      if (linesMatch && linesMatch[1]) {
        linesChanged = parseInt(linesMatch[1], 10);
      }
    } catch {
      // Ignore JSON parse errors
    }

    if (!filePath) {
      return null;
    }

    const summary =
      `✅ File edited: ${filePath}\n` +
      `Mode: ${mode}\n` +
      `Lines changed: ${linesChanged > 0 ? linesChanged : 'unknown'}\n\n` +
      `[Full file content available in hot files context]\n` +
      `[Edit details compressed - file is included in hot files]`;

    logger.debug('file_edit.compressed', {
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
}
