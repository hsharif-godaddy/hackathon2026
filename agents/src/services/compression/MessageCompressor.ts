import { type LLMMessage, isOpenAIMessage, getMessageContent } from '../ConversationHistoryLoader.js';
import { logger } from '../../logging/index.js';

/**
 * Context for compression decision-making
 */
export interface CompressionContext {
  messageIndex: number;
  totalMessages: number;
  message: LLMMessage;
  previousMessage: LLMMessage | undefined;
  nextMessage: LLMMessage | undefined;
}

/**
 * Result of compression operation
 */
export interface CompressionResult {
  compressed: boolean;
  originalLength: number;
  compressedLength: number;
  compressionRatio: number;
  strategy: string | undefined;
}

/**
 * Strategy type determines when the strategy runs:
 * - 'removal': Always runs - ensures correctness by removing stale/redundant data
 * - 'compression': Only runs when summarization is inactive - reduces token count
 */
export type CompressionStrategyType = 'removal' | 'compression';

/**
 * Base interface for compression strategies
 */
export interface CompressionStrategy {
  /**
   * Name of the strategy for logging/debugging
   */
  readonly name: string;

  /**
   * Type of strategy - determines when it runs relative to summarization
   * - 'removal': Always runs (correctness) - removes stale context, todoList entries, etc.
   * - 'compression': Only when no summarization (token savings) - compresses file edits, etc.
   * Defaults to 'compression' if not specified for backward compatibility.
   */
  readonly strategyType?: CompressionStrategyType;

  /**
   * Optional: Pre-analyze all messages before compression
   * Used for strategies that need to see the full context (e.g., detecting duplicates)
   */
  analyzeMessages?(messages: LLMMessage[]): void;

  /**
   * Check if this strategy can handle the given message
   */
  canCompress(context: CompressionContext): boolean;

  /**
   * Compress the message content
   * @returns Compressed message or null if no compression applied
   */
  compress(context: CompressionContext): LLMMessage | null;
}

/**
 * Orchestrates multiple compression strategies
 * Applies them in order until one succeeds or all are exhausted
 */
export class MessageCompressor {
  private strategies: CompressionStrategy[] = [];

  /**
   * Register a compression strategy
   */
  registerStrategy(strategy: CompressionStrategy): void {
    this.strategies.push(strategy);
    logger.debug('compression.strategy.registered', {
      strategyName: strategy.name,
      totalStrategies: this.strategies.length,
    });
  }

  /**
   * Compress a batch of LLM messages
   * @param messages - Array of LLM messages to compress
   * @param strategyTypeFilter - Optional filter to only run strategies of a specific type
   * @returns Compressed messages with compression statistics
   */
  compressMessages(messages: LLMMessage[], strategyTypeFilter?: CompressionStrategyType): {
    messages: LLMMessage[];
    stats: {
      totalMessages: number;
      compressedMessages: number;
      originalTotalLength: number;
      compressedTotalLength: number;
      compressionRatio: number;
      strategiesUsed: Record<string, number>;
    };
  } {
    // Filter strategies based on type if specified
    const activeStrategies = strategyTypeFilter
      ? this.strategies.filter(s => (s.strategyType || 'compression') === strategyTypeFilter)
      : this.strategies;

    logger.debug('compression.batch.begin', {
      totalMessages: messages.length,
      strategiesAvailable: activeStrategies.length,
      strategyTypeFilter: strategyTypeFilter || 'all',
    });

    // Phase 1: Allow strategies to analyze all messages
    for (const strategy of activeStrategies) {
      if (strategy.analyzeMessages) {
        logger.debug('compression.analysis.running', {
          strategyName: strategy.name,
        });
        strategy.analyzeMessages(messages);
      }
    }

    const compressedMessages: LLMMessage[] = [];
    const compressionResults: CompressionResult[] = [];
    const strategiesUsed: Record<string, number> = {};

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) {continue;}
      
