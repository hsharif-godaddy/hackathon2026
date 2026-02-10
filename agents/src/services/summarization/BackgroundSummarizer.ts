import type { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import type { SummaryRepository } from '../../database/repositories/SummaryRepository.js';
import { logger } from '../../logging/index.js';
import { countTokens } from '../../utils/token-counter.js';
import { getAgentModelWithName } from '../../utils/model-selection.js';
import type { SummarizationStrategy, SummarizationContext } from './SummarizationStrategy.js';
import {
  type LLMMessage,
  type DatabaseMessage,
  isAIToolMessage,
  isOpenAIMessage,
  getMessageContent,
} from '../ConversationHistoryLoader.js';

export type BackgroundSummarizerConversationRepo = Omit<
  Pick<
    ConversationRepository,
    'getByAppId' | 'getMessagesBatch' | 'getMessagesAfterMessageId' | 'getMessageById'
  >,
  'getMessagesBatch' | 'getMessageById'
> & {
  getMessagesBatch(conversationIds: string[]): Promise<DatabaseMessage[]>;
  getMessageById(messageId: string): Promise<DatabaseMessage | null>;
};

export type BackgroundSummarizerSummaryRepo = Pick<
  SummaryRepository,
  'findLatestForApp' | 'create'
>;
import { OperationLogExtractor } from './OperationLogExtractor.js';
import { OperationLogPruner } from './OperationLogPruner.js';

/**
 * Configuration for background summarization
 *
 * Tuned for conversational agentic platforms where users interact with
 * seconds-to-minutes between messages:
 * - Higher debounce (30s) waits for natural conversation lulls
 * - Higher max prompt (40k) reduces summarization frequency
 * - More recent turns (4) preserves immediate context
 */
export interface BackgroundSummarizerConfig {
  /** Target maximum prompt size (summary + new messages), used for background trigger (default: 40000) */
  maxPromptTokens: number;
  /** Debounce delay in milliseconds (default: 30000) */
  debounceMs: number;
  /** Number of recent user/assistant message pairs to keep unsummarized (default: 4) */
  keepRecentTurns: number;
}

/**
 * Background summarization service
 * 
 * Monitors token count when messages are added and triggers summarization
 * when threshold is exceeded. Uses queue/debounce to avoid duplicate work
 * and runs asynchronously without blocking message saves.
 */
export class BackgroundSummarizer {
  private conversationRepo: BackgroundSummarizerConversationRepo;
  private summaryRepo: BackgroundSummarizerSummaryRepo;
  private strategy: SummarizationStrategy;
  private config: BackgroundSummarizerConfig;
  private pendingJobs: Map<string, NodeJS.Timeout> = new Map();
  private processingJobs: Set<string> = new Set();

  constructor(
    conversationRepo: BackgroundSummarizerConversationRepo,
    summaryRepo: BackgroundSummarizerSummaryRepo,
    strategy: SummarizationStrategy,
    config: Partial<BackgroundSummarizerConfig> = {}
  ) {
    this.conversationRepo = conversationRepo;
    this.summaryRepo = summaryRepo;
    this.strategy = strategy;
    this.config = {
      maxPromptTokens: config.maxPromptTokens ?? 40000,
      debounceMs: config.debounceMs ?? 30000,
      keepRecentTurns: config.keepRecentTurns ?? 4,
    };
  }

  getMaxPromptTokens(): number {
    return this.config.maxPromptTokens;
  }

  /**
   * Check if summarization should be triggered for an app
   * Called after LLM usage is reported to check last-call token count
   * 
   * @param appId - ID of the app
   */
  async checkAndSummarize(appId: string, triggerTokenCount?: number): Promise<void> {
    // Debounce: cancel existing job for this app
    const existingJob = this.pendingJobs.get(appId);
    if (existingJob) {
      clearTimeout(existingJob);
    }

    // Schedule new job with debounce
    const job = setTimeout(async () => {
      this.pendingJobs.delete(appId);
      await this.processSummarization(appId, triggerTokenCount);
    }, this.config.debounceMs);

    this.pendingJobs.set(appId, job);
  }

  /**
   * Process summarization for an app
   * Summarizes all conversations for the app (not filtered by agent)
   * 
   * @param appId - ID of the app
   */
  private async processSummarization(appId: string, triggerTokenCount?: number): Promise<void> {
    // Prevent duplicate processing
    if (this.processingJobs.has(appId)) {
      logger.debug('summarization.background.skip_duplicate', { appId });
      return;
    }

    this.processingJobs.add(appId);

    try {
      // Load conversations first; if none, exit before any expensive work
      const conversations = await this.conversationRepo.getByAppId(appId);

      if (conversations.length === 0) {
        logger.debug('summarization.background.no_conversations', { appId });
        return;
      }

      // Check for existing summary to determine loading strategy
      let existingSummary = await this.summaryRepo.findLatestForApp(appId);

      // Use the same model tier as summarization ('full' tier, currently Claude Sonnet) for accurate token estimates
      const { modelName } = await getAgentModelWithName('full');

      // Load messages based on summarization mode
      let allMessages: DatabaseMessage[] = [];
      const shouldRegenerateFromScratch = (existingSummary?.incrementalUpdateCount ?? 0) >= 5;
      const shouldLoadFullHistory = !existingSummary || shouldRegenerateFromScratch;

      if (!shouldLoadFullHistory && existingSummary) {
        // Incremental mode: Load only messages after the last summary
        logger.debug('summarization.background.incremental_mode_attempt', {
          appId,
          lastSummaryEndId: existingSummary.messageRangeEnd,
        });

        allMessages = await this.conversationRepo.getMessagesAfterMessageId(
          appId,
          existingSummary.messageRangeEnd
        );

        // If no messages found, check if reference message still exists
        // Distinguish between "no new messages" vs "reference missing"
        if (allMessages.length === 0) {
          // Check if the reference message exists
          const refExists = await this.conversationRepo.getMessageById(existingSummary.messageRangeEnd);

          if (!refExists) {
            // Reference message is missing (deleted/migrated) - fall back to full mode
            logger.warn('summarization.background.incremental_fallback_to_full', {
              appId,
              lastSummaryEndId: existingSummary.messageRangeEnd,
              reason: 'Reference message not found, falling back to full summarization',
            });

            const conversationIds = conversations.map(c => c.id);
            const messages = await this.conversationRepo.getMessagesBatch(conversationIds);

            allMessages = messages.map((msg) => ({
              ...msg,
              conversationId: msg.conversationId,
            }));

            // Clear existingSummary to treat this as a full run, not incremental
            // This prevents double-counting and ensures proper context
            existingSummary = null;
          } else {
            // Reference exists but no new messages - this is expected, log and return
            logger.debug('summarization.background.no_new_messages_after_summary', {
              appId,
              lastSummaryEndId: existingSummary.messageRangeEnd,
            });
          }
        } else {
          logger.debug('summarization.background.incremental_mode_success', {
            appId,
            messagesLoaded: allMessages.length,
          });
        }
      } else {
        // Full mode: Load all messages using batch query (fixes N+1 pattern)
        logger.debug('summarization.background.full_mode', { appId });

        const conversationIds = conversations.map(c => c.id);
        const messages = await this.conversationRepo.getMessagesBatch(conversationIds);

        allMessages = messages.map((msg) => ({
          ...msg,
          conversationId: msg.conversationId,
        }));
      }

      allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      if (allMessages.length === 0) {
        logger.debug('summarization.background.no_new_messages', {
          appId,
          hasExistingSummary: !!existingSummary,
        });
        return;
      }

      // Convert to LLM messages once (optimization: single conversion instead of 3x)
      const allLlmMessages = this.convertToLLMMessages(allMessages);

      // Calculate how many recent messages to keep (exclude from summarization)
      // Count user/assistant pairs from the end
      const recentTurnsToKeep = this.config.keepRecentTurns;
      let recentMessageCount = 0;
      let turnCount = 0;

      for (let i = allMessages.length - 1; i >= 0 && turnCount < recentTurnsToKeep; i--) {
        const msg = allMessages[i];
        if (!msg) continue;

        // Count user and assistant messages as turns
        if (msg.sender === 'user' || msg.sender === 'agent') {
          recentMessageCount++;
          if (msg.sender === 'user') {
            turnCount++;
          }
        } else {
          // Include system/tool messages that are part of recent turns
          recentMessageCount++;
        }
      }

      // Calculate the cutoff point (everything before recent messages should be summarized)
      const summarizableMessageCount = allMessages.length - recentMessageCount;

      logger.debug('summarization.background.recent_turns_calculation', {
        appId,
        totalMessages: allMessages.length,
        recentTurnsToKeep,
        recentMessageCount,
        summarizableMessageCount,
      });

      if (summarizableMessageCount <= 0) {
        logger.debug('summarization.background.all_messages_recent', {
          appId,
          message: 'All messages are within recent turns, nothing to summarize',
        });
        return;
      }

      // Use sliced LLM messages (optimization: avoid reconverting)
      const fullHistoryMessagesDb = allMessages.slice(0, summarizableMessageCount);
      const fullHistoryMessages = allLlmMessages.slice(0, summarizableMessageCount);

      if (fullHistoryMessages.length === 0) {
        logger.debug('summarization.background.no_messages_to_summarize', { appId });
        return;
      }

      // Count tokens for full history (summarizable slice)
      const fullHistoryTokenCount = await this.countTokensForMessages(fullHistoryMessages, modelName);

      // Count tokens for all new messages (including recent turns)
      const totalNewTokenCount = await this.countTokensForMessages(allLlmMessages, modelName);

      // In the new approach, all loaded messages are "incremental" (new since last summary or first run)
      // So incrementalMessages = fullHistoryMessages (summarizable portion)
      const incrementalMessages = fullHistoryMessages;
      const incrementalTokenCount = totalNewTokenCount;

      const projectedPromptTokens =
        (existingSummary?.summaryTokenCount ?? 0) + totalNewTokenCount;

      const thresholdTokenCount = triggerTokenCount ?? projectedPromptTokens;
      const thresholdBasis = triggerTokenCount !== undefined ? 'lastCallTokens' : 'projectedPromptTokens';

      // Log token check at info level for visibility
      logger.info('summarization.background.token_check', {
        appId,
        loadedMessagesCount: allMessages.length,
        newMessagesCount: incrementalMessages.length,
        recentTurnsExcluded: recentMessageCount,
        incrementalTokens: incrementalTokenCount,
        summarizableTokens: fullHistoryTokenCount,
        projectedPromptTokens,
        maxPromptTokens: this.config.maxPromptTokens,
        thresholdBasis,
        thresholdTokenCount,
        thresholdExceeded: thresholdTokenCount > this.config.maxPromptTokens,
        fullHistoryTokens: fullHistoryTokenCount,
        totalMessagesCount: allMessages.length,
      });

      // Check if projected prompt size exceeds the target
      if (thresholdTokenCount <= this.config.maxPromptTokens) {
        logger.info('summarization.background.threshold_not_exceeded', {
          appId,
          thresholdBasis,
          thresholdTokenCount,
          maxPromptTokens: this.config.maxPromptTokens,
          tokensRemaining: this.config.maxPromptTokens - thresholdTokenCount,
          message: `No summarization needed: ${thresholdTokenCount} ${thresholdBasis} < ${this.config.maxPromptTokens} max`,
        });
        return;
      }

      // Log when threshold IS exceeded and summarization will be triggered
      logger.info('summarization.background.threshold_exceeded_triggering', {
        appId,
        thresholdBasis,
        thresholdTokenCount,
        maxPromptTokens: this.config.maxPromptTokens,
        tokensOverThreshold: thresholdTokenCount - this.config.maxPromptTokens,
        message: `SUMMARIZATION TRIGGERED: ${thresholdTokenCount} ${thresholdBasis} > ${this.config.maxPromptTokens} max`,
      });

      // Incremental operation log extraction optimization:
      // Extract only from NEW messages (allLlmMessages contains only new messages in incremental mode)
      // This avoids re-parsing all old tool calls every time
      let operationLogSourceMessages = allLlmMessages;
      let operationLogFromFullHistory = shouldLoadFullHistory;

      // Legacy summaries may not have an operation log; rebuild from full history in that case
      if (existingSummary && !existingSummary.operationLog && !shouldLoadFullHistory) {
        const conversationIds = conversations.map(c => c.id);
        const fullMessages = await this.conversationRepo.getMessagesBatch(conversationIds);
        fullMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        operationLogSourceMessages = this.convertToLLMMessages(fullMessages);
        operationLogFromFullHistory = true;
      }

      const newOperationEntries = OperationLogExtractor.extract(operationLogSourceMessages);

      let finalOperationEntries: typeof newOperationEntries;

      if (existingSummary?.operationLog && !operationLogFromFullHistory) {
        // Parse existing operation log and merge with new entries
        const existingEntries = OperationLogExtractor.deserialize(existingSummary.operationLog);

        // Merge and deduplicate, keeping max 500 operations
        finalOperationEntries = OperationLogExtractor.mergeAndPrune(
          existingEntries,
          newOperationEntries,
          500
        );

        logger.debug('summarization.background.operation_log_merged', {
          appId,
          existingEntries: existingEntries.length,
          newEntries: newOperationEntries.length,
          finalEntries: finalOperationEntries.length,
          reason: 'Merged existing and new operation log entries',
        });
      } else {
        // No existing log: prune new entries if needed
        finalOperationEntries = newOperationEntries.length > 500
          ? OperationLogPruner.prune(newOperationEntries, 500)
          : newOperationEntries;

        logger.debug('summarization.background.operation_log_created', {
          appId,
          entries: finalOperationEntries.length,
          reason: 'No existing log, created new operation log',
        });
      }

      // Format final entries for injection into prompt
      const operationLog = OperationLogExtractor.format(finalOperationEntries);
      const serializedOperationLog = finalOperationEntries.length > 0
        ? OperationLogExtractor.serialize(finalOperationEntries)
        : undefined;

      // Perform summarization
      logger.info('summarization.background.begin', {
        appId,
        totalMessagesToSummarize: fullHistoryMessages.length,
        newMessagesSinceLastSummary: incrementalMessages.length,
        totalTokens: fullHistoryTokenCount,
        incrementalTokens: incrementalTokenCount,
        hasExistingSummary: !!existingSummary,
        operationLogEntries: finalOperationEntries.length,
        strategy: this.strategy.name,
        message: `STARTING SUMMARIZATION: ${fullHistoryMessages.length} summarizable messages (${fullHistoryTokenCount} tokens); ${incrementalMessages.length} new messages (${incrementalTokenCount} tokens)`,
      });

      const isIncrementalRun = !!existingSummary && !shouldLoadFullHistory;
      const cumulativeStartId = isIncrementalRun
        ? existingSummary?.messageRangeStart || fullHistoryMessagesDb[0]?.id || ''
        : fullHistoryMessagesDb[0]?.id || '';
      const cumulativeEndId = fullHistoryMessagesDb[fullHistoryMessagesDb.length - 1]?.id || '';
      const cumulativeOriginalTokenCount = isIncrementalRun
        ? (existingSummary?.originalTokenCount ?? 0) + fullHistoryTokenCount
        : fullHistoryTokenCount;

      const context: SummarizationContext = {
        appId,
        messages: incrementalMessages,
        fullMessageHistory: fullHistoryMessages,
        messageRange: {
          startId: cumulativeStartId,
          endId: cumulativeEndId,
        },
        originalTokenCount: cumulativeOriginalTokenCount,
        incrementalTokenCount,
      };

      // Only add operationLog if it has content
      if (operationLog) {
        context.operationLog = operationLog;
      }

      if (existingSummary?.summaryText) {
        context.existingSummary = existingSummary.summaryText;
      }

      if (existingSummary?.incrementalUpdateCount !== undefined) {
        context.incrementalUpdateCount = existingSummary.incrementalUpdateCount;
      }

      if (existingSummary?.lastFullSummarizationAt) {
        context.lastFullSummarizationAt = existingSummary.lastFullSummarizationAt.toISOString();
      }

      const summaryResult = await this.strategy.summarize(context);

      if (serializedOperationLog) {
        summaryResult.operationLog = serializedOperationLog;
      }

      // Save summary to database
      await this.summaryRepo.create(summaryResult, appId);

      const compressionRatio = summaryResult.summaryTokenCount / summaryResult.originalTokenCount;
      const tokensSaved = summaryResult.originalTokenCount - summaryResult.summaryTokenCount;

      logger.info('summarization.background.complete', {
        appId,
        originalTokens: summaryResult.originalTokenCount,
        cumulativeOriginalTokens: summaryResult.originalTokenCount,
        summaryTokens: summaryResult.summaryTokenCount,
        tokensSaved,
        compressionBasis: 'cumulative',
        compressionRatio: compressionRatio.toFixed(3),
        compressionPercent: `${((1 - compressionRatio) * 100).toFixed(1)}%`,
        messagesProcessed: summaryResult.messageCount,
        strategy: this.strategy.name,
        message: `SUMMARIZATION COMPLETE (cumulative): ${summaryResult.originalTokenCount} → ${summaryResult.summaryTokenCount} tokens (saved ${tokensSaved} tokens, ${((1 - compressionRatio) * 100).toFixed(1)}% reduction)`,
      });
    } catch (error) {
      logger.error('summarization.background.failure', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.processingJobs.delete(appId);
    }
  }

  /**
   * Count tokens for a set of messages using the configured model
   */
  private async countTokensForMessages(messages: LLMMessage[], modelName: string): Promise<number> {
    let tokenCount = 0;
    for (const msg of messages) {
      const serialized = this.serializeMessage(msg);
      const result = await countTokens(serialized, modelName);
      tokenCount += result.tokenCount;
    }
    return tokenCount;
  }

  /**
   * Convert database messages to LLM messages
   * Simplified version for token counting
   */
  private convertToLLMMessages(dbMessages: DatabaseMessage[]): LLMMessage[] {
    const llmMessages: LLMMessage[] = [];

    for (const dbMsg of dbMessages) {
      if (dbMsg.sender === 'user') {
        llmMessages.push({
          role: 'user',
          content: dbMsg.content,
        });
      } else if (dbMsg.sender === 'agent') {
        // Handle segments if available
        if (dbMsg.segments && dbMsg.segments.length > 0) {
          for (const segment of dbMsg.segments) {
            if (segment.type === 'content' && segment.content) {
              llmMessages.push({
                role: 'assistant',
                content: segment.content,
              });
            } else if (segment.type === 'tool_call' && segment.tool_call) {
              if (segment.tool_call.tool_result) {
                const toolArgs = segment.tool_call.tool_args || {};
                llmMessages.push({
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: segment.tool_call.id,
                      type: 'function',
                      function: {
                        name: segment.tool_call.tool_name,
                        arguments: JSON.stringify(toolArgs),
                      },
                    },
                  ],
                });

                llmMessages.push({
                  role: 'tool',
                  content:
                    typeof segment.tool_call.tool_result === 'string'
                      ? segment.tool_call.tool_result
                      : JSON.stringify(segment.tool_call.tool_result),
                  tool_call_id: segment.tool_call.id,
                  name: segment.tool_call.tool_name,
                });
              }
            }
          }
        } else {
          llmMessages.push({
            role: 'assistant',
            content: dbMsg.content,
          });
        }
      }
    }

    return llmMessages;
  }

  /**
   * Serialize LLM message for token counting
   */
  private serializeMessage(message: LLMMessage): string {
    let serialized = getMessageContent(message);

    if (isOpenAIMessage(message) && message.tool_calls && message.tool_calls.length > 0) {
      serialized += '\n[Tool Calls]\n';
      for (const toolCall of message.tool_calls) {
        serialized += `${toolCall.function.name}: ${toolCall.function.arguments}\n`;
      }
    }

    if (message.role === 'tool') {
      if (isAIToolMessage(message)) {
        const toolResult = message.content[0];
        serialized += `\n[Tool Result: ${toolResult?.toolName}]\n${getMessageContent(message)}`;
      } else if (isOpenAIMessage(message)) {
        serialized += `\n[Tool Result: ${message.name}]\n${message.content}`;
      }
    }

    return serialized;
  }
}
