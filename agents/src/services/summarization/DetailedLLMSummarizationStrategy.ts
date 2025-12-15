import { generateText } from 'ai';
import type { LLMMessage } from '../ConversationHistoryLoader.js';
import { getAgentModelWithName } from '../../utils/model-selection.js';
import { countTokens } from '../../utils/token-counter.js';
import type { SummarizationStrategy, SummarizationContext, SummarizationResult } from './SummarizationStrategy.js';
import { logger } from '../../logging/index.js';

/**
 * Detailed LLM-based summarization strategy
 * 
 * Generates comprehensive summaries with structured sections for:
 * - API endpoints created/modified
 * - Database tables and schemas
 * - Pages and routes
 * - Key decisions and actions
 * 
 * Uses intelligent batching to handle large conversations:
 * - Processes up to 25k tokens per batch
 * - Always cuts at conversation boundaries (full user question + assistant response)
 * - Builds incremental summaries that get merged
 * 
 * Provides more context than the basic LLM strategy at the cost of slightly
 * larger summaries.
 */
export class DetailedLLMSummarizationStrategy implements SummarizationStrategy {
  readonly name = 'detailed-llm';
  private readonly maxTokensPerBatch = 25000;

  async summarize(context: SummarizationContext): Promise<SummarizationResult> {
    const { appId, messages, existingSummary, messageRange, originalTokenCount } = context;

    logger.debug('summarization.detailed_llm.begin', {
      appId,
      messageCount: messages.length,
      hasExistingSummary: !!existingSummary,
      messageRangeStart: messageRange.startId,
      messageRangeEnd: messageRange.endId,
      originalTokenCount,
    });

    try {
      const { model, modelName } = await getAgentModelWithName('fast');

      // Check if we need to batch
      if (originalTokenCount > this.maxTokensPerBatch) {
        logger.info('summarization.detailed_llm.batching', {
          appId,
          originalTokenCount,
          maxTokensPerBatch: this.maxTokensPerBatch,
          messageCount: messages.length,
        });
        
        return await this.summarizeInBatches(context, model, modelName);
      }

      // Single batch processing
      const result = await this.summarizeSingleBatch(context, model, modelName, existingSummary);

      logger.info('summarization.detailed_llm.complete', {
        appId,
        messageCount: messages.length,
        summaryTokenCount: result.summaryTokenCount,
        originalTokenCount,
        compressionRatio: result.summaryTokenCount / originalTokenCount,
        modelUsed: modelName,
      });

      return result;
    } catch (error) {
      logger.error('summarization.detailed_llm.failure', {
        appId,
        message: 'Failed to generate detailed LLM summary',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Summarize messages in batches to handle large conversations
   * Always cuts at conversation boundaries (user question + full assistant response)
   */
  private async summarizeInBatches(
    context: SummarizationContext,
    model: any,
    modelName: string
  ): Promise<SummarizationResult> {
    const { appId, messages, existingSummary, messageRange, originalTokenCount } = context;
    
    const startTime = Date.now();
    
    // Split messages into batches at conversation boundaries
    const batches = this.createBatches(messages, modelName);
    
    logger.info('summarization.detailed_llm.batches_created', {
      appId,
      batchCount: batches.length,
      batchSizes: batches.map(b => b.messages.length),
      batchTokens: batches.map(b => b.tokenCount),
    });

    // Process batches sequentially, building up the summary
    let cumulativeSummary = existingSummary || '';
    let totalSummaryTokens = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (!batch) continue;
      
      const batchStartTime = Date.now();
      
      logger.debug('summarization.detailed_llm.batch_processing', {
        appId,
        batchIndex: i + 1,
        totalBatches: batches.length,
        batchMessageCount: batch.messages.length,
        batchTokenCount: batch.tokenCount,
      });

      const batchContext: SummarizationContext = {
        appId,
        messages: batch.messages,
        existingSummary: cumulativeSummary,
        messageRange: {
          startId: messageRange.startId, // Use original range for tracking
          endId: messageRange.endId,
        },
        originalTokenCount: batch.tokenCount,
      };

      const batchResult = await this.summarizeSingleBatch(
        batchContext,
        model,
        modelName,
        cumulativeSummary
      );

      const batchDuration = Date.now() - batchStartTime;

      cumulativeSummary = batchResult.summaryText;
      totalSummaryTokens = batchResult.summaryTokenCount;
      
      logger.debug('summarization.detailed_llm.batch_complete', {
        appId,
        batchIndex: i + 1,
        totalBatches: batches.length,
        batchDurationMs: batchDuration,
        summaryTokens: batchResult.summaryTokenCount,
        originalTokens: batch.tokenCount,
      });
    }

    const totalDuration = Date.now() - startTime;

    logger.info('summarization.detailed_llm.batches_complete', {
      appId,
      batchCount: batches.length,
      totalSummaryTokens,
      originalTokenCount,
      compressionRatio: totalSummaryTokens / originalTokenCount,
      totalDurationMs: totalDuration,
      avgDurationPerBatchMs: Math.round(totalDuration / batches.length),
    });

    return {
      summaryText: cumulativeSummary,
      summaryTokenCount: totalSummaryTokens,
      modelUsed: modelName,
      messageRange,
      messageCount: messages.length,
      originalTokenCount,
    };
  }

  /**
   * Create batches of messages, cutting only at conversation boundaries
   * A conversation boundary is after a complete user question + assistant response
   */
  private createBatches(messages: LLMMessage[], modelName: string): Array<{
    messages: LLMMessage[];
    tokenCount: number;
  }> {
    const batches: Array<{ messages: LLMMessage[]; tokenCount: number }> = [];
    let currentBatch: LLMMessage[] = [];
    let currentTokenCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;

      const msgText = this.serializeMessage(msg);
      const msgTokens = countTokens(msgText, modelName).tokenCount;

      // Check if adding this message would exceed the batch limit
      if (currentTokenCount + msgTokens > this.maxTokensPerBatch && currentBatch.length > 0) {
        // Check if we're at a conversation boundary
        // A boundary is after an assistant message (complete turn)
        if (msg.role === 'user' || msg.role === 'system') {
          // We're starting a new turn, safe to cut here
          batches.push({
            messages: [...currentBatch],
            tokenCount: currentTokenCount,
          });
          currentBatch = [msg];
          currentTokenCount = msgTokens;
          continue;
        }
      }

      // Add message to current batch
      currentBatch.push(msg);
      currentTokenCount += msgTokens;
    }

    // Add final batch if not empty
    if (currentBatch.length > 0) {
      batches.push({
        messages: currentBatch,
        tokenCount: currentTokenCount,
      });
    }

    return batches;
  }

  /**
   * Summarize a single batch of messages
   */
  private async summarizeSingleBatch(
    context: SummarizationContext,
    model: any,
    modelName: string,
    existingSummary?: string
  ): Promise<SummarizationResult> {
    const { messages, messageRange, originalTokenCount } = context;

    const systemPrompt = this.buildSystemPrompt(existingSummary);
    const userPrompt = this.buildUserPrompt(messages);

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      maxOutputTokens: 2500,
    });

    const summaryText = result.text;
    const summaryTokenCount = countTokens(summaryText, modelName).tokenCount;

    if (summaryTokenCount > 2000) {
      logger.warn('summarization.detailed_llm.token_budget_exceeded', {
        appId: context.appId,
        summaryTokenCount,
        targetTokens: 2000,
        excessTokens: summaryTokenCount - 2000,
        message: 'Summary exceeded target token budget - may need manual review',
      });
    }

    return {
      summaryText,
      summaryTokenCount,
      modelUsed: modelName,
      messageRange,
      messageCount: messages.length,
      originalTokenCount,
    };
  }

