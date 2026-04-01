import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import {
  type LLMMessage,
  type OpenAIMessage,
  isAIToolMessage,
  isOpenAIMessage,
} from '../../ConversationHistoryLoader.js';

/**
 * Transforms deprecated mediaSearch tool calls into summary text for agent context
 *
 * The mediaSearch tool was replaced by the media (slot-based) tool. When old
 * conversation history contains mediaSearch tool calls, this strategy:
 *
 * 1. Removes assistant messages with mediaSearch tool calls (to avoid orphaned tool calls)
 * 2. Transforms mediaSearch tool results into plain assistant messages with a summary
 *
 * This preserves context about what images were searched while preventing the agent
 * from trying to use the non-existent mediaSearch tool.
 *
 * Note: This only affects agent context building, not chat history display (which has
 * a backwards-compatible renderer for the old tool).
 */
export class MediaSearchSummaryStrategy implements CompressionStrategy {
  readonly name = 'media-search-summary';
  readonly strategyType = 'removal' as const;
  // Transforms tool results into summary text rather than removing messages entirely
  readonly mutatesContent = true;

  private static readonly TOOL_NAME = 'mediaSearch';

  /**
   * Check if this message involves the deprecated mediaSearch tool
   */
  canCompress(context: CompressionContext): boolean {
    const { message } = context;

    // Case 1: Tool result message for mediaSearch (AI SDK v6 format)
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (toolResult?.toolName === MediaSearchSummaryStrategy.TOOL_NAME) {
        return true;
      }
    }

    // Case 2: Tool result message for mediaSearch (OpenAI format)
    if (
      message.role === 'tool' &&
      isOpenAIMessage(message) &&
      message.name === MediaSearchSummaryStrategy.TOOL_NAME
    ) {
      return true;
    }

    // Case 3: Assistant message with mediaSearch tool calls
    if (message.role === 'assistant' && isOpenAIMessage(message) && message.tool_calls) {
      const hasMediaSearchCall = message.tool_calls.some(
        (tc) => tc.function.name === MediaSearchSummaryStrategy.TOOL_NAME
      );
      if (hasMediaSearchCall) {
        return true;
      }
    }

    return false;
  }

  /**
   * Transform mediaSearch tool results to summary, remove tool call messages
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message } = context;

    // For assistant messages with tool calls, handle removal or filtering
    if (message.role === 'assistant' && isOpenAIMessage(message) && message.tool_calls) {
      return this.handleAssistantMessage(message);
    }

    // For tool result messages, transform to summary
    return this.handleToolResultMessage(message);
  }

  /**
   * Handle assistant messages with mediaSearch tool calls
   */
  private handleAssistantMessage(message: OpenAIMessage): LLMMessage | null {
    if (!message.tool_calls) {
      return message;
    }

    // Filter out mediaSearch tool calls
    const nonMediaSearchCalls = message.tool_calls.filter(
      (tc) => tc.function.name !== MediaSearchSummaryStrategy.TOOL_NAME
    );

    // If all tool calls were mediaSearch, remove the message entirely
    if (nonMediaSearchCalls.length === 0) {
      return null;
    }

    // If there are other tool calls, keep those
    return {
      ...message,
      tool_calls: nonMediaSearchCalls,
    };
  }

  /**
   * Transform tool result message to a summary assistant message
   */
  private handleToolResultMessage(message: LLMMessage): LLMMessage | null {
    let contentString: string | undefined;

    // Extract content from AI SDK v6 format
    if (isAIToolMessage(message)) {
      const toolResult = message.content[0];
      if (toolResult?.toolName !== MediaSearchSummaryStrategy.TOOL_NAME) {
        return message;
      }
      const output = toolResult.output;
      if (typeof output === 'object' && output !== null && 'type' in output && output.type === 'text') {
        contentString = (output as { type: 'text'; value: string }).value;
      } else if (typeof output === 'string') {
        contentString = output;
      }
    }
    // Extract content from OpenAI format
    else if (
      message.role === 'tool' &&
      isOpenAIMessage(message) &&
      message.name === MediaSearchSummaryStrategy.TOOL_NAME
    ) {
      contentString = message.content;
    }

    if (!contentString) {
      return null;
    }

    const summary = this.createSummary(contentString);
    if (!summary) {
      return null;
    }

    // Return as an assistant message with the summary
    return {
      role: 'assistant',
      content: summary,
    };
  }

  /**
   * Create a human-readable summary from the mediaSearch result
   *
   * Handles multiple result shapes:
   * - Single search: { success, url?, urls?, mediaType?, prompt? }
   * - Parallel search: { success, results: [{ prompt, url?, urls? }], mediaType?, prompt? }
   */
  private createSummary(resultJson: string): string | null {
    try {
      const result = JSON.parse(resultJson);

      if (!result.success) {
        return null;
      }

      // Get mediaType with fallback
      const rawMediaType = result.mediaType;
      const mediaType =
        typeof rawMediaType === 'string' && rawMediaType.trim().length > 0 ? rawMediaType : 'media';

      // Collect URLs, supporting both single search and parallel search (results array)
      let urls: string[] = [];
      let prompt: string | string[] | undefined = result.prompt;

      // Handle parallel search results array
      if (Array.isArray(result.results)) {
        for (const subResult of result.results) {
          if (!subResult) continue;

          // Aggregate URLs from each sub-result
          if (Array.isArray(subResult.urls)) {
            urls.push(...subResult.urls);
          } else if (subResult.url) {
            urls.push(subResult.url);
          }
        }

        // If top-level prompt is missing, derive from sub-results
        if (prompt === undefined) {
          const subPrompts: string[] = [];
          for (const subResult of result.results) {
            if (subResult && typeof subResult.prompt === 'string') {
              subPrompts.push(subResult.prompt);
            }
          }
          if (subPrompts.length > 0) {
            prompt = subPrompts;
          }
        }
      }

      // Fallback to top-level url(s) if no URLs from results array
      if (urls.length === 0) {
        if (Array.isArray(result.urls)) {
          urls = result.urls;
        } else if (result.url) {
          urls = [result.url];
        }
      }

      if (urls.length === 0) {
        return null;
      }

      // Build prompt text with graceful fallback
      let promptText: string | null = null;
      if (Array.isArray(prompt)) {
        const cleaned = prompt
          .map((p) => (typeof p === 'string' ? p.trim() : ''))
          .filter((p) => p.length > 0);
        if (cleaned.length > 0) {
          promptText = cleaned.join(', ');
        }
      } else if (typeof prompt === 'string' && prompt.trim().length > 0) {
        promptText = prompt.trim();
      }

      // Create summary, omitting prompt if unavailable
      const base = `[Previously searched for ${mediaType}(s)`;
      const promptPart = promptText ? `: "${promptText}"` : '';
      return `${base}${promptPart} - found ${urls.length} result(s)]`;
    } catch {
      return null;
    }
  }
}
