import { describe, it, expect, beforeEach } from 'vitest';
import { FileEditCompressionStrategy } from '../FileEditCompressionStrategy.js';
import { HotFileInclusionStrategy } from '../HotFileInclusionStrategy.js';
import type { CompressionContext } from '../../MessageCompressor.js';
import type { LLMMessage } from '../../../../types/llm.js';
import type { ToolModelMessage } from 'ai';

describe('FileEditCompressionStrategy', () => {
  let hotFileStrategy: HotFileInclusionStrategy;
  let fileEditStrategy: FileEditCompressionStrategy;

  beforeEach(() => {
    hotFileStrategy = new HotFileInclusionStrategy('/test/app', {
      minReadCount: 2,
      minWriteCount: 2,
      recencyWindowMs: 10 * 60 * 1000,
    });
    fileEditStrategy = new FileEditCompressionStrategy(hotFileStrategy);
  });

  describe('canCompress', () => {
    it('should return true for fileEdit tool calls on hot files', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/index.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'readFile',
            output: { type: 'text', value: 'file content' }
          }]
        } as ToolModelMessage,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/index.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_2',
            toolName: 'readFile',
            output: { type: 'text', value: 'file content' }
          }]
        } as ToolModelMessage,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  path: 'src/index.ts',
                  old_string: 'old',
                  new_string: 'new',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_3',
          toolName: 'fileEdit',
          output: { type: 'text', value: 'File edited successfully' }
        }]
      } as ToolModelMessage,
      ];

      hotFileStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 5,
        totalMessages: 6,
        message: messages[5]!,
        previousMessage: messages[4],
        nextMessage: undefined,
      };

      expect(fileEditStrategy.canCompress(context)).toBe(true);
    });

    it('should return false for fileEdit tool calls on non-hot files', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  path: 'src/rarely-edited.ts',
                  old_string: 'old',
                  new_string: 'new',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'fileEdit',
          output: { type: 'text', value: 'File edited successfully' }
        }]
      } as ToolModelMessage,
      ];

      hotFileStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      expect(fileEditStrategy.canCompress(context)).toBe(false);
    });

    it('should return false for non-tool messages', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Please edit the file',
        },
      ];

      const context: CompressionContext = {
        messageIndex: 0,
        totalMessages: 1,
        message: messages[0]!,
        previousMessage: undefined,
        nextMessage: undefined,
      };

      expect(fileEditStrategy.canCompress(context)).toBe(false);
    });

    it('should return false when previousMessage is not a fileEdit tool call', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/index.ts' }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'readFile',
          result: 'File content here'
        }]
      } as ToolModelMessage,
      ];

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      expect(fileEditStrategy.canCompress(context)).toBe(false);
    });

    it('should handle invalid JSON in tool call arguments', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: 'invalid json',
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'fileEdit',
          result: 'Error'
        }]
      } as ToolModelMessage,
      ];

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      expect(fileEditStrategy.canCompress(context)).toBe(false);
    });
  });

  describe('compress', () => {
    it('should create summary message for hot file edits', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/index.ts' }),
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/index.ts' }),
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  path: 'src/index.ts',
                  old_string: 'old code',
                  new_string: 'new code',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_3',
          toolName: 'fileEdit',
          result: 'Successfully edited src/index.ts'
        }]
      } as ToolModelMessage,
      ];

      hotFileStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 3,
        totalMessages: 4,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: undefined,
      };

      const compressed = fileEditStrategy.compress(context);

      expect(compressed).not.toBeNull();
      expect(compressed?.content).toContain('File edited: src/index.ts');
      expect(compressed?.content).toContain('[Full file content available in hot files context]');
    });

    it('should handle different argument formats (file_path)', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ file_path: 'src/app.ts' }),
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ file_path: 'src/app.ts' }),
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  file_path: 'src/app.ts',
                  old_string: 'old',
                  new_string: 'new',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_3',
          toolName: 'fileEdit',
          result: 'Edit successful'
        }]
      } as ToolModelMessage,
      ];

      hotFileStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 3,
        totalMessages: 4,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: undefined,
      };

      const compressed = fileEditStrategy.compress(context);

      expect(compressed).not.toBeNull();
      expect(compressed?.content).toContain('src/app.ts');
    });

    it('should return null if no valid filePath found', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  old_string: 'old',
                  new_string: 'new',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'fileEdit',
          result: 'Error'
        }]
      } as ToolModelMessage,
      ];

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      const compressed = fileEditStrategy.compress(context);

      expect(compressed).toBeNull();
    });
  });

  describe('integration with hot files', () => {
    it('should only compress edits to files identified as hot', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/hot.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'readFile',
            output: { type: 'text', value: 'file content' }
          }]
        } as ToolModelMessage,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/hot.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_2',
            toolName: 'readFile',
            output: { type: 'text', value: 'file content' }
          }]
        } as ToolModelMessage,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  path: 'src/hot.ts',
                  old_string: 'old',
                  new_string: 'new',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_3',
          toolName: 'fileEdit',
          output: { type: 'text', value: 'Edit successful' }
        }]
      } as ToolModelMessage,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_4',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  path: 'src/cold.ts',
                  old_string: 'old',
                  new_string: 'new',
                }),
              },
            },
          ],
        },
        {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_4',
          toolName: 'fileEdit',
          output: { type: 'text', value: 'Edit successful' }
        }]
      } as ToolModelMessage,
      ];

      hotFileStrategy.analyzeMessages(messages);

      const hotEditContext: CompressionContext = {
        messageIndex: 5,
        totalMessages: 8,
        message: messages[5]!,
        previousMessage: messages[4],
        nextMessage: messages[6],
      };

      const coldEditContext: CompressionContext = {
        messageIndex: 7,
        totalMessages: 8,
        message: messages[7]!,
        previousMessage: messages[6],
        nextMessage: undefined,
      };

      expect(fileEditStrategy.canCompress(hotEditContext)).toBe(true);
      expect(fileEditStrategy.canCompress(coldEditContext)).toBe(false);

      const hotCompressed = fileEditStrategy.compress(hotEditContext);
      const coldCompressed = fileEditStrategy.compress(coldEditContext);

      expect(hotCompressed).not.toBeNull();
      expect(hotCompressed?.content).toContain('src/hot.ts');
      expect(coldCompressed).toBeNull();
    });
  });
});