  /**
   * Build system prompt for summarization
   */
  private buildSystemPrompt(existingSummary?: string): string {
    return `You are an expert at creating detailed, structured summaries of software development conversations.

Your task is to create a comprehensive summary that captures the essential context needed for an AI development agent to continue working on this project without access to the full conversation history.

${existingSummary ? `EXISTING SUMMARY:\n${existingSummary}\n\nIntegrate the new conversation below with the existing summary. Merge and deduplicate information. When conflicts exist, prefer the most recent information. Remove completed items from "Next Steps" if they were addressed.

CRITICAL: If the new conversation contains only trivial exchanges (greetings, acknowledgments, off-topic chat) with NO substantive development work (no code changes, no feature discussions, no technical decisions), you MUST return the existing summary verbatim without modification. Do not generate casual responses or acknowledgments. Maintain the structured format.` : 'This is the initial summary for this conversation.'}

## STRICT TOKEN BUDGET: 2000 tokens maximum

Your summary MUST NOT exceed 2000 tokens. Allocate tokens as follows:
- Current State: 100 tokens
- User Goals: 100 tokens  
- Key Implementations: 900 tokens (CRITICAL - comprehensive list prevents duplicate work)
- Technical Decisions: 300 tokens
- API Endpoints: 200 tokens (top 5 most important only)
- Database Schema: 150 tokens (top 3 tables only)
- Pages & Routes: 150 tokens (top 5 pages only)
- Known Issues: 100 tokens

## Output Format

# [Project Name]: [Brief Description]

## Current State
2-3 sentences describing where the project currently stands and what's working.

## User Goals
- Primary objectives and requirements
- Key constraints mentioned
- Only include goals that are still in progress or not yet started. Move completed goals out of this section entirely.

## Key Implementations
**CRITICAL: This section prevents the agent from suggesting already-built features. Be comprehensive.**

Group by feature area (not chronology). Focus on WHAT was built, not HOW:
### [Feature Area Name]
- Feature X: Brief description (omit file paths unless critical)
- Feature Y: Brief description

**Pruning rules for this section when space is tight:**
- Keep ALL major features mentioned (even briefly)
- Remove implementation details (specific file paths, code snippets)
- Merge related minor features into single bullets
- Focus on user-facing functionality over internal plumbing

## Technical Decisions
Choices that affect how future work should be done:
- "Using X instead of Y because Z"
- Architecture patterns established
- Conventions adopted

## API Endpoints
**Top 5 most important only** - other endpoints exist but omitted for space:
- \`METHOD /path\` - Purpose

## Database Schema  
**Top 3 most important tables only** - other tables exist but omitted for space:
- **table_name**: Purpose and key columns

## Pages & Routes
**Top 5 main pages only** - other pages exist but omitted for space:
- \`/path\` - Purpose

## Known Issues / Tech Debt
- Unresolved bugs
- Shortcuts taken that need revisiting

## Next Steps
Outstanding tasks if mentioned

## Guidelines
- MAXIMUM 2000 tokens - this is a hard limit
- Omit sections with no content entirely (don't write "None")
- Focus on WHAT and WHY; omit HOW unless it establishes a pattern
- For merged summaries: if something was built then later refactored, only describe the final state
- When pruning, prioritize keeping Key Implementations comprehensive over detailed API/DB docs`;
  }

  /**
   * Build user prompt from messages
   */
  private buildUserPrompt(messages: LLMMessage[]): string {
    return messages.map(msg => {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      return `${roleLabel}: ${msg.content}`;
    }).join('\n\n');
  }

  /**
   * Serialize a message for token counting
   */
  private serializeMessage(message: LLMMessage): string {
    const roleLabel = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    return `${roleLabel}: ${message.content}`;
  }
}

