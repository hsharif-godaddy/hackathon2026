import { basename } from 'node:path';

import { propagateAttributes } from '@langfuse/tracing';
import { generateText, type LanguageModel } from 'ai';
import { logCachingStats, llmMetadataContext, type LitellmMetadata, buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-lib';
import { getAgentModelWithName } from '../../utils/model-selection.js';
import { countTokens } from '../../utils/token-counter.js';
import { logger } from '../../logging/index.js';
import type { SummarizationContext, SummarizationResult, SummarizationStrategy } from './SummarizationStrategy.js';
import { type LLMMessage, isOpenAIMessage, isAIToolMessage, getMessageContent } from '../ConversationHistoryLoader.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { filterInactiveSkillInstructions } from './SkillInstructionFilter.js';

/**
 * LLM-based summarization strategy using AI SDK
 *
 * Uses the 'full' tier model (Claude Sonnet) for higher-quality summarization.
 * Uses incremental summarization to keep costs low - only processes new messages
 * and merges them into the existing summary. Regenerates from scratch every N
 * incremental updates to prevent quality degradation.
 *
 * Cost optimization: Incremental mode processes 2-5k tokens vs 25k+ for full history,
 * making it 5-10x cheaper per summarization while maintaining quality through
 * periodic regeneration.
 */
export class LLMSummarizationStrategy implements SummarizationStrategy {
  readonly name = 'llm';

  /**
   * Truncation limits optimized for fast/small models (Haiku)
   * These are shorter than DetailedLLMSummarizationStrategy to save tokens
   * since fast models benefit from more concise inputs
   */
  private readonly maxToolResultLength = 300; // vs 500 in detailed strategy
  private readonly maxCommandLength = 80; // vs 100 in detailed strategy

  /**
   * Singleton AppRepository instance to avoid creating new instances on every summarization
   */
  private static readonly appRepo = new AppRepository()

  /**
   * Summarize messages using LLM
   *
   * Always uses incremental mode for cost efficiency. Regenerates from scratch
   * every 5 incremental updates to maintain quality.
   *
   * @param context - Context containing messages and metadata
   * @returns Promise resolving to summarization result
   */
  async summarize(context: SummarizationContext): Promise<SummarizationResult> {
    const { appId } = context;
    let { existingSummary } = context;

    const isIncremental = !!existingSummary;
    const previousUpdateCount = context.incrementalUpdateCount ?? 0;
    // Regenerate from scratch every 5 incremental updates to maintain quality
    // This balances cost (incremental is 5-10x cheaper) with quality (fresh regeneration)
    // Respect disableFullRegeneration from BackgroundSummarizer config
    const shouldRegenerateFromScratch = !context.disableFullRegeneration
      && previousUpdateCount >= 5;

    // Determine which messages to use:
    // - For regeneration: use fullMessageHistory (complete history before recent turns)
    // - For incremental: use messages (just the new delta)
    // CRITICAL: Without this, regeneration would only summarize the delta, losing all earlier context
    let messagesToSummarize = shouldRegenerateFromScratch && context.fullMessageHistory
      ? context.fullMessageHistory
      : context.messages;

    // NEW: Filter inactive skill instructions before summarization
    // This removes large skill markdown content (5-15KB) for skills that are no longer active,
    // replacing them with small stubs (~100 bytes) to prevent context bloat
    if (context.sessionId) {
      messagesToSummarize = filterInactiveSkillInstructions(messagesToSummarize, context.sessionId);
    }

    if (shouldRegenerateFromScratch) {
      logger.info('summarization.llm.regenerate_from_scratch', {
        appId,
        previousUpdateCount,
        reason: 'Exceeded incremental update threshold (5)',
        usingFullHistory: !!context.fullMessageHistory,
        messageCount: messagesToSummarize.length,
      });
      existingSummary = undefined;
    }

    try {
      const { model, modelName } = await getAgentModelWithName('full');

      // When regenerating from scratch, use full history; otherwise use incremental delta
      return await this.summarizeIncrementally({
        context,
        model,
        modelName,
        existingSummary,
        isIncremental,
        previousUpdateCount,
        shouldRegenerateFromScratch,
        messagesToSummarize,
      });
    } catch (error) {
      logger.error('summarization.llm.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
        messageCount: messagesToSummarize.length,
      });

      return await this.createFallbackSummary(context);
    }
  }

  private async summarizeIncrementally(params: {
    context: SummarizationContext;
    model: LanguageModel;
    modelName: string;
    existingSummary: string | undefined;
    isIncremental: boolean;
    previousUpdateCount: number;
    shouldRegenerateFromScratch: boolean;
    messagesToSummarize: LLMMessage[];
  }): Promise<SummarizationResult> {
    const {
      context,
      model,
      modelName,
      existingSummary,
      isIncremental,
      previousUpdateCount,
      shouldRegenerateFromScratch,
      messagesToSummarize,
    } = params;
    const { messageRange, originalTokenCount, appId, operationLog } = context;

    const systemPrompt = this.buildSystemPrompt(existingSummary);
    const userPrompt = this.buildUserPrompt(messagesToSummarize, existingSummary, operationLog);

    logger.debug('summarization.llm.begin', {
      appId,
      messageCount: messagesToSummarize.length,
      hasExistingSummary: !!existingSummary,
      isIncremental: isIncremental && !shouldRegenerateFromScratch,
      regeneratingFromScratch: shouldRegenerateFromScratch,
      modelName,
      originalTokenCount,
      mode: 'incremental',
    });

    // Look up app info for grant-aware billing
    // Background summarization may not have socketId, but can use subscriptionId for grant lookup
    const app = LLMSummarizationStrategy.appRepo.findById(appId);
    const customerId = app?.customerId;

    // If budget override is set from triggering session, use it directly
    // This ensures E2S/test-budget sessions use the correct budget for background tasks
    const subscriptionId = context.budgetOverride ?? app?.subscriptionId;

    // Build execution context for grant-aware metadata
    // Include subscriptionId so buildLitellmMetadataFromContext can use subscription-based grant lookup
    const executionContext: ExecutionContext | undefined = (appId || subscriptionId) ? {
      metadata: {
        appId,
        sessionId: context.sessionId,
        subscriptionId,
        customerId,
      }
    } : undefined;

    // Additional tags to always include (service-specific)
    const additionalTags = ['source:tool-llm', 'source:summarization'];

    // Build metadata using the grants-aware helper
    let litellmMetadata: LitellmMetadata | null = null;
    if (executionContext) {
      litellmMetadata = buildLitellmMetadataFromContext(executionContext, {
        source: LlmCallSource.ServiceSummarization,
      });
    }

    // Merge additional tags into metadata from grants-aware helper
    if (litellmMetadata) {
      const mergedTags = [...new Set([...(litellmMetadata.tags || []), ...additionalTags])];
      litellmMetadata = { ...litellmMetadata, tags: mergedTags };
    }

    // Fallback to existing context if buildLitellmMetadataFromContext returned null
    // (feature flag off or no grants available)
    if (!litellmMetadata) {
      const existingMetadata = llmMetadataContext.getStore();
      let userIdentifier = existingMetadata?.user;

      if (!userIdentifier) {
        userIdentifier = subscriptionId || customerId;
      }

      const mergedTags = [...new Set([
        ...(existingMetadata?.tags || []),
        ...(existingMetadata ? [] : [
          customerId ? `cid:${customerId}` : undefined,
          `appId:${appId}`
        ].filter((t): t is string => !!t)),
        'source:tool-llm',
        'source:summarization'
      ])];

      litellmMetadata = {
        ...(userIdentifier && { user: userIdentifier }),
        tags: mergedTags
      };
    }

    const attributes: { userId: string; sessionId?: string; metadata?: Record<string, string> } = { userId: appId };
    if (context.sessionId) attributes.sessionId = context.sessionId;
    if (customerId) attributes.metadata = { customerId };

    // Extract generateText call to avoid duplication
    const generateTextWithAttributes = async () =>
      propagateAttributes(attributes, async () =>
        generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          temperature: 0.3,
          maxOutputTokens: 5000,
          experimental_telemetry: { isEnabled: true, functionId: 'summarization-llm' },
        })
      );

    // Wrap with metadata context if available
    const llmResult = litellmMetadata
      ? await llmMetadataContext.run(litellmMetadata, generateTextWithAttributes)
      : await generateTextWithAttributes();
    this.logAndExtractCaching(llmResult.usage);

    const summaryText = llmResult.text.trim();
    const tokenCountResult = await countTokens(summaryText, modelName);
    const summaryTokenCount = tokenCountResult.tokenCount;

    const newUpdateCount = shouldRegenerateFromScratch ? 0 : (previousUpdateCount + (isIncremental ? 1 : 0));
    const now = new Date().toISOString();

    logger.info('summarization.llm.complete', {
      appId,
      messageCount: messagesToSummarize.length,
      summaryTokenCount,
      originalTokenCount,
      compressionRatio: summaryTokenCount / Math.max(originalTokenCount, 1),
      incrementalUpdateCount: newUpdateCount,
      regeneratedFromScratch: shouldRegenerateFromScratch,
      modelName,
      mode: 'incremental',
    });

    const result: SummarizationResult = {
      summaryText,
      summaryTokenCount,
      modelUsed: modelName,
      messageRange,
      messageCount: messagesToSummarize.length,
      originalTokenCount,
      incrementalUpdateCount: newUpdateCount,
    };

    if (shouldRegenerateFromScratch) {
      result.lastFullSummarizationAt = now;
    } else if (context.lastFullSummarizationAt) {
      result.lastFullSummarizationAt = context.lastFullSummarizationAt;
    }

    if (operationLog) {
      result.operationLog = operationLog;
    }

    return result;
  }

  private buildSystemPrompt(existingSummary?: string): string {
    const baseInstructions = `Summarize the conversation for an AI agent to continue work.

Output format (use these heading structures when applicable):

## State
1-2 sentences on current project status.

## Completed
- Files modified: list file names
- Features built: brief descriptions

## Decisions
- Technical choices made

## Pending
- Outstanding work or issues

Rules:
- Under 2000 tokens
- Include file names
- Skip sections with no relevant content`;

    if (existingSummary) {
      return `${baseInstructions}

EXISTING:
${existingSummary}

Merge new info. Remove completed items from Pending.`;
    }

    return baseInstructions;
  }

  /**
   * Build user prompt with messages
   *
   * Extracts structured information from tool calls to preserve file names,
   * operations, and context that would otherwise be lost.
   *
   * @param messages - Messages to summarize
   * @param existingSummary - Existing summary if updating incrementally
   * @param operationLog - Cumulative operation log from all messages
   * @returns User prompt text
   */
  private buildUserPrompt(
    messages: LLMMessage[],
    existingSummary?: string,
    operationLog?: string
  ): string {
    const parts: string[] = [];

    // Include operation log at the start for context
    if (operationLog) {
      parts.push(`=== OPERATION LOG (all work done) ===\n${operationLog}`);
    }

    for (const msg of messages) {
      const content = getMessageContent(msg);

      if (msg.role === 'user' && content) {
        parts.push(`User: ${content}`);
      } else if (msg.role === 'assistant') {
        if (content) {
          parts.push(`Assistant: ${content}`);
        }
        // Extract structured tool call details instead of raw arguments
        if (isOpenAIMessage(msg) && msg.tool_calls && msg.tool_calls.length > 0) {
          const toolDetails = this.extractToolCallDetails(msg.tool_calls);
          if (toolDetails) {
            parts.push(`Actions:\n${toolDetails}`);
          }
        }
      } else if (msg.role === 'tool') {
        // Handle tool results - extract meaningful content
        const toolContent = this.extractToolResultContent(msg);
        if (toolContent) {
          parts.push(`Result: ${toolContent}`);
        }
      }
    }

    const messagesText = parts.join('\n\n');

    if (existingSummary) {
      return `New messages to integrate:\n${messagesText}`;
    }

    return `Conversation:\n${messagesText}`;
  }

  private logAndExtractCaching(usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
    cachedInputTokens?: number | undefined;
    cacheReadInputTokens?: number | undefined;
    cachedTokens?: number | undefined;
  }): number | undefined {
    if (!usage) return undefined;
    const cachedInputTokens =
      usage.cachedInputTokens ??
      usage.cacheReadInputTokens ??
      (usage as Record<string, number | undefined>).cachedTokens;

    logCachingStats({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      cachedInputTokens: cachedInputTokens ?? 0,
    });

    return cachedInputTokens ?? undefined;
  }

  /**
   * Create a fallback summary when LLM fails
   *
   * @param context - Summarization context
   * @returns Fallback summarization result
   */
  private async createFallbackSummary(context: SummarizationContext): Promise<SummarizationResult> {
    const { messages, messageRange, originalTokenCount } = context;

    // Simple fallback: concatenate first 500 chars of each message
    const parts: string[] = [];
    for (const msg of messages) {
      const content = getMessageContent(msg);
      if (content && msg.role !== 'system') {
        parts.push(`${msg.role}: ${content.substring(0, 200)}`);
      }
    }

    const summaryText = `[Fallback Summary] ${parts.join(' | ')}`;
    const tokenCountResult = await countTokens(summaryText, 'claude-3-5-sonnet');
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

  /**
   * Extract structured details from tool calls
   *
   * Parses tool arguments to extract file names and operations,
   * providing richer context than just tool names.
   *
   * Note: Uses abbreviated prefixes (e.g., "Read:", "Run:") for brevity.
   * This is intentional to save tokens for fast/small models (Haiku).
   * DetailedLLMSummarizationStrategy uses more verbose formatting.
   */
  private extractToolCallDetails(toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>): string {
    const details: string[] = [];

    for (const tc of toolCalls) {
      const name = tc.function?.name || 'unknown';
      let args: Record<string, unknown> = {};

      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        // Ignore parse errors
      }

      // Extract meaningful details based on tool type
      switch (name) {
        case 'file_edit':
        case 'fileEdit': {
          const operations = args.operations as Array<{ path?: string; mode?: string }> | undefined;
          if (operations && Array.isArray(operations)) {
            const fileOps = operations.map(op => {
              const fileName = op.path ? basename(op.path) : 'unknown';
              return `${op.mode || 'edit'}: ${fileName}`;
            });
            details.push(`Files: ${fileOps.join(', ')}`);
          } else {
            const path = args.path || args.target_file;
            const mode = args.mode || 'edit';
            if (path) {
              const fileName = basename(String(path));
              details.push(`${mode}: ${fileName}`);
            }
          }
          break;
        }
        case 'read_file':
        case 'readFile': {
          const path = args.target_file || args.file_path || args.path;
          if (path) {
            const fileName = basename(String(path));
            details.push(`Read: ${fileName}`);
          }
          break;
        }
        case 'terminal':
        case 'run_terminal_cmd': {
          const cmd = args.command || args.cmd;
          if (cmd) {
            const cmdStr = String(cmd).length > this.maxCommandLength
              ? String(cmd).substring(0, this.maxCommandLength) + '...'
              : String(cmd);
            details.push(`Run: ${cmdStr}`);
          }
          break;
        }
        case 'list_dir':
        case 'directoryListing': {
          const path = args.target_directory || args.path;
          if (path) {
            details.push(`List: ${path}`);
          }
          break;
        }
        case 'grep':
        case 'grep_tool': {
          const pattern = args.pattern || args.search;
          if (pattern) {
            details.push(`Search: "${pattern}"`);
          }
          break;
        }
        default:
          details.push(`${name}`);
      }
    }

    return details.join('\n');
  }

  /**
   * Type guard for text tool output in AI SDK v6 format
   */
  private isTextToolOutput(output: unknown): output is { type: 'text'; value?: string } {
    return (
      typeof output === 'object' &&
      output !== null &&
      'type' in output &&
      (output as { type: unknown }).type === 'text'
    );
  }

  /**
   * Extract meaningful content from tool results
   */
  private extractToolResultContent(msg: LLMMessage): string {
    if (isAIToolMessage(msg)) {
      const firstResult = msg.content[0];
      if (firstResult?.output && this.isTextToolOutput(firstResult.output)) {
        if (firstResult.output.value) {
          return firstResult.output.value.length > this.maxToolResultLength
            ? firstResult.output.value.substring(0, this.maxToolResultLength) + '...'
            : firstResult.output.value;
        }
      }
      return '';
    }

    const content = getMessageContent(msg);
    if (content) {
      return content.length > this.maxToolResultLength
        ? content.substring(0, this.maxToolResultLength) + '...'
        : content;
    }
    return '';
  }
}
