import { describe, it, expect } from 'vitest';
import { MediaSearchSummaryStrategy } from '../MediaSearchSummaryStrategy.js';
import type { CompressionContext } from '../../MessageCompressor.js';
import type { LLMMessage, OpenAIMessage, AIToolMessage } from '../../../ConversationHistoryLoader.js';

describe('MediaSearchSummaryStrategy', () => {
  const strategy = new MediaSearchSummaryStrategy();

  function createContext(message: LLMMessage, index = 0): CompressionContext {
    return {
      messageIndex: index,
      totalMessages: 1,
      message,
      previousMessage: undefined,
      nextMessage: undefined,
    };
  }

  describe('canCompress', () => {
    describe('AI SDK v6 format (tool result)', () => {
      it('should match mediaSearch tool result', () => {
        const message: AIToolMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_123',
              toolName: 'mediaSearch',
              output: { type: 'text', value: '{"success":true}' },
            },
          ],
        };
        expect(strategy.canCompress(createContext(message))).toBe(true);
      });

      it('should not match other tools', () => {
        const message: AIToolMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_123',
              toolName: 'media',
              output: { type: 'text', value: '{"success":true}' },
            },
          ],
        };
        expect(strategy.canCompress(createContext(message))).toBe(false);
      });
    });

    describe('OpenAI format (tool result)', () => {
      it('should match mediaSearch tool result', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: '{"success":true}',
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        expect(strategy.canCompress(createContext(message))).toBe(true);
      });

      it('should not match other tools', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: '{"success":true}',
          tool_call_id: 'call_123',
          name: 'media',
        };
        expect(strategy.canCompress(createContext(message))).toBe(false);
      });
    });

    describe('assistant message with tool calls', () => {
      it('should match messages with mediaSearch tool calls', () => {
        const message: OpenAIMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'mediaSearch',
                arguments: '{"prompt":"sunset"}',
              },
            },
          ],
        };
        expect(strategy.canCompress(createContext(message))).toBe(true);
      });

      it('should match messages with mixed tool calls including mediaSearch', () => {
        const message: OpenAIMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'mediaSearch',
                arguments: '{"prompt":"sunset"}',
              },
            },
            {
              id: 'call_456',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: '{}',
              },
            },
          ],
        };
        expect(strategy.canCompress(createContext(message))).toBe(true);
      });

      it('should not match messages without mediaSearch tool calls', () => {
        const message: OpenAIMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: '{}',
              },
            },
          ],
        };
        expect(strategy.canCompress(createContext(message))).toBe(false);
      });
    });

    it('should not match regular user messages', () => {
      const message: OpenAIMessage = {
        role: 'user',
        content: 'Find me an image of a sunset',
      };
      expect(strategy.canCompress(createContext(message))).toBe(false);
    });

    it('should not match regular assistant messages', () => {
      const message: OpenAIMessage = {
        role: 'assistant',
        content: 'I found some images for you',
      };
      expect(strategy.canCompress(createContext(message))).toBe(false);
    });
  });

  describe('compress', () => {
    describe('assistant messages with tool calls', () => {
      it('should remove assistant message with only mediaSearch tool call', () => {
        const message: OpenAIMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'mediaSearch',
                arguments: '{"prompt":"sunset"}',
              },
            },
          ],
        };
        expect(strategy.compress(createContext(message))).toBeNull();
      });

      it('should filter out mediaSearch from mixed tool calls', () => {
        const message: OpenAIMessage = {
          role: 'assistant',
          content: 'I will search for an image and edit a file',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'mediaSearch',
                arguments: '{"prompt":"sunset"}',
              },
            },
            {
              id: 'call_456',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: '{}',
              },
            },
          ],
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.tool_calls).toHaveLength(1);
        expect(result.tool_calls![0].function.name).toBe('fileEdit');
      });
    });

    describe('tool result messages - OpenAI format', () => {
      it('should transform successful mediaSearch result to summary', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            prompt: 'sunset over ocean',
            urls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.role).toBe('assistant');
        expect(result.content).toBe(
          '[Previously searched for image(s): "sunset over ocean" - found 2 result(s)]'
        );
      });

      it('should handle single url result', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            prompt: 'sunset',
            url: 'https://example.com/img1.jpg',
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.role).toBe('assistant');
        expect(result.content).toBe('[Previously searched for image(s): "sunset" - found 1 result(s)]');
      });

      it('should handle array of prompts (parallel search)', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            prompt: ['sunset', 'mountains', 'beach'],
            urls: ['url1', 'url2', 'url3'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe(
          '[Previously searched for image(s): "sunset, mountains, beach" - found 3 result(s)]'
        );
      });

      it('should handle video searches', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'video',
            prompt: 'ocean waves',
            urls: ['https://example.com/video.mp4'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe('[Previously searched for video(s): "ocean waves" - found 1 result(s)]');
      });

      it('should return null for failed searches', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: false,
            error: 'No images found',
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        expect(strategy.compress(createContext(message))).toBeNull();
      });

      it('should return null for results with no URLs', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            prompt: 'sunset',
            urls: [],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        expect(strategy.compress(createContext(message))).toBeNull();
      });

      it('should return null for invalid JSON', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: 'not valid json',
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        expect(strategy.compress(createContext(message))).toBeNull();
      });
    });

    describe('tool result messages - AI SDK v6 format', () => {
      it('should transform successful mediaSearch result to summary', () => {
        const message: AIToolMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_123',
              toolName: 'mediaSearch',
              output: {
                type: 'text',
                value: JSON.stringify({
                  success: true,
                  mediaType: 'image',
                  prompt: 'sunset',
                  urls: ['url1', 'url2'],
                }),
              },
            },
          ],
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.role).toBe('assistant');
        expect(result.content).toBe('[Previously searched for image(s): "sunset" - found 2 result(s)]');
      });

      it('should handle string output format', () => {
        const message: AIToolMessage = {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_123',
              toolName: 'mediaSearch',
              output: JSON.stringify({
                success: true,
                prompt: 'beach',
                urls: ['url1'],
              }),
            },
          ],
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe('[Previously searched for media(s): "beach" - found 1 result(s)]');
      });
    });

    describe('parallel search with results array', () => {
      it('should handle parallel search results array format', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            prompt: ['sunset', 'beach', 'mountains'],
            results: [
              { prompt: 'sunset', success: true, urls: ['url1', 'url2'] },
              { prompt: 'beach', success: true, url: 'url3' },
              { prompt: 'mountains', success: true, urls: ['url4'] },
            ],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe(
          '[Previously searched for image(s): "sunset, beach, mountains" - found 4 result(s)]'
        );
      });

      it('should derive prompts from results array when top-level prompt is missing', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            results: [
              { prompt: 'sunset', success: true, urls: ['url1'] },
              { prompt: 'beach', success: true, urls: ['url2'] },
            ],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe(
          '[Previously searched for image(s): "sunset, beach" - found 2 result(s)]'
        );
      });

      it('should count all URLs from results array', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            results: [
              { prompt: 'a', success: true, urls: ['url1', 'url2', 'url3'] },
              { prompt: 'b', success: true, urls: ['url4', 'url5'] },
            ],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toContain('found 5 result(s)');
      });
    });

    describe('graceful fallbacks', () => {
      it('should use "media" when mediaType is missing', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            prompt: 'sunset',
            urls: ['url1'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe('[Previously searched for media(s): "sunset" - found 1 result(s)]');
      });

      it('should omit prompt from summary when prompt is missing', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            urls: ['url1', 'url2'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe('[Previously searched for image(s) - found 2 result(s)]');
      });

      it('should handle empty string mediaType', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: '',
            prompt: 'test',
            urls: ['url1'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe('[Previously searched for media(s): "test" - found 1 result(s)]');
      });

      it('should handle whitespace-only prompt', () => {
        const message: OpenAIMessage = {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            mediaType: 'image',
            prompt: '   ',
            urls: ['url1'],
          }),
          tool_call_id: 'call_123',
          name: 'mediaSearch',
        };
        const result = strategy.compress(createContext(message)) as OpenAIMessage;
        expect(result).not.toBeNull();
        expect(result.content).toBe('[Previously searched for image(s) - found 1 result(s)]');
      });
    });
  });

  describe('strategyType', () => {
    it('should be removal type (always runs for correctness)', () => {
      expect(strategy.strategyType).toBe('removal');
    });
  });
});