      const context: CompressionContext = {
        messageIndex: i,
        totalMessages: messages.length,
        message,
        previousMessage: i > 0 ? messages[i - 1] : undefined,
        nextMessage: i < messages.length - 1 ? messages[i + 1] : undefined,
      };

      let compressed = false;
      let compressedMessage: LLMMessage | null = message;
      let usedStrategy: string | undefined;

      // CRITICAL: Never compress summary or operation log messages
      // Check metadata first, fall back to content prefix for backward compatibility
      const isSummary =
        (isOpenAIMessage(message) && message.metadata?.isSummary) ||
        (message.role === 'user' &&
         typeof message.content === 'string' &&
         message.content.startsWith('[CONVERSATION SUMMARY]'));

      const isOperationLog =
        (isOpenAIMessage(message) && message.metadata?.isOperationLog) ||
        (message.role === 'user' &&
         typeof message.content === 'string' &&
         message.content.startsWith('[OPERATION LOG'));

      if (isSummary || isOperationLog) {
        logger.debug('compression.message.skipped', {
          messageIndex: i,
          messageRole: message.role,
          reason: isSummary ? 'summary_message' : 'operation_log_message',
        });
      } else {
        for (const strategy of activeStrategies) {
          if (strategy.canCompress(context)) {
            const result = strategy.compress(context);
            if (result !== undefined) {
              // result can be a modified message or null (to remove the message)
              compressedMessage = result;
              compressed = true;
              usedStrategy = strategy.name;
              strategiesUsed[strategy.name] = (strategiesUsed[strategy.name] || 0) + 1;
              
              logger.debug('compression.message.compressed', {
                messageIndex: i,
                messageRole: message.role,
                strategy: strategy.name,
                originalLength: this.getMessageLength(message),
                compressedLength: result ? this.getMessageLength(result) : 0,
                removed: result === null,
              });
              
              break;
            }
          }
        }
      }

      if (!compressed) {
        logger.debug('compression.message.skipped', {
          messageIndex: i,
          messageRole: message.role,
          reason: 'no_applicable_strategy',
        });
      }

      // Only add message if it wasn't removed (null)
      if (compressedMessage !== null) {
        compressedMessages.push(compressedMessage);
      }

      compressionResults.push({
        compressed,
        originalLength: this.getMessageLength(message),
        compressedLength: compressedMessage ? this.getMessageLength(compressedMessage) : 0,
        compressionRatio: compressed
          ? (compressedMessage ? this.getMessageLength(compressedMessage) / this.getMessageLength(message) : 0)
          : 1.0,
        strategy: usedStrategy || undefined,
      });
    }

    const originalTotalLength = compressionResults.reduce((sum, r) => sum + r.originalLength, 0);
    const compressedTotalLength = compressionResults.reduce((sum, r) => sum + r.compressedLength, 0);
    const compressedCount = compressionResults.filter((r) => r.compressed).length;

    const stats = {
      totalMessages: messages.length,
      compressedMessages: compressedCount,
      originalTotalLength,
      compressedTotalLength,
      compressionRatio: compressedTotalLength / originalTotalLength,
      strategiesUsed,
    };

    logger.info('compression.batch.complete', {
      ...stats,
      savedBytes: originalTotalLength - compressedTotalLength,
    });

    return {
      messages: compressedMessages,
      stats,
    };
  }

  /**
   * Get the total length of a message for compression metrics
   */
  private getMessageLength(message: LLMMessage): number {
    let length = getMessageContent(message).length;

    if (isOpenAIMessage(message) && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        length += toolCall.function.name.length;
        length += toolCall.function.arguments.length;
      }
    }

    return length;
  }

  /**
   * Get list of registered strategies
   */
  getStrategies(): ReadonlyArray<CompressionStrategy> {
    return this.strategies;
  }

  /**
   * Clear all registered strategies
   */
  clearStrategies(): void {
    this.strategies = [];
  }
}
