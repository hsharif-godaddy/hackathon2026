import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { SummaryRepository } from '../../database/repositories/SummaryRepository.js';
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
import { OperationLogExtractor } from './OperationLogExtractor.js';

/**
 * Configuration for background summarization
 *
 * Tuned for conversational agentic platforms where users interact with
 * seconds-to-minutes between messages:
 * - Higher debounce (30s) waits for natural conversation lulls
 * - Higher token threshold (35k) reduces summarization frequency
 * - More recent turns (4) preserves immediate context
 */
export interface BackgroundSummarizerConfig {
  /** Token threshold to trigger summarization (default: 35000) */
  tokenThreshold: number;
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
  private conversationRepo: ConversationRepository;
  private summaryRepo: SummaryRepository;
  private strategy: SummarizationStrategy;
  private config: BackgroundSummarizerConfig;
  private pendingJobs: Map<string, NodeJS.Timeout> = new Map();
  private processingJobs: Set<string> = new Set();

  constructor(
    conversationRepo: ConversationRepository,
    summaryRepo: SummaryRepository,
    strategy: SummarizationStrategy,
    config: Partial<BackgroundSummarizerConfig> = {}
  ) {
    this.conversationRepo = conversationRepo;
    this.summaryRepo = summaryRepo;
    this.strategy = strategy;
    this.config = {
      tokenThreshold: config.tokenThreshold ?? 35000,
      debounceMs: config.debounceMs ?? 30000,
      keepRecentTurns: config.keepRecentTurns ?? 4,
    };
  }

  /**
   * Check if summarization should be triggered for an app
   * Called after messages are added to check token count
   * 
   * @param appId - ID of the app
   */
  async checkAndSummarize(appId: string): Promise<void> {
    // Debounce: cancel existing job for this app
    const existingJob = this.pendingJobs.get(appId);
    if (existingJob) {
      clearTimeout(existingJob);
    }

    // Schedule new job with debounce
    const job = setTimeout(async () => {
      this.pendingJobs.delete(appId);
      await this.processSummarization(appId);
    }, this.config.debounceMs);

    this.pendingJobs.set(appId, job);
  }

