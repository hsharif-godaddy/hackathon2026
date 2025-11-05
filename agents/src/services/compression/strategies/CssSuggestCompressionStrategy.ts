import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

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

  /**
   * Check if this is a cssSuggest tool result
   */
  canCompress(context: CompressionContext): boolean {
    const { message } = context;
    return message.role === 'tool' && message.name === 'cssSuggest';
  }

  /**
   * Compress the cssSuggest result to just show palette names
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message } = context;

    if (typeof message.content !== 'string') {
      return message;
    }

    try {
      const result = JSON.parse(message.content);

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

        return {
          ...message,
          content: JSON.stringify(compressed, null, 2)
        };
      }

      return message;
    } catch {
      // If parsing fails, return original message
      return message;
    }
  }
}

