import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateFileReadStrategy } from '../DuplicateFileReadStrategy.js';
import type { CompressionContext } from '../../MessageCompressor.js';
import { type LLMMessage, getMessageContent } from '../../../ConversationHistoryLoader.js';
import type { ToolModelMessage } from 'ai';

// Helper to create AI SDK v6 tool messages
function createToolMessage(toolCallId: string, toolName: string, content: string): LLMMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId,
      toolName,
      output: { type: 'text', value: content }
    }]
  } as ToolModelMessage;
}

describe('DuplicateFileReadStrategy', () => {
  let duplicateReadStrategy: DuplicateFileReadStrategy;

  beforeEach(() => {
    duplicateReadStrategy = new DuplicateFileReadStrategy();
  });

  describe('canCompress - duplicate detection', () => {
    it('should detect duplicate file reads and compress older ones', () => {
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
        createToolMessage('call_1', 'readFile', 'File content...'),
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
        createToolMessage('call_2', 'readFile', 'File content...'),
      ];

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

      // First read should be compressed (older), second read should be kept (most recent)
      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(false);
    });

    it('should not compress single reads', () => {
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
        createToolMessage('call_1', 'readFile', 'Unique content'),
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      // Single read should not be compressed
      expect(duplicateReadStrategy.canCompress(context)).toBe(false);
    });

    it('should compress older reads even with different content', () => {
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
        createToolMessage('call_1', 'readFile', 'const value = 1;'),
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
        createToolMessage('call_2', 'fileEdit', 'Edit successful'),
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
        createToolMessage('call_3', 'readFile', 'const value = 2;'),
      ];

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

      // First read should be compressed (older), second read should be kept (most recent)
      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(false);
    });
  });

  describe('compress - duplicate reads', () => {
    it('should create reference to most recent read with message number', () => {
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
        createToolMessage('call_1', 'readFile', 'File content'),
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
        createToolMessage('call_2', 'readFile', 'File content'),
      ];

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
      const content = getMessageContent(compressed!);
      expect(content).toContain('src/test.ts');
      expect(content).toContain('Repeated file read removed');
      expect(content).toContain('later in the conversation');
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
        createToolMessage('call_1', 'readFile', 'Error'),
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
        createToolMessage('call_1', 'readFile', 'Content'),
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
        createToolMessage('call_2', 'readFile', 'Content'),
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 4,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      expect(duplicateReadStrategy.canCompress(context)).toBe(true);

      const compressed = duplicateReadStrategy.compress(context);
      const content = getMessageContent(compressed!);
      expect(content).toContain('src/app.ts');
    });

    it('should handle messages without previousMessage', () => {
      const messages: LLMMessage[] = [
        createToolMessage('call_1', 'readFile', 'Some content'),
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
        createToolMessage('call_1', 'readFile', 'Error'),
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

  describe('multiple files', () => {
    it('should track duplicates for multiple different files independently', () => {
      const messages: LLMMessage[] = [
        // First read of file1
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/file1.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_1', 'readFile', 'File 1 content'),
        // First read of file2
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/file2.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_2', 'readFile', 'File 2 content'),
        // Second read of file1
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/file1.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_3', 'readFile', 'File 1 content'),
        // Second read of file2
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_4',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/file2.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_4', 'readFile', 'File 2 content'),
      ];

      duplicateReadStrategy.analyzeMessages(messages);

      // First read of file1 (index 1) - should be compressed
      const file1FirstRead: CompressionContext = {
        messageIndex: 1,
        totalMessages: 8,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      // First read of file2 (index 3) - should be compressed
      const file2FirstRead: CompressionContext = {
        messageIndex: 3,
        totalMessages: 8,
        message: messages[3]!,
        previousMessage: messages[2],
        nextMessage: messages[4],
      };

      // Second read of file1 (index 5) - should NOT be compressed (most recent)
      const file1SecondRead: CompressionContext = {
        messageIndex: 5,
        totalMessages: 8,
        message: messages[5]!,
        previousMessage: messages[4],
        nextMessage: messages[6],
      };

      // Second read of file2 (index 7) - should NOT be compressed (most recent)
      const file2SecondRead: CompressionContext = {
        messageIndex: 7,
        totalMessages: 8,
        message: messages[7]!,
        previousMessage: messages[6],
        nextMessage: undefined,
      };

      expect(duplicateReadStrategy.canCompress(file1FirstRead)).toBe(true);
      expect(duplicateReadStrategy.canCompress(file2FirstRead)).toBe(true);
      expect(duplicateReadStrategy.canCompress(file1SecondRead)).toBe(false);
      expect(duplicateReadStrategy.canCompress(file2SecondRead)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
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
                arguments: JSON.stringify({ path: 'src/file1.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_1', 'readFile', 'Content 1'),
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/file1.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_2', 'readFile', 'Content 1'),
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/file2.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_3', 'readFile', 'Content 2'),
      ];

      duplicateReadStrategy.analyzeMessages(messages);
      const stats = duplicateReadStrategy.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.filesWithDuplicates).toBe(1); // file1.ts has duplicates
      expect(stats.totalReads).toBe(3);
      expect(stats.duplicateReads).toBe(1); // one duplicate of file1.ts
    });
  });

  describe('clear', () => {
    it('should clear internal state', () => {
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
                arguments: JSON.stringify({ path: 'src/file.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_1', 'readFile', 'Content'),
      ];

      duplicateReadStrategy.analyzeMessages(messages);
      let stats = duplicateReadStrategy.getStats();
      expect(stats.totalFiles).toBe(1);

      duplicateReadStrategy.clear();
      stats = duplicateReadStrategy.getStats();
      expect(stats.totalFiles).toBe(0);
    });
  });
});
