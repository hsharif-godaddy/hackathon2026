import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Configuration for tool result summarization
 */
export interface ToolSummaryConfig {
  /** Tool name to apply this summarizer to */
  toolName: string;
  /** Maximum length for the summary */
  maxLength: number;
  /** Custom summarization function */
  summarize: (content: string, args?: any) => string;
}

/**
 * Compresses tool result messages by summarizing verbose output
 * Uses tool-specific summarization strategies
 */
export class ToolResultSummarizer implements CompressionStrategy {
  readonly name = 'tool-result-summarizer';
  private summaryConfigs = new Map<string, ToolSummaryConfig>();

  /**
   * Register a tool-specific summarization config
   */
  registerToolSummarizer(config: ToolSummaryConfig): void {
    this.summaryConfigs.set(config.toolName, config);
  }

  /**
   * Check if this is a tool result message with a registered summarizer
   */
  canCompress(context: CompressionContext): boolean {
    const { message, previousMessage } = context;

    // Must be a tool message
    if (message.role !== 'tool' || !message.name) {
      return false;
    }

    // Must have a registered summarizer for this tool
    if (!this.summaryConfigs.has(message.name)) {
      return false;
    }

    // Must have content that's long enough to be worth compressing
    const config = this.summaryConfigs.get(message.name)!;
    if (!message.content || message.content.length <= config.maxLength) {
      return false;
    }

    return true;
  }

  /**
   * Compress the tool result using tool-specific summarization
   */
  compress(context: CompressionContext): LLMMessage | null {
    const { message, previousMessage } = context;

    if (!message.name || !this.summaryConfigs.has(message.name)) {
      return null;
    }

    const config = this.summaryConfigs.get(message.name)!;

    // Extract tool arguments from previous assistant message if available
    let toolArgs: any;
    if (previousMessage?.role === 'assistant' && previousMessage.tool_calls) {
      const matchingToolCall = previousMessage.tool_calls.find(
        (tc) => tc.id === message.tool_call_id
      );
      if (matchingToolCall) {
        try {
          toolArgs = JSON.parse(matchingToolCall.function.arguments);
        } catch {
          // Ignore parse errors
        }
      }
    }

    const summary = config.summarize(message.content, toolArgs);

    return {
      ...message,
      content: summary,
    };
  }
}
