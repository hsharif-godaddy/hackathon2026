import { describe, it, expect, beforeEach } from 'vitest';
import { MessageCompressor } from '../compression/MessageCompressor.js';
import type { CompressionStrategy, CompressionContext } from '../compression/MessageCompressor.js';
import type { LLMMessage } from '../ConversationHistoryLoader.js';

// Simple test strategy that compresses messages with "COMPRESS_ME" in content
class TestCompressionStrategy implements CompressionStrategy {
  readonly name = 'test-strategy';

  canCompress(context: CompressionContext): boolean {
    return context.message.content?.includes('COMPRESS_ME') || false;
  }

  compress(context: CompressionContext): LLMMessage | null {
    if (!context.message.content) return null;
    
    return {
      ...context.message,
      content: '[COMPRESSED]',
    };
  }
}

describe('MessageCompressor', () => {
  let compressor: MessageCompressor;

  beforeEach(() => {
    compressor = new MessageCompressor();
  });

  describe('registerStrategy', () => {
    it('should register a compression strategy', () => {
      const strategy = new TestCompressionStrategy();
      compressor.registerStrategy(strategy);

      expect(compressor.getStrategies()).toHaveLength(1);
      expect(compressor.getStrategies()[0]).toBe(strategy);
    });

    it('should allow multiple strategies', () => {
      compressor.registerStrategy(new TestCompressionStrategy());
      compressor.registerStrategy(new TestCompressionStrategy());

      expect(compressor.getStrategies()).toHaveLength(2);
    });
  });

  describe('compressMessages', () => {
    it('should compress messages that match strategy', () => {
      compressor.registerStrategy(new TestCompressionStrategy());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Normal message' },
        { role: 'assistant', content: 'COMPRESS_ME - this should be compressed' },
        { role: 'user', content: 'Another normal message' },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toBe('Normal message');
      expect(result.messages[1].content).toBe('[COMPRESSED]');
      expect(result.messages[2].content).toBe('Another normal message');
      expect(result.stats.compressedMessages).toBe(1);
    });

    it('should not compress messages without matching strategy', () => {
      compressor.registerStrategy(new TestCompressionStrategy());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Normal message 1' },
        { role: 'assistant', content: 'Normal message 2' },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Normal message 1');
      expect(result.messages[1].content).toBe('Normal message 2');
      expect(result.stats.compressedMessages).toBe(0);
    });

    it('should calculate compression statistics', () => {
      compressor.registerStrategy(new TestCompressionStrategy());

      const longText = 'COMPRESS_ME ' + 'x'.repeat(1000);
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Short' },
        { role: 'assistant', content: longText },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.stats.totalMessages).toBe(2);
      expect(result.stats.compressedMessages).toBe(1);
      expect(result.stats.originalTotalLength).toBeGreaterThan(result.stats.compressedTotalLength);
      expect(result.stats.compressionRatio).toBeLessThan(1);
    });

    it('should track which strategies were used', () => {
      compressor.registerStrategy(new TestCompressionStrategy());

      const messages: LLMMessage[] = [
        { role: 'assistant', content: 'COMPRESS_ME 1' },
        { role: 'assistant', content: 'COMPRESS_ME 2' },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.stats.strategiesUsed).toHaveProperty('test-strategy', 2);
    });

    it('should handle empty message array', () => {
      compressor.registerStrategy(new TestCompressionStrategy());

      const result = compressor.compressMessages([]);

      expect(result.messages).toHaveLength(0);
      expect(result.stats.totalMessages).toBe(0);
      expect(result.stats.compressedMessages).toBe(0);
    });

    it('should apply first matching strategy only', () => {
      class Strategy1 implements CompressionStrategy {
        readonly name = 'strategy-1';
        canCompress(context: CompressionContext): boolean {
          return true;
        }
        compress(context: CompressionContext): LLMMessage | null {
          return { ...context.message, content: '[STRATEGY-1]' };
        }
      }

      class Strategy2 implements CompressionStrategy {
        readonly name = 'strategy-2';
        canCompress(context: CompressionContext): boolean {
          return true;
        }
        compress(context: CompressionContext): LLMMessage | null {
          return { ...context.message, content: '[STRATEGY-2]' };
        }
      }

      compressor.registerStrategy(new Strategy1());
      compressor.registerStrategy(new Strategy2());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.messages[0].content).toBe('[STRATEGY-1]');
      expect(result.stats.strategiesUsed).toHaveProperty('strategy-1', 1);
      expect(result.stats.strategiesUsed).not.toHaveProperty('strategy-2');
    });

    it('should provide context to strategies', () => {
      let capturedContext: CompressionContext | null = null;

      class ContextCapturingStrategy implements CompressionStrategy {
        readonly name = 'context-capturer';
        canCompress(context: CompressionContext): boolean {
          capturedContext = context;
          return true;
        }
        compress(context: CompressionContext): LLMMessage | null {
          return null;
        }
      }

      compressor.registerStrategy(new ContextCapturingStrategy());

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Message 2' },
        { role: 'user', content: 'Message 3' },
      ];

      compressor.compressMessages(messages);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext?.messageIndex).toBeGreaterThanOrEqual(0);
      expect(capturedContext?.totalMessages).toBe(3);
      expect(capturedContext?.message).toBeDefined();
    });
  });

  describe('clearStrategies', () => {
    it('should remove all strategies', () => {
      compressor.registerStrategy(new TestCompressionStrategy());
      compressor.registerStrategy(new TestCompressionStrategy());

      expect(compressor.getStrategies()).toHaveLength(2);

      compressor.clearStrategies();

      expect(compressor.getStrategies()).toHaveLength(0);
    });
  });
});
