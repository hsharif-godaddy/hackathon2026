import { generateText } from 'ai';
import { getAgentModelWithName } from '../../utils/model-selection.js';
import { countTokens } from '../../utils/token-counter.js';
import { logger } from '../../logging/index.js';
import type { SummarizationContext, SummarizationResult, SummarizationStrategy } from './SummarizationStrategy.js';

/**
 * LLM-based summarization strategy using AI SDK
 * 
 * Uses the 'fast' tier model for efficient summarization.
 * Supports incremental summarization by updating existing summaries with new messages.
 */
export class LLMSummarizationStrategy implements SummarizationStrategy {
  readonly name = 'llm';

  /**
   * Summarize messages using LLM
   * 
   * @param context - Context containing messages and metadata
   * @returns Promise resolving to summarization result
   */
  async summarize(context: SummarizationContext): Promise<SummarizationResult> {
    const { messages, existingSummary, messageRange, originalTokenCount, appId } = context;

    try {
      // Get fast tier model for summarization
      const { model, modelName } = await getAgentModelWithName('fast');

      // Build prompt based on whether we're updating an existing summary
      const systemPrompt = this.buildSystemPrompt(existingSummary);
      const userPrompt = this.buildUserPrompt(messages, existingSummary);

      logger.debug('summarization.llm.begin', {
        appId,
        messageCount: messages.length,
        hasExistingSummary: !!existingSummary,
        modelName,
        originalTokenCount,
      });

      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.3, // Lower temperature for more consistent summaries
        maxOutputTokens: 5000, // Allow larger summaries for complex projects
        experimental_telemetry: { isEnabled: true, functionId: 'summarization-llm' },
      });

      const summaryText = result.text.trim();
      const tokenCountResult = countTokens(summaryText, modelName);
      const summaryTokenCount = tokenCountResult.tokenCount;

      logger.info('summarization.llm.complete', {
        appId,
        messageCount: messages.length,
        summaryTokenCount,
        originalTokenCount,
        compressionRatio: summaryTokenCount / originalTokenCount,
        modelName,
      });

      return {
        summaryText,
        summaryTokenCount,
        modelUsed: modelName,
        messageRange,
        messageCount: messages.length,
        originalTokenCount,
      };
    } catch (error) {
      logger.error('summarization.llm.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length,
      });

      // Fallback: return a basic summary
      return this.createFallbackSummary(context);
    }
  }

  /**
   * Build system prompt for summarization
   * 
   * @param existingSummary - Existing summary if updating incrementally
   * @returns System prompt text
   */
  private buildSystemPrompt(existingSummary?: string): string {
    if (existingSummary) {
      return `You are a conversation summarization assistant. Your task is to update an existing conversation summary with new messages.

The existing summary captures the key points from previous conversations. You should:
1. Preserve important information from the existing summary
2. Integrate new information from the new messages
3. Maintain a concise, coherent summary
4. Focus on user requests, agent actions, and key decisions
5. Keep the summary under 2000 tokens

Format the updated summary as a clear, readable narrative.`;
    }

    return `You are a conversation summarization assistant. Your task is to create a concise summary of a conversation between a user and an AI agent.

Focus on:
1. User requests and goals
2. Agent actions and tool usage
3. Key decisions and outcomes
4. Important context and state changes

Keep the summary concise (under 2000 tokens) but comprehensive enough to preserve context for future interactions.
Format the summary as a clear, readable narrative.`;
  }

  /**
   * Build user prompt with messages
   * 
   * @param messages - Messages to summarize
   * @param existingSummary - Existing summary if updating incrementally
   * @returns User prompt text
   */
  private buildUserPrompt(
    messages: Array<{ role: string; content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>,
    existingSummary?: string
  ): string {
    const messageTexts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user' && msg.content) {
        messageTexts.push(`User: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        if (msg.content) {
          messageTexts.push(`Assistant: ${msg.content}`);
        }
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolCalls = msg.tool_calls
            .map((tc: any) => `${tc.function?.name || 'unknown'}(${tc.function?.arguments || ''})`)
            .join(', ');
          messageTexts.push(`Assistant used tools: ${toolCalls}`);
        }
      } else if (msg.role === 'tool' && msg.content) {
        // Truncate tool results to avoid excessive length
        const truncated = msg.content.length > 500
          ? msg.content.substring(0, 500) + '...'
          : msg.content;
        messageTexts.push(`Tool result: ${truncated}`);
      }
    }

    const messagesText = messageTexts.join('\n\n');

    if (existingSummary) {
      return `Existing Summary:\n${existingSummary}\n\n--- New Messages ---\n${messagesText}\n\nPlease update the summary to include the new messages while preserving important information from the existing summary.`;
    }

    return `Conversation Messages:\n${messagesText}\n\nPlease create a concise summary of this conversation.`;
  }

  /**
   * Create a fallback summary when LLM fails
   * 
   * @param context - Summarization context
   * @returns Fallback summarization result
   */
  private createFallbackSummary(context: SummarizationContext): SummarizationResult {
    const { messages, messageRange, originalTokenCount } = context;

    // Simple fallback: concatenate first 500 chars of each message
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.content && msg.role !== 'system') {
        parts.push(`${msg.role}: ${msg.content.substring(0, 200)}`);
      }
    }

    const summaryText = `[Fallback Summary] ${parts.join(' | ')}`;
    const tokenCountResult = countTokens(summaryText, 'claude-3-5-sonnet');
    const summaryTokenCount = tokenCountResult.tokenCount;

    logger.warn('summarization.llm.fallback', {
      appId: context.appId,
      messageCount: messages.length,
      summaryTokenCount,
    });

    return {
      summaryText,
      summaryTokenCount,
      modelUsed: 'fallback',
      messageRange,
      messageCount: messages.length,
      originalTokenCount,
    };
  }
}