  /**
   * Process summarization for an app
   * Summarizes all conversations for the app (not filtered by agent)
   * 
   * @param appId - ID of the app
   */
  private async processSummarization(appId: string): Promise<void> {
    // Prevent duplicate processing
    if (this.processingJobs.has(appId)) {
      logger.debug('summarization.background.skip_duplicate', { appId });
      return;
    }

    this.processingJobs.add(appId);

    try {
      // Load all messages for the app
      const conversations = await this.conversationRepo.getByAppId(appId);
      const allMessages: DatabaseMessage[] = [];

      for (const conversation of conversations) {
        const messages = await this.conversationRepo.getMessagesForHistory(conversation.id);
        allMessages.push(
          ...messages.map((msg) => ({
            ...msg,
            conversationId: conversation.id,
          }))
        );
      }

      allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      if (allMessages.length === 0) {
        logger.debug('summarization.background.no_messages', { appId });
        return;
      }

      // Convert to LLM messages for token counting
      const llmMessages = this.convertToLLMMessages(allMessages);

      // Use the same model tier as summarization ('full' tier, currently Claude Sonnet) for accurate token estimates
      const { modelName } = await getAgentModelWithName('full');

      // Get existing summary if any
      const existingSummary = await this.summaryRepo.findLatestForApp(appId);

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

      // Capture full history to summarize (everything before recent turns)
      const fullHistoryMessagesDb = allMessages.slice(0, summarizableMessageCount);
      const fullHistoryMessages = this.convertToLLMMessages(fullHistoryMessagesDb);
      const fullHistoryTokenCount = this.countTokensForMessages(fullHistoryMessages, modelName);

      if (fullHistoryMessages.length === 0) {
        logger.debug('summarization.background.no_messages_to_summarize', { appId });
        return;
      }

      // Determine incremental slice since last summary for thresholding/fallbacks
      let incrementalMessagesDb = fullHistoryMessagesDb;

      if (existingSummary) {
        const lastSummaryEndIndex = fullHistoryMessagesDb.findIndex(
          (msg) => msg.id === existingSummary.messageRangeEnd
        );

        if (lastSummaryEndIndex === -1) {
          logger.warn('summarization.background.summary_range_not_found', {
            appId,
            summaryId: existingSummary.id,
          });
        } else {
          const startIndex = lastSummaryEndIndex + 1;
          if (startIndex < fullHistoryMessagesDb.length) {
            incrementalMessagesDb = fullHistoryMessagesDb.slice(startIndex);
          } else {
            incrementalMessagesDb = [];
          }
        }
      }

      if (incrementalMessagesDb.length === 0) {
        logger.debug('summarization.background.no_new_messages_to_summarize', {
          appId,
          summarizableMessageCount,
        });
        return;
      }

      const incrementalMessages = this.convertToLLMMessages(incrementalMessagesDb);
      const incrementalTokenCount = this.countTokensForMessages(incrementalMessages, modelName);

      // Log token check at info level for visibility
      logger.info('summarization.background.token_check', {
        appId,
        newMessagesCount: incrementalMessages.length,
        incrementalTokens: incrementalTokenCount,
        threshold: this.config.tokenThreshold,
        thresholdExceeded: incrementalTokenCount > this.config.tokenThreshold,
        fullHistoryTokens: fullHistoryTokenCount,
        totalMessagesCount: allMessages.length,
      });

      // Check if threshold exceeded for unsummarized messages
      if (incrementalTokenCount <= this.config.tokenThreshold) {
        logger.info('summarization.background.threshold_not_exceeded', {
          appId,
          incrementalTokens: incrementalTokenCount,
          threshold: this.config.tokenThreshold,
          tokensRemaining: this.config.tokenThreshold - incrementalTokenCount,
          message: `${incrementalTokenCount} tokens < ${this.config.tokenThreshold} threshold - no summarization needed`,
        });
        return;
      }

      // Log when threshold IS exceeded and summarization will be triggered
      logger.info('summarization.background.threshold_exceeded_triggering', {
        appId,
        incrementalTokens: incrementalTokenCount,
        threshold: this.config.tokenThreshold,
        tokensOverThreshold: incrementalTokenCount - this.config.tokenThreshold,
        message: `SUMMARIZATION TRIGGERED: ${incrementalTokenCount} tokens > ${this.config.tokenThreshold} threshold`,
      });

      // Extract operation log from ALL messages (cumulative record)
      // This captures everything done in the conversation, even if some messages
      // have been summarized away
      // Prune to prevent unbounded growth (keep last 500 operations)
      const operationLogEntries = OperationLogExtractor.extractAndPrune(llmMessages, 500);
      const operationLog = OperationLogExtractor.format(operationLogEntries);

      // Perform summarization
      logger.info('summarization.background.begin', {
        appId,
        totalMessagesToSummarize: fullHistoryMessages.length,
        newMessagesSinceLastSummary: incrementalMessages.length,
        totalTokens: fullHistoryTokenCount,
        incrementalTokens: incrementalTokenCount,
        hasExistingSummary: !!existingSummary,
        operationLogEntries: operationLogEntries.length,
        strategy: this.strategy.name,
        message: `STARTING SUMMARIZATION: ${fullHistoryMessages.length} messages, ${fullHistoryTokenCount} tokens`,
      });

      const context: SummarizationContext = {
        appId,
        messages: incrementalMessages,
        fullMessageHistory: fullHistoryMessages,
        messageRange: {
          startId: fullHistoryMessagesDb[0]?.id || '',
          endId: fullHistoryMessagesDb[fullHistoryMessagesDb.length - 1]?.id || '',
        },
        originalTokenCount: fullHistoryTokenCount,
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

      // Save summary to database
      await this.summaryRepo.create(summaryResult, appId);

      const compressionRatio = summaryResult.summaryTokenCount / summaryResult.originalTokenCount;
      const tokensSaved = summaryResult.originalTokenCount - summaryResult.summaryTokenCount;

      logger.info('summarization.background.complete', {
        appId,
        originalTokens: summaryResult.originalTokenCount,
        summaryTokens: summaryResult.summaryTokenCount,
        tokensSaved,
        compressionRatio: compressionRatio.toFixed(3),
        compressionPercent: `${((1 - compressionRatio) * 100).toFixed(1)}%`,
        messagesProcessed: summaryResult.messageCount,
        strategy: this.strategy.name,
        message: `SUMMARIZATION COMPLETE: ${summaryResult.originalTokenCount} → ${summaryResult.summaryTokenCount} tokens (saved ${tokensSaved} tokens, ${((1 - compressionRatio) * 100).toFixed(1)}% compression)`,
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
  private countTokensForMessages(messages: LLMMessage[], modelName: string): number {
    let tokenCount = 0;
    for (const msg of messages) {
      const serialized = this.serializeMessage(msg);
      const result = countTokens(serialized, modelName);
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
                llmMessages.push({
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: segment.tool_call.id,
                      type: 'function',
                      function: {
                        name: segment.tool_call.tool_name,
                        arguments: JSON.stringify(segment.tool_call.tool_args || {}),
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
