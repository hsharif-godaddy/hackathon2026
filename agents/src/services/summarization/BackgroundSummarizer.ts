import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { SummaryRepository } from '../../database/repositories/SummaryRepository.js';
import { logger } from '../../logging/index.js';
import { countTokens } from '../../utils/token-counter.js';
import { getAgentModelWithName } from '../../utils/model-selection.js';
import type { SummarizationStrategy, SummarizationContext } from './SummarizationStrategy.js';
import type { LLMMessage } from '../ConversationHistoryLoader.js';
import type { DatabaseMessage } from '../ConversationHistoryLoader.js';

/**
 * Configuration for background summarization
 */
export interface BackgroundSummarizerConfig {
  /** Token threshold to trigger summarization (default: 50000) */
  tokenThreshold: number;
  /** Debounce delay in milliseconds (default: 5000) */
  debounceMs: number;
  /** Number of recent user/assistant message pairs to keep unsummarized (default: 3) */
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
      tokenThreshold: config.tokenThreshold ?? 50000,
      debounceMs: config.debounceMs ?? 5000,
      keepRecentTurns: config.keepRecentTurns ?? 3,
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

      // Get the actual model name for token counting (resolves 'fast' to 'sonnet' etc.)
      const { modelName } = await getAgentModelWithName('fast');

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

      // Determine message range to summarize
      let messagesToSummarize: LLMMessage[];
      let startMessageId: string;
      let endMessageId: string;

      if (existingSummary) {
        // Incremental: summarize messages between last summary and recent cutoff
        const lastSummaryEndIndex = allMessages.findIndex(
          (msg) => msg.id === existingSummary.messageRangeEnd
        );

        if (lastSummaryEndIndex === -1) {
          logger.warn('summarization.background.summary_range_not_found', {
            appId,
            summaryId: existingSummary.id,
          });
          return;
        }

        const startIndex = lastSummaryEndIndex + 1;
        const endIndex = summarizableMessageCount;

        if (startIndex >= endIndex) {
          // No new messages to summarize
          logger.debug('summarization.background.no_new_messages_to_summarize', {
            appId,
            lastSummaryEndIndex,
            summarizableMessageCount,
          });
          return;
        }

        const newMessages = allMessages.slice(startIndex, endIndex);
        messagesToSummarize = this.convertToLLMMessages(newMessages);
        startMessageId = newMessages[0]?.id || '';
        endMessageId = newMessages[newMessages.length - 1]?.id || '';
      } else {
        // Initial: summarize all messages except recent turns
        const messagesToSummarizeDb = allMessages.slice(0, summarizableMessageCount);
        messagesToSummarize = this.convertToLLMMessages(messagesToSummarizeDb);
        startMessageId = messagesToSummarizeDb[0]?.id || '';
        endMessageId = messagesToSummarizeDb[messagesToSummarizeDb.length - 1]?.id || '';
      }

      if (messagesToSummarize.length === 0) {
        logger.debug('summarization.background.no_messages_to_summarize', { appId });
        return;
      }

      // Count tokens for messages to summarize (unsummarized portion only)
      let unsummarizedTokenCount = 0;
      for (const msg of messagesToSummarize) {
        const serialized = this.serializeMessage(msg);
        const result = countTokens(serialized, modelName);
        unsummarizedTokenCount += result.tokenCount;
      }

      logger.debug('summarization.background.token_check', {
        appId,
        messagesToSummarize: messagesToSummarize.length,
        unsummarizedTokenCount,
        threshold: this.config.tokenThreshold,
      });

      // Check if threshold exceeded for unsummarized messages
      if (unsummarizedTokenCount <= this.config.tokenThreshold) {
        logger.debug('summarization.background.threshold_not_exceeded', {
          appId,
          unsummarizedTokenCount,
          threshold: this.config.tokenThreshold,
        });
        return;
      }

      // Perform summarization
      logger.info('summarization.background.begin', {
        appId,
        messageCount: messagesToSummarize.length,
        tokenCount: unsummarizedTokenCount,
        hasExistingSummary: !!existingSummary,
      });

      const context: SummarizationContext = {
        appId,
        messages: messagesToSummarize,
        messageRange: {
          startId: startMessageId,
          endId: endMessageId,
        },
        originalTokenCount: unsummarizedTokenCount,
      };

      if (existingSummary?.summaryText) {
        context.existingSummary = existingSummary.summaryText;
      }

      const summaryResult = await this.strategy.summarize(context);

      // Save summary to database
      await this.summaryRepo.create(summaryResult, appId);

      logger.info('summarization.background.complete', {
        appId,
        summaryId: summaryResult.summaryText.substring(0, 50),
        originalTokens: summaryResult.originalTokenCount,
        summaryTokens: summaryResult.summaryTokenCount,
        compressionRatio: summaryResult.summaryTokenCount / summaryResult.originalTokenCount,
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
    let serialized = message.content || '';

    if (message.tool_calls && message.tool_calls.length > 0) {
      serialized += '\n[Tool Calls]\n';
      for (const toolCall of message.tool_calls) {
        serialized += `${toolCall.function.name}: ${toolCall.function.arguments}\n`;
      }
    }

    if (message.role === 'tool') {
      serialized += `\n[Tool Result: ${message.name}]\n${message.content}`;
    }

    return serialized;
  }
}

