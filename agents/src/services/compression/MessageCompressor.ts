import type { LLMMessage } from '../ConversationHistoryLoader.js';
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
 * Base interface for compression strategies
 */
export interface CompressionStrategy {
  /**
   * Name of the strategy for logging/debugging
   */
  readonly name: string;

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
   * @returns Compressed messages with compression statistics
   */
  compressMessages(messages: LLMMessage[]): {
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
    logger.debug('compression.batch.begin', {
      totalMessages: messages.length,
      strategiesAvailable: this.strategies.length,
    });

    // Phase 1: Allow strategies to analyze all messages
    for (const strategy of this.strategies) {
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
      if (!message) continue;
      
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

      // CRITICAL: Never compress summary messages
      // Summaries are identified by the [CONVERSATION SUMMARY] prefix
      const isSummary = message.role === 'user' && 
                        typeof message.content === 'string' && 
                        message.content.startsWith('[CONVERSATION SUMMARY]');

      if (isSummary) {
        logger.debug('compression.message.skipped', {
          messageIndex: i,
          messageRole: message.role,
          reason: 'summary_message',
        });
      } else {
        for (const strategy of this.strategies) {
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
    let length = message.content?.length || 0;

    if (message.tool_calls) {
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
