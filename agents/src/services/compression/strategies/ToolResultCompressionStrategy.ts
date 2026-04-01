import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import {
  type LLMMessage,
  type AIToolMessage,
  type ToolResultPart,
  isAIToolMessage,
  isOpenAIMessage,
} from '../../ConversationHistoryLoader.js';
import { EDIT_SUCCESS_PREFIXES } from '../../../tools/text-editor-handlers.js';

interface EditRecord {
  filePath: string;
  messageIndex: number;
  isSuccess: boolean;
}

const EDIT_TOOL_NAMES = ['str_replace_based_edit_tool', 'textEditor'];


/**
 * Compresses old edit tool results from conversation history.
 * - Successful edits that are not the most recent edit for their file are compressed to "[Edit succeeded]"
 * - Failed edits where a later successful edit exists on the same file are compressed to
 *   "[Edit failed, later retried successfully]"
 */
export class ToolResultCompressionStrategy implements CompressionStrategy {
  readonly name = 'tool-result-compression';
  // 'removal' ensures this runs even when summarization is active - old edit results
  // are redundant regardless of summarization state
  readonly strategyType = 'removal' as const;
  // Mutates tool result content rather than removing messages - must be skipped
  // in the stable cached prefix region to prevent cache invalidation
  readonly mutatesContent = true;

  private editRecords: EditRecord[] = [];
  /** Per-file: the message index of the most recent edit (success or failure) */
  private mostRecentEditPerFile = new Map<string, number>();
  /** Per-file: indices of successful edits */
  private fileSuccessIndices = new Map<string, number[]>();
  /** Set of message indices that should be compressed */
  private compressibleIndices = new Set<number>();
  /** Map from message index to compression text */
  private compressionText = new Map<number, string>();

  /**
   * Extract the tool name from a tool result message
   */
  private getToolName(message: LLMMessage): string | null {
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (toolResult && EDIT_TOOL_NAMES.includes(toolResult.toolName)) {
        return toolResult.toolName;
      }
    } else if (isOpenAIMessage(message) && message.role === 'tool' && message.name) {
      if (EDIT_TOOL_NAMES.includes(message.name)) {
        return message.name;
      }
    }
    return null;
  }

  /**
   * Get tool call ID from a tool result message
   */
  private getToolCallId(message: LLMMessage): string | undefined {
    if (isAIToolMessage(message)) {
      return message.content[0]?.toolCallId;
    } else if (isOpenAIMessage(message) && message.role === 'tool') {
      return message.tool_call_id;
    }
    return undefined;
  }

  /**
   * Extract file path and command from the corresponding tool call in the previous assistant message.
   * Returns null for `view` commands (not mutations).
   * Assistant messages are always OpenAI-format at compression time — convertToLLMMessages
   * produces { role: 'assistant', content: string, tool_calls: [...] } and compression
   * runs before formatMessagesForAISDK converts to AI SDK v6 array format.
   */
  private extractFilePath(message: LLMMessage, previousMessage?: LLMMessage): string | null {
    const toolCallId = this.getToolCallId(message);
    if (!toolCallId || !previousMessage || previousMessage.role !== 'assistant') {
      return null;
    }

    if (isOpenAIMessage(previousMessage) && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(tc => tc.id === toolCallId);
      if (matchingToolCall) {
        try {
          const args = JSON.parse(matchingToolCall.function.arguments);
          // Skip view commands — only track mutations (str_replace, create, insert)
          if (args.command === 'view') {
            return null;
          }
          return args.path || args.file_path || args.filePath || null;
        } catch {
          // Ignore parse errors
        }
      }
    }

    return null;
  }

  /**
   * Determine if a tool result indicates success.
   * Matches exact known success prefixes from text-editor-handlers.ts rather than
   * substring search — error messages may embed file content containing "successfully".
   */
  private isSuccessResult(message: LLMMessage): boolean {
    let content = '';
    if (isAIToolMessage(message)) {
      const output = message.content[0]?.output;
      if (output && typeof output === 'object' && 'type' in output && output.type === 'text' && 'value' in output) {
        content = (output as { type: 'text'; value: string }).value;
      }
    } else if (isOpenAIMessage(message) && message.role === 'tool') {
      content = message.content;
    }
    const lower = content.toLowerCase();
    return EDIT_SUCCESS_PREFIXES.some(prefix => lower.startsWith(prefix));
  }

  analyzeMessages(messages: LLMMessage[]): void {
    this.editRecords = [];
    this.mostRecentEditPerFile.clear();
    this.fileSuccessIndices.clear();
    this.compressibleIndices.clear();
    this.compressionText.clear();

    // First pass: collect all edit records
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message || message.role !== 'tool') continue;

      const toolName = this.getToolName(message);
      if (!toolName) continue;

      const previousMessage = i > 0 ? messages[i - 1] : undefined;
      const filePath = this.extractFilePath(message, previousMessage);
      if (!filePath) continue;

      const isSuccess = this.isSuccessResult(message);
      this.editRecords.push({ filePath, messageIndex: i, isSuccess });
      this.mostRecentEditPerFile.set(filePath, i);

      if (isSuccess) {
        if (!this.fileSuccessIndices.has(filePath)) {
          this.fileSuccessIndices.set(filePath, []);
        }
        this.fileSuccessIndices.get(filePath)!.push(i);
      }
    }

    // Second pass: determine which records to compress
    for (const record of this.editRecords) {
      if (record.messageIndex === this.mostRecentEditPerFile.get(record.filePath)) {
        // Never compress the most recent edit result for a given file
        continue;
      }

      if (record.isSuccess) {
        // Successful edit that is NOT the most recent for its file → compress
        this.compressibleIndices.add(record.messageIndex);
        this.compressionText.set(record.messageIndex, '[Edit succeeded]');
      } else {
        // Failed edit: compress only if a later successful edit exists on the same file
        const successes = this.fileSuccessIndices.get(record.filePath);
        if (successes && successes.some(idx => idx > record.messageIndex)) {
          this.compressibleIndices.add(record.messageIndex);
          this.compressionText.set(record.messageIndex, '[Edit failed, later retried successfully]');
        }
      }
    }
  }

  canCompress(context: CompressionContext): boolean {
    return this.compressibleIndices.has(context.messageIndex);
  }

  compress(context: CompressionContext): LLMMessage | null {
    const { message } = context;
    const text = this.compressionText.get(context.messageIndex) || '[Edit succeeded]';

    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (!toolResult) return null;
      const compressedResult: ToolResultPart = {
        type: 'tool-result',
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        output: { type: 'text', value: text },
      };
      return { role: 'tool', content: [compressedResult] } as AIToolMessage;
    } else if (isOpenAIMessage(message) && message.role === 'tool' && message.tool_call_id && message.name) {
      return {
        role: 'tool',
        content: text,
        tool_call_id: message.tool_call_id,
        name: message.name,
      };
    }

    return null;
  }
}
