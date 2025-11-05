import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateFileReadStrategy } from '../DuplicateFileReadStrategy.js';
import { HotFileInclusionStrategy } from '../HotFileInclusionStrategy.js';
import type { CompressionContext } from '../../MessageCompressor.js';
import type { LLMMessage } from '../../../../types/llm.js';

describe('DuplicateFileReadStrategy', () => {
  let hotFileStrategy: HotFileInclusionStrategy;
  let duplicateReadStrategy: DuplicateFileReadStrategy;

  beforeEach(() => {
    hotFileStrategy = new HotFileInclusionStrategy('/test/app', {
      minReadCount: 1,
      minWriteCount: 1,
      recencyWindowMs: 10 * 60 * 1000,
    });
    duplicateReadStrategy = new DuplicateFileReadStrategy(hotFileStrategy);
  });

  describe('canCompress - hot files', () => {
    it('should compress ALL reads of hot files', () => {
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
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'File content...',
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
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_2',
          content: 'File content...',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const firstReadContext: CompressionContext = {
        messageIndex: 1,
        totalMessages: 4,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const secondReadContext: CompressionContext = {
        messageIndex: 3,
        totalMessages: 4,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(false);
    });

    it('should create hot file reference message', () => {
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
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'File content here',
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
                arguments: JSON.stringify({ path: 'src/hot.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_2',
          content: 'File content here',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 4,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const compressed = duplicateReadStrategy.compress(context);

      expect(compressed).not.toBeNull();
      expect(compressed?.content).toContain('src/hot.ts');
      expect(compressed?.content).toContain('included in hot files context');
      expect(compressed?.content).toContain('redundant read removed');
    });
  });

  describe('canCompress - duplicate detection', () => {
    it('should detect duplicate file reads (same content)', () => {
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
                arguments: JSON.stringify({ path: 'src/cold.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'export const value = 42;',
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
                arguments: JSON.stringify({ path: 'src/cold.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_2',
          content: 'export const value = 42;',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const firstReadContext: CompressionContext = {
        messageIndex: 1,
        totalMessages: 4,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const secondReadContext: CompressionContext = {
        messageIndex: 3,
        totalMessages: 4,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(false);
    });

    it('should NOT compress first read of non-hot file', () => {
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
                arguments: JSON.stringify({ path: 'src/unique.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'Unique content',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(context)).toBe(false);
    });

    it('should NOT compress reads with different content hashes', () => {
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
                arguments: JSON.stringify({ path: 'src/modified.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'const value = 1;',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({
                  path: 'src/modified.ts',
                  old_string: '1',
                  new_string: '2',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'fileEdit',
          tool_call_id: 'call_2',
          content: 'Edit successful',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/modified.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_3',
          content: 'const value = 2;',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const firstReadContext: CompressionContext = {
        messageIndex: 1,
        totalMessages: 6,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const secondReadContext: CompressionContext = {
        messageIndex: 5,
        totalMessages: 6,
        message: messages[5]!,
        previousMessage: messages[4],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(false);
    });
  });

  describe('compress - duplicate reads', () => {
    it('should create reference to previous read with line number', () => {
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
                arguments: JSON.stringify({ path: 'src/test.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'File content',
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
                arguments: JSON.stringify({ path: 'src/test.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_2',
          content: 'File content',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 3,
        totalMessages: 4,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: undefined,
      };

      const compressed = duplicateReadStrategy.compress(context);

      expect(compressed).not.toBeNull();
      expect(compressed?.content).toContain('src/test.ts');
      expect(compressed?.content).toContain('Duplicate file read removed');
      expect(compressed?.content).toMatch(/message #\d+/);
    });
  });

  describe('edge cases', () => {
    it('should handle non-tool messages', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Read the file',
        },
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 0,
        totalMessages: 1,
        message: messages[0]!,
        previousMessage: undefined,
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(context)).toBe(false);
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
                name: 'readFile',
                arguments: 'invalid json',
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'Error',
        },
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(context)).toBe(false);
    });

    it('should handle different path argument formats (file_path)', () => {
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
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'Content',
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
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_2',
          content: 'Content',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 3,
        totalMessages: 4,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(context)).toBe(true);

      const compressed = duplicateReadStrategy.compress(context);
      expect(compressed?.content).toContain('src/app.ts');
    });

    it('should handle messages without previousMessage', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'Some content',
        },
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 0,
        totalMessages: 1,
        message: messages[0]!,
        previousMessage: undefined,
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(context)).toBe(false);
    });

    it('should return null when compressing but no filePath found', () => {
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
                arguments: JSON.stringify({ unknown_field: 'value' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'Error',
        },
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      const compressed = duplicateReadStrategy.compress(context);
      expect(compressed).toBeNull();
    });
  });

  describe('integration with hot files', () => {
    it('should prioritize hot file removal over duplicate detection', () => {
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
          name: 'readFile',
          tool_call_id: 'call_1',
          content: 'Hot file content',
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
                arguments: JSON.stringify({ path: 'src/hot.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_2',
          content: 'Hot file content',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/cold.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_3',
          content: 'Cold file content',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_4',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/cold.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'readFile',
          tool_call_id: 'call_4',
          content: 'Cold file content',
        },
      ];

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const hotFirstRead: CompressionContext = {
        messageIndex: 1,
        totalMessages: 8,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const hotSecondRead: CompressionContext = {
        messageIndex: 3,
        totalMessages: 8,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: messages[4],
      };

      const coldFirstRead: CompressionContext = {
        messageIndex: 5,
        totalMessages: 8,
        message: messages[5]!,
        previousMessage: messages[4],
        nextMessage: messages[6],
      };

      const coldSecondRead: CompressionContext = {
        messageIndex: 7,
        totalMessages: 8,
        message: messages[7]!,
        previousMessage: messages[6],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(hotFirstRead)).toBe(true);
      expect(duplicateReadStrategy.canCompress(hotSecondRead)).toBe(false);
      expect(duplicateReadStrategy.canCompress(coldFirstRead)).toBe(true);
      expect(duplicateReadStrategy.canCompress(coldSecondRead)).toBe(false);

      const hotCompressed = duplicateReadStrategy.compress(hotFirstRead);
      const coldCompressed = duplicateReadStrategy.compress(coldSecondRead);

      expect(hotCompressed?.content).toContain('included in hot files context');
      expect(coldCompressed?.content).toContain('Duplicate file read removed');
      expect(coldCompressed?.content).toMatch(/message #\d+/);
    });
  });
});
