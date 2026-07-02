import type {
  ConversationLifecycleStore,
  ConversationTokenStore,
  MessageStore,
  SummaryStore,
} from '../../memory/interfaces/index.js';
import { workspaceScopeFromAppId } from '../../memory/interfaces/scope.js';
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
import type { BudgetOverride } from '@airo/ai-grants';
import { safeStringify } from '@airo/shared';

/**
 * Pending job data for debounced summarization
 */
interface PendingJob {
  timeout: NodeJS.Timeout;
  triggerTokenCount?: number;
  /** Budget override from the triggering session (E2S or test-accounts) */
  budgetOverride?: BudgetOverride;
  /** CustomerId captured from the triggering session for tenant-scoped store access */
  customerId?: string;
  /** Conversation that triggered summarization (for OTel/Langfuse correlation) */
  conversationId?: string;
  /** Site ID owning this app (for OTel/Langfuse correlation) */
  siteId?: string;
}

/**
 * Minimal conversation-store surface required by BackgroundSummarizer.
 *
 * The summarizer reads conversations and messages across three store concerns:
 *   - lifecycle: enumerate conversations for an app
 *   - message: batch/single message lookup
 *   - token: token estimation and post-cursor message loading
 *
 * Combining the needed methods here lets callers (initialize.ts, tests) either
 * pass a single composed object or satisfy it from the three adapter singletons.
 */
export type BackgroundSummarizerConversationStore = {
  getByAppId: ConversationLifecycleStore['getByAppId'];
  getMessagesBatch: MessageStore['getMessagesBatch'];
  getMessageById: MessageStore['getMessageById'];
  getMessagesAfterMessageId: ConversationTokenStore['getMessagesAfterMessageId'];
  getEstimatedTokensAfterMessageId: ConversationTokenStore['getEstimatedTokensAfterMessageId'];
  getEstimatedTokensForApp: ConversationTokenStore['getEstimatedTokensForApp'];
};

export type BackgroundSummarizerSummaryStore = Pick<
  SummaryStore,
  'findLatestForApp' | 'create'
>;
import { OperationLogExtractor } from './OperationLogExtractor.js';
import { OperationLogPruner } from './OperationLogPruner.js';

/**
 * Configuration for background summarization
 *
 * Tuned based on cost analysis:
 * - 10k token threshold: Summarization pays off after 2-4 requests
 * - 3s debounce: Short delay for GC and avoiding race conditions
 * - 4 recent messages skipped: Preserves immediate context
 */
export interface BackgroundSummarizerConfig {
  /** Token threshold for unsummarized messages to trigger summarization (default: 10000) */
  maxPromptTokens: number;
  /** Debounce delay in milliseconds (default: 3000) - short delay for GC, not batching */
  debounceMs: number;
  /** Number of recent conversation messages to keep unsummarized / excluded from summarization (default: 4) */
  keepRecentTurns: number;
  /**
   * Disable periodic full regeneration of summaries from scratch (default: true).
   * When true, the summarizer prefers incremental updates and does not schedule
   * full-history regenerations on a periodic basis.
   *
   * Full-history work can still occur in fallback cases, including:
   * - when there is no existing summary yet (first summarization)
   * - when incremental summarization falls back due to a missing reference message
   * - when rebuilding a legacy operation log from raw messages
   *
   * Full regeneration reprocesses the entire conversation history, whose cost grows
   * linearly with conversation length. The operation log already provides durable
   * structured context that survives incremental updates, making periodic full
   * regeneration unnecessary in most cases.
   */
  disableFullRegeneration: boolean;
}

/**
 * Background summarization service
 * 
 * Monitors token count when messages are added and triggers summarization
 * when threshold is exceeded. Uses queue/debounce to avoid duplicate work
 * and runs asynchronously without blocking message saves.
 */
export class BackgroundSummarizer {
  private conversationStore: BackgroundSummarizerConversationStore;
  private summaryStore: BackgroundSummarizerSummaryStore;
  private strategy: SummarizationStrategy;
  private config: BackgroundSummarizerConfig;
  private pendingJobs: Map<string, PendingJob> = new Map();
  private processingJobs: Set<string> = new Set();

