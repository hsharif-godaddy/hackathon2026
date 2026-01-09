import type { SummarizationContext, SummarizationResult, SummarizationStrategy } from './SummarizationStrategy.js';
import { countTokens } from '../../utils/token-counter.js';
import { type LLMMessage, isOpenAIMessage, getMessageContent } from '../ConversationHistoryLoader.js';

/**
 * Simple non-LLM summarization strategy for testing
 * 
 * Concatenates message contents with basic formatting and extracts
 * key information (user requests, agent actions). Fast and deterministic
 * for unit tests.
 */
export class SimpleSummarizationStrategy implements SummarizationStrategy {
  readonly name = 'simple';

  /**
   * Summarize messages using simple text concatenation
   * 
   * @param context - Context containing messages and metadata
   * @returns Promise resolving to summarization result
   */
  async summarize(context: SummarizationContext): Promise<SummarizationResult> {
    const { messages, existingSummary, messageRange, originalTokenCount } = context;

    let summaryText: string;

    if (existingSummary) {
      // Incremental: append new messages to existing summary
      const newMessagesText = this.formatMessages(messages);
      summaryText = `${existingSummary}\n\n--- New Messages ---\n${newMessagesText}`;
    } else {
      // Initial summary: format all messages
      summaryText = this.formatMessages(messages);
    }

    // Use a simple model name for token counting
    const modelUsed = 'claude-3-5-sonnet';
    const tokenCountResult = countTokens(summaryText, modelUsed);
    const summaryTokenCount = tokenCountResult.tokenCount;

    return {
      summaryText,
      summaryTokenCount,
      modelUsed,
      messageRange,
      messageCount: messages.length,
      originalTokenCount,
    };
  }

  /**
   * Format messages into a readable summary text
   *
   * @param messages - Messages to format
   * @returns Formatted text string
   */
  private formatMessages(messages: LLMMessage[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      const content = getMessageContent(msg);
      if (msg.role === 'user' && content) {
        parts.push(`User: ${content.trim()}`);
      } else if (msg.role === 'assistant') {
        if (content) {
          parts.push(`Assistant: ${content.trim()}`);
        }
        if (isOpenAIMessage(msg) && msg.tool_calls && msg.tool_calls.length > 0) {
          const toolNames = msg.tool_calls.map((tc) => tc.function?.name || 'unknown').join(', ');
          parts.push(`Assistant used tools: ${toolNames}`);
        }
      } else if (msg.role === 'tool' && content) {
        parts.push(`Tool result: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
      }
    }

    return parts.join('\n\n');
  }
}

