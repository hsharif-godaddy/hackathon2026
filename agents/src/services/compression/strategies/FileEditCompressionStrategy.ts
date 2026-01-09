import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import {
  type LLMMessage,
  type AIToolMessage,
  type ToolResultPart,
  isAIToolMessage,
  isOpenAIMessage,
} from '../../ConversationHistoryLoader.js';
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

    if (!this.hotFileStrategy) {
      return false;
    }

    // Handle AI SDK v6 format tool messages
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (!toolResult || toolResult.toolName !== 'fileEdit') {
        return false;
      }
      return this.checkToolCallForHotFiles(previousMessage, toolResult.toolCallId);
    }

    // Handle OpenAI format tool messages (from convertToLLMMessages)
    if (message.role === 'tool' && isOpenAIMessage(message) && message.name === 'fileEdit') {
      const toolCallId = message.tool_call_id;
      if (toolCallId) {
        return this.checkToolCallForHotFiles(previousMessage, toolCallId);
      }
    }

    return false;
  }

  /**
   * Check if the tool call arguments reference a hot file
   */
  private checkToolCallForHotFiles(previousMessage: LLMMessage | undefined, toolCallId: string): boolean {
    if (!previousMessage || previousMessage.role !== 'assistant' || !isOpenAIMessage(previousMessage) || !previousMessage.tool_calls) {
      return false;
    }

    const matchingToolCall = previousMessage.tool_calls.find(
      (tc) => tc.id === toolCallId
    );

    if (!matchingToolCall) {
      return false;
    }

    // Parse arguments - this can legitimately fail with malformed JSON
    let args;
    try {
      args = JSON.parse(matchingToolCall.function.arguments);
    } catch (error) {
      logger.warn('compression.file.edit.parse.failed', {
        toolCallId: matchingToolCall.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    // Check if compression is applicable
    try {
      // Check batch operations format (new format)
      if (args.operations && Array.isArray(args.operations)) {
        for (const op of args.operations) {
          const filePath: string | undefined = op.path || op.file_path || op.filePath;
          if (filePath && this.hotFileStrategy?.isHotFile(filePath)) {
            return true;
          }
        }
      } else {
        // Check single operation format (legacy format from old conversations)
        const filePath: string | undefined = args.path || args.file_path || args.filePath;
        if (filePath && this.hotFileStrategy?.isHotFile(filePath)) {
          return true;
        }
      }
    } catch (error) {
      logger.error('compression.file.edit.can.compress.error', {
        toolCallId: matchingToolCall.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }

    return false;
  }

  compress(context: CompressionContext): LLMMessage | null {
    const { message, previousMessage } = context;

    if (!previousMessage || !isOpenAIMessage(previousMessage) || !previousMessage.tool_calls) {
      return null;
    }

    // Get toolCallId and original content based on message format
    let toolCallId: string;
    let originalContent: string;
    const isV6Format = isAIToolMessage(message);

    if (isV6Format) {
      const toolResult = message.content[0];
      if (!toolResult) {
        return null;
      }
      toolCallId = toolResult.toolCallId;
      const output = toolResult.output;
      originalContent = output && typeof output === 'object' && 'type' in output && output.type === 'text' && 'value' in output
        ? (output as { type: 'text'; value: string }).value
        : '';
    } else if (isOpenAIMessage(message) && message.role === 'tool' && message.tool_call_id) {
      toolCallId = message.tool_call_id;
      originalContent = message.content;
    } else {
      return null;
    }

    const matchingToolCall = previousMessage.tool_calls.find(
      (tc) => tc.id === toolCallId
    );

    if (!matchingToolCall) {
      return null;
    }

    // Parse arguments - this can legitimately fail with malformed JSON
    let args;
    try {
      args = JSON.parse(matchingToolCall.function.arguments);
    } catch (error) {
      logger.warn('compression.file.edit.parse.failed', {
        toolCallId: matchingToolCall.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    // Process the compression logic
    try {
      let summary: string;

      // Handle batch operations format (new format)
      if (args.operations && Array.isArray(args.operations)) {
        const hotFileOps = args.operations.filter((op: any) => {
          const filePath = op.path || op.file_path || op.filePath;
          return filePath && this.hotFileStrategy?.isHotFile(filePath);
        });

        if (hotFileOps.length === 0) {
          return null;
        }

        summary =
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
          originalLength: originalContent.length,
          compressedLength: summary.length,
        });
      } else {
        // Handle single operation format (legacy format from old conversations)
        const filePath: string | undefined = args.path || args.file_path || args.filePath;
        const mode = args.mode || 'edit';

        if (!filePath) {
          return null;
        }

        // Only compress if file is hot
        if (!this.hotFileStrategy?.isHotFile(filePath)) {
          return null;
        }

        let linesChanged = 0;
        const linesMatch = originalContent.match(/(\d+)\s+lines?\s+changed/i);
        if (linesMatch && linesMatch[1]) {
          linesChanged = parseInt(linesMatch[1], 10);
        }

        summary =
          `File edited: ${filePath}\n` +
          `Mode: ${mode}\n` +
          `Lines changed: ${linesChanged > 0 ? linesChanged : 'unknown'}\n\n` +
          `[Full file content available in hot files context]\n` +
          `[Edit details compressed - file is included in hot files]`;

        logger.debug('compression.file.edit.compressed', {
          filePath,
          mode,
          linesChanged,
          originalLength: originalContent.length,
          compressedLength: summary.length,
        });
      }

      // Return in same format as input
      if (isV6Format && isAIToolMessage(message)) {
        const toolResult = message.content[0];
        const compressedResult: ToolResultPart = {
          type: 'tool-result',
          toolCallId: toolResult!.toolCallId,
          toolName: toolResult!.toolName,
          output: { type: 'text', value: summary }
        };
        return { role: 'tool', content: [compressedResult] } as AIToolMessage;
      } else if (isOpenAIMessage(message) && message.name) {
        // Return OpenAI format for OpenAI input
        return {
          role: 'tool',
          content: summary,
          tool_call_id: toolCallId,
          name: message.name,
        };
      }

      return null;
    } catch (error) {
      logger.error('compression.file.edit.unexpected.error', {
        toolCallId: matchingToolCall.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }
}
