import { describe, it, expect } from 'vitest';
import { TodoListRemovalStrategy } from '../TodoListRemovalStrategy.js';
import type { CompressionContext } from '../../MessageCompressor.js';
import type { LLMMessage } from '../../../ConversationHistoryLoader.js';
import type { ToolModelMessage } from 'ai';

describe('TodoListRemovalStrategy', () => {
  const strategy = new TodoListRemovalStrategy();

  describe('canCompress', () => {
    describe('AI SDK v6 format (tool result)', () => {
      it('should return true for todoList tool result', () => {
        const message = {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'todoList',
            output: { type: 'text', value: '{"success": true}' }
          }]
        } as ToolModelMessage;

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(true);
      });

      it('should return false for non-todoList tool result', () => {
        const message = {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'readFile',
            output: { type: 'text', value: 'file content' }
          }]
        } as ToolModelMessage;

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(false);
      });
    });

    describe('OpenAI format (from convertToLLMMessages)', () => {
      it('should return true for todoList tool result in OpenAI format', () => {
        const message: LLMMessage = {
          role: 'tool',
          content: '{"success": true}',
          tool_call_id: 'call_1',
          name: 'todoList',
        };

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(true);
      });

      it('should return false for non-todoList tool result in OpenAI format', () => {
        const message: LLMMessage = {
          role: 'tool',
          content: 'file content',
          tool_call_id: 'call_1',
          name: 'readFile',
        };

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(false);
      });
    });

    describe('assistant messages with tool calls', () => {
      it('should return true for assistant message with todoList tool call', () => {
        const message: LLMMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'todoList',
                arguments: '{"operation": "add"}',
              },
            },
          ],
        };

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(true);
      });

      it('should return false for assistant message without todoList tool call', () => {
        const message: LLMMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: '{"path": "test.ts"}',
              },
            },
          ],
        };

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(false);
      });
    });

    describe('other message types', () => {
      it('should return false for user messages', () => {
        const message: LLMMessage = {
          role: 'user',
          content: 'Hello',
        };

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(false);
      });

      it('should return false for assistant messages without tool calls', () => {
        const message: LLMMessage = {
          role: 'assistant',
          content: 'I will help you with that.',
        };

        const context: CompressionContext = {
          message,
          messageIndex: 0,
        };

        expect(strategy.canCompress(context)).toBe(false);
      });
    });
  });

  describe('compress', () => {
    it('should return null to remove the message', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: '{"success": true}',
        tool_call_id: 'call_1',
        name: 'todoList',
      };

      const context: CompressionContext = {
        message,
        messageIndex: 0,
      };

      expect(strategy.compress(context)).toBeNull();
    });
  });
});
