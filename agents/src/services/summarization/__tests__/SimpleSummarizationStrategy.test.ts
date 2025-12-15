import { describe, it, expect } from 'vitest';
import { SimpleSummarizationStrategy } from '../SimpleSummarizationStrategy.js';
import type { SummarizationContext } from '../SummarizationStrategy.js';

describe('summarization', function summarizationTests() {
  describe('#SimpleSummarizationStrategy', function simpleStrategyTests() {
    it('should create summary from messages', async function create() {
      const strategy = new SimpleSummarizationStrategy();
      const context: SummarizationContext = {
        appId: 'test-app',
        messages: [
          { role: 'user', content: 'Hello, how are you?' },
          { role: 'assistant', content: 'I am doing well, thank you!' },
        ],
        messageRange: { startId: 'msg1', endId: 'msg2' },
        originalTokenCount: 100,
      };

      const result = await strategy.summarize(context);

      expect(result.summaryText).toContain('User:');
      expect(result.summaryText).toContain('Hello, how are you?');
      expect(result.summaryText).toContain('Assistant:');
      expect(result.summaryText).toContain('I am doing well');
      expect(result.messageRange.startId).toBe('msg1');
      expect(result.messageRange.endId).toBe('msg2');
      expect(result.messageCount).toBe(2);
      expect(result.originalTokenCount).toBe(100);
      expect(result.summaryTokenCount).toBeGreaterThan(0);
      expect(result.modelUsed).toBe('claude-3-5-sonnet');
    });

    it('should handle incremental summarization', async function incremental() {
      const strategy = new SimpleSummarizationStrategy();
      const context: SummarizationContext = {
        appId: 'test-app',
        messages: [
          { role: 'user', content: 'New message' },
        ],
        existingSummary: 'Previous summary',
        messageRange: { startId: 'msg3', endId: 'msg3' },
        originalTokenCount: 50,
      };

      const result = await strategy.summarize(context);

      expect(result.summaryText).toContain('Previous summary');
      expect(result.summaryText).toContain('--- New Messages ---');
      expect(result.summaryText).toContain('New message');
    });

    it('should handle tool calls in messages', async function toolCalls() {
      const strategy = new SimpleSummarizationStrategy();
      const context: SummarizationContext = {
        appId: 'test-app',
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: { name: 'readFile', arguments: '{"path": "test.js"}' },
              },
            ],
          },
          {
            role: 'tool',
            content: 'File content',
            tool_call_id: 'call1',
            name: 'readFile',
          },
        ],
        messageRange: { startId: 'msg1', endId: 'msg2' },
        originalTokenCount: 80,
      };

      const result = await strategy.summarize(context);

      expect(result.summaryText).toContain('readFile');
      expect(result.summaryText).toContain('Tool result:');
    });
  });
});