  constructor(
    conversationStore: BackgroundSummarizerConversationStore,
    summaryStore: BackgroundSummarizerSummaryStore,
    strategy: SummarizationStrategy,
    config: Partial<BackgroundSummarizerConfig> = {}
  ) {
    this.conversationStore = conversationStore;
    this.summaryStore = summaryStore;
    this.strategy = strategy;
    this.config = {
      maxPromptTokens: config.maxPromptTokens ?? 10000,
      debounceMs: config.debounceMs ?? 3000,
      keepRecentTurns: config.keepRecentTurns ?? 4,
      disableFullRegeneration: config.disableFullRegeneration ?? true,
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
   * @param triggerTokenCount - Optional token count that triggered the check
   * @param budgetOverride - Optional budget override from triggering session (E2S or test-accounts)
   * @param customerId - Optional customerId from triggering session for tenant-scoped store access
   * @param conversationId - Optional conversationId that triggered the check (for OTel correlation)
   * @param siteId - Optional site ID owning this app (for OTel correlation)
   */
  async checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: BudgetOverride, customerId?: string, conversationId?: string, siteId?: string): Promise<void> {
    // Debounce: cancel existing job for this app
    const existingJob = this.pendingJobs.get(appId);
    if (existingJob) {
      clearTimeout(existingJob.timeout);
    }

    // Preserve existing budget override if the incoming one is undefined.
    // This prevents a race condition where an E2S session triggers summarization,
    // then a regular session triggers within the debounce window and clears the override.
    const effectiveBudgetOverride = budgetOverride ?? existingJob?.budgetOverride;
    // Same race-prevention rationale applies to customerId.
    const effectiveCustomerId = customerId ?? existingJob?.customerId;
    // Preserve most recent known conversationId/siteId for OTel correlation
    const effectiveConversationId = conversationId ?? existingJob?.conversationId;
    const effectiveSiteId = siteId ?? existingJob?.siteId;

    // Schedule new job with debounce
    // Capture the budget override from the triggering session
    const timeout = setTimeout(async () => {
      const job = this.pendingJobs.get(appId);
      // Guard against race condition: only process if this timeout is still the active one.
      // If checkAndSummarize was called again, a new timeout was scheduled and stored,
      // so this stale timeout should not delete/process the newer job.
      if (!job || job.timeout !== timeout) {
        return;
      }
      this.pendingJobs.delete(appId);
      await this.processSummarization(appId, job.triggerTokenCount, job.budgetOverride, job.customerId, job.conversationId, job.siteId);
    }, this.config.debounceMs);

    this.pendingJobs.set(appId, {
      timeout,
      triggerTokenCount,
      budgetOverride: effectiveBudgetOverride,
      customerId: effectiveCustomerId,
      conversationId: effectiveConversationId,
      siteId: effectiveSiteId,
    });
  }

  /**
   * Process summarization for an app
   * Summarizes all conversations for the app (not filtered by agent)
   *
   * @param appId - ID of the app
   * @param triggerTokenCount - Optional token count that triggered the check
   * @param budgetOverride - Optional budget override from triggering session (E2S or test-accounts)
   * @param customerId - Optional customerId from triggering session for tenant-scoped store access
   * @param conversationId - Optional conversationId that triggered the check (for OTel correlation)
   * @param siteId - Optional site ID owning this app (for OTel correlation)
   */
  private async processSummarization(appId: string, triggerTokenCount?: number, budgetOverride?: BudgetOverride, customerId?: string, conversationId?: string, siteId?: string): Promise<void> {
    // Prevent duplicate processing
    if (this.processingJobs.has(appId)) {
      logger.debug('summarization.background.skip_duplicate', { appId });
      return;
    }

    this.processingJobs.add(appId);

    try {
      const scope = workspaceScopeFromAppId(appId, customerId);

      // Load conversations first; if none, exit before any expensive work
      const conversations = await this.conversationStore.getByAppId(scope);

      if (conversations.length === 0) {
        logger.debug('summarization.background.no_conversations', { appId });
        return;
      }

      // Check for existing summary to determine loading strategy
      let existingSummary = await this.summaryStore.findLatestForApp(scope);

      // Use the same model tier as summarization ('full' tier, currently Claude Sonnet) for accurate token estimates
      const { modelName } = await getAgentModelWithName('full');

      // Load messages based on summarization mode
      let allMessages: DatabaseMessage[] = [];
      // Regenerate from scratch every 5 incremental updates to maintain quality
      // and ensure cumulative drift doesn't lose important context.
      // Disabled by default: full regeneration cost grows linearly with conversation
      // length and the operation log already provides durable structured context.
      const shouldRegenerateFromScratch = !this.config.disableFullRegeneration
        && (existingSummary?.incrementalUpdateCount ?? 0) >= 5;
      const shouldLoadFullHistory = !existingSummary || shouldRegenerateFromScratch;
      // Track if we're in incremental mode (affects keepRecentTurns behavior)
      const isIncrementalMode = !shouldLoadFullHistory && !!existingSummary;

      // OPTIMIZATION: Early exit using content-length-based token estimation before loading full content
      // Uses SUM(LENGTH(content) + LENGTH(segments)) / 4 as token estimate (4 chars ≈ 1 token)
      // This accounts for varying message sizes (1 tool call vs 50 tool calls)

      if (existingSummary && shouldRegenerateFromScratch) {
        // For regenerate mode: estimate TOTAL tokens since full history will be processed
        // (not just new messages - regenerate processes everything from scratch)
        const estimatedTotalTokens = await this.conversationStore.getEstimatedTokensForApp(scope);
        // Use 80% of threshold as cutoff to account for estimation variance
        const estimateThreshold = this.config.maxPromptTokens * 0.8;

        if (estimatedTotalTokens < estimateThreshold) {
          logger.debug('summarization.background.skip_regenerate_estimate', {
            appId,
            estimatedTotalTokens,
            threshold: this.config.maxPromptTokens,
            message: `Skipping regenerate: estimated ${estimatedTotalTokens} total tokens < ${estimateThreshold} threshold`,
          });
          return;
        }
      } else if (!existingSummary) {
        // For first-time summarization: estimate total tokens from content length
        const estimatedTotalTokens = await this.conversationStore.getEstimatedTokensForApp(scope);
        // Use 80% of threshold as cutoff to account for estimation variance
        const estimateThreshold = this.config.maxPromptTokens * 0.8;

        if (estimatedTotalTokens < estimateThreshold) {
          logger.debug('summarization.background.skip_first_time_estimate', {
            appId,
            estimatedTotalTokens,
            threshold: this.config.maxPromptTokens,
            message: `Skipping first-time: estimated ${estimatedTotalTokens} tokens < ${estimateThreshold} threshold`,
          });
          return;
        }
      }

      if (!shouldLoadFullHistory && existingSummary) {
        // Incremental mode: First check if new messages could exceed threshold
        // Use content-length-based estimation to avoid loading messages unnecessarily
        const estimatedNewTokens = await this.conversationStore.getEstimatedTokensAfterMessageId(
          scope,
          existingSummary.messageRangeEnd
        );

        if (estimatedNewTokens === null) {
          // Reference message not found - fall back to full mode
          logger.warn('summarization.background.incremental_fallback_to_full', {
            appId,
            lastSummaryEndId: existingSummary.messageRangeEnd,
            reason: 'Reference message not found, falling back to full summarization',
          });

          const conversationIds = conversations.map(c => c.id);
          const messages = await this.conversationStore.getMessagesBatch(conversationIds);

          allMessages = messages.map((msg) => ({
            ...msg,
            conversationId: msg.conversationId,
          }));

          // Clear existingSummary to treat this as a full run, not incremental
          existingSummary = null;
        } else if (estimatedNewTokens === 0) {
          // No new messages - exit early
          logger.debug('summarization.background.no_new_messages_after_summary', {
            appId,
            lastSummaryEndId: existingSummary.messageRangeEnd,
          });
          return;
        } else {
          // Check if estimated tokens are under threshold
          const estimateThreshold = this.config.maxPromptTokens * 0.8;
          if (estimatedNewTokens < estimateThreshold) {
            logger.debug('summarization.background.skip_incremental_estimate', {
              appId,
              estimatedNewTokens,
              threshold: this.config.maxPromptTokens,
              message: `Skipping incremental: estimated ${estimatedNewTokens} tokens < ${estimateThreshold} threshold`,
            });
            return;
          }

          // Load messages after the last summary
          logger.debug('summarization.background.incremental_mode_attempt', {
            appId,
            lastSummaryEndId: existingSummary.messageRangeEnd,
            estimatedNewTokens,
          });

          allMessages = await this.conversationStore.getMessagesAfterMessageId(
            scope,
            existingSummary.messageRangeEnd
          );


          logger.debug('summarization.background.incremental_mode_success', {
            appId,
            messagesLoaded: allMessages.length,
          });
        }
      } else {
        // Full mode: Load all messages using batch query (fixes N+1 pattern)
        logger.debug('summarization.background.full_mode', { appId });

        const conversationIds = conversations.map(c => c.id);
        const messages = await this.conversationStore.getMessagesBatch(conversationIds);

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

      // Calculate how many recent DB messages to keep (exclude from summarization)
      // In incremental mode: skip last N messages (simple count), skip if <= N total
      // In full mode: use keepRecentTurns (counts user turns)
      const recentMessagesToSkip = this.config.keepRecentTurns;
      let recentDbMessageCount = 0;
      let summarizableDbMessageCount: number;

      if (isIncrementalMode) {
        // Incremental mode: skip last 4 messages, don't run if <= 4 messages
        if (allMessages.length <= recentMessagesToSkip) {
          logger.debug('summarization.background.incremental_skip_few_messages', {
            appId,
            totalDbMessages: allMessages.length,
            recentMessagesToSkip,
            message: `Incremental mode: skipping - only ${allMessages.length} messages (<= ${recentMessagesToSkip})`,
          });
          return;
        }
        recentDbMessageCount = recentMessagesToSkip;
        summarizableDbMessageCount = allMessages.length - recentMessagesToSkip;
        logger.debug('summarization.background.incremental_mode', {
          appId,
          totalDbMessages: allMessages.length,
          recentMessagesToSkip,
          summarizableDbMessageCount,
        });
      } else {
        // Full mode: apply keepRecentTurns to exclude recent conversation (counts user turns)
        const recentTurnsToKeep = this.config.keepRecentTurns;
        let turnCount = 0;

        for (let i = allMessages.length - 1; i >= 0 && turnCount < recentTurnsToKeep; i--) {
          const msg = allMessages[i];
          if (!msg) continue;

          // Count user and assistant messages as turns
          if (msg.sender === 'user' || msg.sender === 'agent') {
            recentDbMessageCount++;
            if (msg.sender === 'user') {
              turnCount++;
            }
          } else {
            // Include system/tool messages that are part of recent turns
            recentDbMessageCount++;
          }
        }

        summarizableDbMessageCount = allMessages.length - recentDbMessageCount;

        logger.debug('summarization.background.recent_turns_calculation', {
          appId,
          totalDbMessages: allMessages.length,
          recentTurnsToKeep,
          recentDbMessageCount,
          summarizableDbMessageCount,
        });

        if (summarizableDbMessageCount <= 0) {
          logger.debug('summarization.background.all_messages_recent', {
            appId,
            message: 'All messages are within recent turns, nothing to summarize',
          });
          return;
        }
      }

      // CRITICAL: Slice DB messages FIRST, then convert to LLM format
      // Previously we converted all messages then sliced by DB count, which caused
      // messages to be lost because 1 DB message can expand to many LLM messages
      // (e.g., 1 agent message with 5 tool calls becomes 11 LLM messages)
      const fullHistoryMessagesDb = allMessages.slice(0, summarizableDbMessageCount);
      const fullHistoryMessages = this.convertToLLMMessages(fullHistoryMessagesDb);

      // Build full LLM message history by reusing the already-converted prefix
      // and only converting the non-summarized tail of DB messages (avoids O(2n) conversion)
      const recentDbMessages = allMessages.slice(summarizableDbMessageCount);
      const recentLlmMessages = this.convertToLLMMessages(recentDbMessages);
      const allLlmMessages = [...fullHistoryMessages, ...recentLlmMessages];

      if (fullHistoryMessages.length === 0) {
        logger.debug('summarization.background.no_messages_to_summarize', { appId });
        return;
      }

      // Count tokens for summarizable messages (excluding skipped recent messages)
      const summarizableTokenCount = await this.countTokensForMessages(fullHistoryMessages, modelName);

      // Log token check at info level for visibility
      logger.info('summarization.background.token_check', {
        appId,
        loadedMessagesCount: allMessages.length,
        summarizableMessagesCount: fullHistoryMessages.length,
        recentMessagesExcluded: recentDbMessageCount,
        summarizableTokens: summarizableTokenCount,
        maxPromptTokens: this.config.maxPromptTokens,
        thresholdExceeded: summarizableTokenCount > this.config.maxPromptTokens,
      });

      // Check if summarizable tokens exceed the threshold
      // This checks ONLY the messages that will be summarized (excludes 4 skipped)
      if (summarizableTokenCount <= this.config.maxPromptTokens) {
        logger.info('summarization.background.threshold_not_exceeded', {
          appId,
          summarizableTokens: summarizableTokenCount,
          maxPromptTokens: this.config.maxPromptTokens,
          tokensRemaining: this.config.maxPromptTokens - summarizableTokenCount,
          message: `No summarization needed: ${summarizableTokenCount} summarizable tokens < ${this.config.maxPromptTokens} threshold`,
        });
        return;
      }

      // Log when threshold IS exceeded and summarization will be triggered
      logger.info('summarization.background.threshold_exceeded_triggering', {
        appId,
        summarizableTokens: summarizableTokenCount,
        maxPromptTokens: this.config.maxPromptTokens,
        tokensOverThreshold: summarizableTokenCount - this.config.maxPromptTokens,
        message: `SUMMARIZATION TRIGGERED: ${summarizableTokenCount} summarizable tokens > ${this.config.maxPromptTokens} threshold`,
      });

      // Incremental operation log extraction optimization:
      // Extract only from NEW messages (allLlmMessages contains only new messages in incremental mode)
      // This avoids re-parsing all old tool calls every time
      let operationLogSourceMessages = allLlmMessages;
      let operationLogFromFullHistory = shouldLoadFullHistory;

      // Legacy summaries may not have an operation log; rebuild from full history in that case
      if (existingSummary && !existingSummary.operationLog && !shouldLoadFullHistory) {
        const conversationIds = conversations.map(c => c.id);
        const fullMessages = await this.conversationStore.getMessagesBatch(conversationIds);
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
        messagesToSummarize: fullHistoryMessages.length,
        summarizableTokens: summarizableTokenCount,
        hasExistingSummary: !!existingSummary,
        isIncrementalMode,
        operationLogEntries: finalOperationEntries.length,
        strategy: this.strategy.name,
        message: `STARTING SUMMARIZATION: ${fullHistoryMessages.length} messages (${summarizableTokenCount} tokens)`,
      });

      const cumulativeStartId = isIncrementalMode
        ? existingSummary?.messageRangeStart || fullHistoryMessagesDb[0]?.id || ''
        : fullHistoryMessagesDb[0]?.id || '';
      const cumulativeEndId = fullHistoryMessagesDb[fullHistoryMessagesDb.length - 1]?.id || '';
      const cumulativeOriginalTokenCount = isIncrementalMode
        ? (existingSummary?.originalTokenCount ?? 0) + summarizableTokenCount
        : summarizableTokenCount;

      const context: SummarizationContext = {
        appId,
        conversationId,
        siteId,
        messages: fullHistoryMessages,
        fullMessageHistory: fullHistoryMessages,
        messageRange: {
          startId: cumulativeStartId,
          endId: cumulativeEndId,
        },
        originalTokenCount: cumulativeOriginalTokenCount,
        incrementalTokenCount: summarizableTokenCount,
        disableFullRegeneration: this.config.disableFullRegeneration,
        budgetOverride,
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
      await this.summaryStore.create(scope, summaryResult);

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
              if (segment.tool_call.toolResult) {
                const toolArgs = segment.tool_call.toolArgs || {};
                llmMessages.push({
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: segment.tool_call.id,
                      type: 'function',
                      function: {
                        name: segment.tool_call.toolName,
                        arguments: safeStringify(toolArgs),
                      },
                    },
                  ],
                });

                llmMessages.push({
                  role: 'tool',
                  content:
                    typeof segment.tool_call.toolResult === 'string'
                      ? segment.tool_call.toolResult
                      : safeStringify(segment.tool_call.toolResult),
                  tool_call_id: segment.tool_call.id,
                  name: segment.tool_call.toolName,
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
