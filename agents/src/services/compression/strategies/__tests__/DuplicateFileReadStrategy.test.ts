import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateFileReadStrategy } from '../DuplicateFileReadStrategy.js';
import { HotFileInclusionStrategy } from '../HotFileInclusionStrategy.js';
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

      // BOTH reads should be compressed since the file is hot (already in hot files context)
      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(true);
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
        createToolMessage('call_1', 'readFile', 'File content here'),
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
        createToolMessage('call_2', 'readFile', 'File content here'),
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
      const content = getMessageContent(compressed!);
      expect(content).toContain('src/hot.ts');
      expect(content).toContain('included in hot files context');
      expect(content).toContain('redundant read removed');
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
        createToolMessage('call_1', 'readFile', 'export const value = 42;'),
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
        createToolMessage('call_2', 'readFile', 'export const value = 42;'),
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

      // BOTH reads should be compressed since the file is hot (already in hot files context)
      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(true);
    });

    it('should compress single read of hot file', () => {
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

      hotFileStrategy.analyzeMessages(messages);
      duplicateReadStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 2,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: undefined,
      };

      // File becomes hot after single read (minReadCount: 1), so it should be compressed
      expect(duplicateReadStrategy.canCompress(context)).toBe(true);
    });

    it('should compress reads of hot files with different content hashes', () => {
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

      // BOTH reads should be compressed since the file is hot (already in hot files context)
      // Hot files are compressed regardless of content hash differences
      expect(duplicateReadStrategy.canCompress(firstReadContext)).toBe(true);
      expect(duplicateReadStrategy.canCompress(secondReadContext)).toBe(true);
    });
  });

  describe('compress - duplicate reads', () => {
    it('should create reference to previous read with line number', () => {
      // Use higher thresholds so the file isn't considered "hot"
      const nonHotStrategy = new HotFileInclusionStrategy('/test/app', {
        minReadCount: 5,
        minWriteCount: 5,
        recencyWindowMs: 10 * 60 * 1000,
      });
      const duplicateStrategy = new DuplicateFileReadStrategy(nonHotStrategy);

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

      nonHotStrategy.analyzeMessages(messages);
      duplicateStrategy.analyzeMessages(messages);

      const context: CompressionContext = {
        messageIndex: 1,
        totalMessages: 4,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const compressed = duplicateStrategy.compress(context);

      expect(compressed).not.toBeNull();
      const content = getMessageContent(compressed!);
      expect(content).toContain('src/test.ts');
      expect(content).toContain('Duplicate file read removed');
      expect(content).toMatch(/message #\d+/);
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

      hotFileStrategy.analyzeMessages(messages);
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

  describe('integration with hot files', () => {
    it('should prioritize hot file removal over duplicate detection', () => {
      // Create hot file strategy with minReadCount: 3 so we can distinguish hot from cold
      const testHotFileStrategy = new HotFileInclusionStrategy('/test/app', {
        minReadCount: 3,
        minWriteCount: 3,
        recencyWindowMs: 10 * 60 * 1000,
      });
      const testDuplicateStrategy = new DuplicateFileReadStrategy(testHotFileStrategy);

      // hot.ts is read 3 times (becomes hot), cold.ts is read 2 times (stays cold)
      const messages: LLMMessage[] = [
        // First read of hot.ts
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
        createToolMessage('call_1', 'readFile', 'Hot file content'),
        // Second read of hot.ts
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
        createToolMessage('call_2', 'readFile', 'Hot file content'),
        // Third read of hot.ts (makes it hot)
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/hot.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_3', 'readFile', 'Hot file content'),
        // First read of cold.ts
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
        createToolMessage('call_4', 'readFile', 'Cold file content'),
        // Second read of cold.ts (still not hot, just a duplicate)
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_5',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ path: 'src/cold.ts' }),
              },
            },
          ],
        },
        createToolMessage('call_5', 'readFile', 'Cold file content'),
      ];

      testHotFileStrategy.analyzeMessages(messages);
      testDuplicateStrategy.analyzeMessages(messages);

      const hotFirstRead: CompressionContext = {
        messageIndex: 1,
        totalMessages: 10,
        message: messages[1]!,
        previousMessage: messages[0],
        nextMessage: messages[2],
      };

      const hotThirdRead: CompressionContext = {
        messageIndex: 5,
        totalMessages: 10,
        message: messages[5]!,
        previousMessage: messages[4],
        nextMessage: messages[6],
      };

      const coldFirstRead: CompressionContext = {
        messageIndex: 7,
        totalMessages: 10,
        message: messages[7]!,
        previousMessage: messages[6],
        nextMessage: messages[8],
      };

      const coldSecondRead: CompressionContext = {
        messageIndex: 9,
        totalMessages: 10,
        message: messages[9]!,
        previousMessage: messages[8],
        nextMessage: undefined,
      };

      // hot.ts: ALL reads should be compressed (file is in hot files context)
      expect(testDuplicateStrategy.canCompress(hotFirstRead)).toBe(true);
      expect(testDuplicateStrategy.canCompress(hotThirdRead)).toBe(true);
      // cold.ts: first read can be compressed, second read (most recent) cannot
      expect(testDuplicateStrategy.canCompress(coldFirstRead)).toBe(true);
      expect(testDuplicateStrategy.canCompress(coldSecondRead)).toBe(false);

      const hotCompressed = testDuplicateStrategy.compress(hotFirstRead);
      const coldCompressed = testDuplicateStrategy.compress(coldFirstRead);

      const hotContent = getMessageContent(hotCompressed!);
      const coldContent = getMessageContent(coldCompressed!);
      expect(hotContent).toContain('included in hot files context');
      expect(coldContent).toContain('Duplicate file read removed');
      expect(coldContent).toMatch(/message #\d+/);
    });
  });
});
