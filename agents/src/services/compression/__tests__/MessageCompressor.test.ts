import { describe, it, expect } from 'vitest';
import { MessageCompressor, type CompressionStrategy, type CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage, OpenAIMessage } from '../../ConversationHistoryLoader.js';

function userMsg(content: string): OpenAIMessage {
  return { role: 'user', content };
}

function toolMsg(content: string, toolCallId: string, name: string): OpenAIMessage {
  return { role: 'tool', content, tool_call_id: toolCallId, name };
}

/** Strategy that mutates content (like ToolResultCompressionStrategy) */
class MutatingStrategy implements CompressionStrategy {
  readonly name = 'test-mutating';
  readonly strategyType = 'removal' as const;
  readonly mutatesContent = true;

  canCompress(ctx: CompressionContext): boolean {
    const msg = ctx.message as OpenAIMessage;
    return msg.role === 'tool' && typeof msg.content === 'string' && msg.content !== '[compressed]';
  }

  compress(ctx: CompressionContext): LLMMessage | null {
    const msg = ctx.message as OpenAIMessage;
    return { ...msg, content: '[compressed]' };
  }
}

/** Strategy that removes messages entirely (like AppContextRemovalStrategy) */
class RemovingStrategy implements CompressionStrategy {
  readonly name = 'test-removing';
  readonly strategyType = 'removal' as const;
  // mutatesContent defaults to undefined/false

  canCompress(ctx: CompressionContext): boolean {
    const msg = ctx.message as OpenAIMessage;
    return msg.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('[STALE]');
  }

  compress(): LLMMessage | null {
    return null; // Remove the message
  }
}

describe('MessageCompressor stableRegionEnd', () => {
  it('should skip mutation strategies for messages in stable region', () => {
    const compressor = new MessageCompressor();
    compressor.registerStrategy(new MutatingStrategy());

    const messages: LLMMessage[] = [
      toolMsg('original-1', 'tc1', 'editFile'),
      toolMsg('original-2', 'tc2', 'editFile'),
      toolMsg('original-3', 'tc3', 'editFile'),
    ];

    // stableRegionEnd=2: first two messages are in stable region
    const result = compressor.compressMessages(messages, undefined, 2);

    expect((result.messages[0] as OpenAIMessage).content).toBe('original-1');
    expect((result.messages[1] as OpenAIMessage).content).toBe('original-2');
    expect((result.messages[2] as OpenAIMessage).content).toBe('[compressed]');
  });

  it('should still run removal strategies in stable region', () => {
    const compressor = new MessageCompressor();
    compressor.registerStrategy(new RemovingStrategy());

    const messages: LLMMessage[] = [
      userMsg('[STALE] old context'),
      userMsg('normal message'),
      userMsg('[STALE] more old context'),
    ];

    // stableRegionEnd=2: first two messages in stable region
    const result = compressor.compressMessages(messages, undefined, 2);

    // Removal strategy should still remove [STALE] messages even in stable region
    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as OpenAIMessage).content).toBe('normal message');
  });

  it('should compress all messages when stableRegionEnd is undefined', () => {
    const compressor = new MessageCompressor();
    compressor.registerStrategy(new MutatingStrategy());

    const messages: LLMMessage[] = [
      toolMsg('original-1', 'tc1', 'editFile'),
      toolMsg('original-2', 'tc2', 'editFile'),
    ];

    const result = compressor.compressMessages(messages);

    expect((result.messages[0] as OpenAIMessage).content).toBe('[compressed]');
    expect((result.messages[1] as OpenAIMessage).content).toBe('[compressed]');
  });

  it('should compress all messages when stableRegionEnd is 0', () => {
    const compressor = new MessageCompressor();
    compressor.registerStrategy(new MutatingStrategy());

    const messages: LLMMessage[] = [
      toolMsg('original-1', 'tc1', 'editFile'),
    ];

    const result = compressor.compressMessages(messages, undefined, 0);

    expect((result.messages[0] as OpenAIMessage).content).toBe('[compressed]');
  });
});
