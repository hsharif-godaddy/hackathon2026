import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import {
  type LLMMessage,
  type AIToolMessage,
  type ToolResultPart,
  isAIToolMessage,
  isOpenAIMessage,
} from '../../ConversationHistoryLoader.js';

/**
 * Compresses cssSuggest tool results to only show palette names
 *
 * The full widget data with all color hex values is verbose and unnecessary
 * for the LLM context. The agent only needs to know which palettes were
 * suggested, and can reference them by name when the user selects one.
 *
 * This strategy:
 * - Extracts palette names from the widget data
 * - Replaces verbose JSON with a simple list of names
 * - Preserves the success/error status
 */
export class CssSuggestCompressionStrategy implements CompressionStrategy {
  readonly name = 'css-suggest-compression';
  // Mutates tool result content rather than removing messages
  readonly mutatesContent = true;

  /**
   * Check if this is a cssSuggest tool result
   */
  canCompress(context: CompressionContext): boolean {
    const { message } = context;

    // Check AI SDK v6 format
    if (isAIToolMessage(message)) {
      const firstContent = message.content[0];
      return firstContent?.toolName === 'cssSuggest';
    }

    // Check OpenAI format (from convertToLLMMessages)
    if (message.role === 'tool' && isOpenAIMessage(message) && message.name === 'cssSuggest') {
      return true;
    }

    return false;
  }

  /**
   * Compress the cssSuggest result to just show palette names
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message } = context;

    // Get the content string based on message format
    let contentString: string;
    const isV6Format = isAIToolMessage(message);

    if (isV6Format) {
      const toolResult = message.content[0];
      if (!toolResult) {
        return message;
      }
      const output = toolResult.output;
      if (typeof output !== 'object' || output === null || !('type' in output) || output.type !== 'text') {
        return message;
      }
      contentString = (output as { type: 'text'; value: string }).value;
    } else if (isOpenAIMessage(message) && message.role === 'tool') {
      contentString = message.content;
    } else {
      return message;
    }

    try {
      const result = JSON.parse(contentString);

      // Extract palette names if widget data exists
      if (result.widget?.widgetData?.palettes) {
        const paletteNames = result.widget.widgetData.palettes
          .map((p: any) => p.name)
          .filter(Boolean);

        // Create compressed result
        const compressed = {
          success: result.success,
          message: result.message,
          palettes: paletteNames
        };

        const compressedJson = JSON.stringify(compressed);

        // Return in same format as input
        if (isV6Format && isAIToolMessage(message)) {
          const toolResult = message.content[0];
          const compressedResult: ToolResultPart = {
            type: 'tool-result',
            toolCallId: toolResult!.toolCallId,
            toolName: toolResult!.toolName,
            output: { type: 'text', value: compressedJson }
          };
          return { role: 'tool', content: [compressedResult] } as AIToolMessage;
        } else if (isOpenAIMessage(message) && message.tool_call_id && message.name) {
          // Return OpenAI format for OpenAI input
          return {
            role: 'tool',
            content: compressedJson,
            tool_call_id: message.tool_call_id,
            name: message.name,
          };
        }
      }

      return message;
    } catch {
      // If parsing fails, return original message
      return message;
    }
  }
}
