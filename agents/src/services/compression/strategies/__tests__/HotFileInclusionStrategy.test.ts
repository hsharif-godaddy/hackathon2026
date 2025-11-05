import { describe, it, expect, beforeEach } from 'vitest';
import { HotFileInclusionStrategy } from '../HotFileInclusionStrategy.js';
import type { LLMMessage } from '../../../services/ConversationHistoryLoader.js';

describe('HotFileInclusionStrategy', () => {
  let strategy: HotFileInclusionStrategy;
  const mockAppPath = '/test/app';

  beforeEach(() => {
    strategy = new HotFileInclusionStrategy(mockAppPath, {
      minReadCount: 1,
      minWriteCount: 1,
      recencyWindowMs: 10 * 60 * 1000,
    });
  });

  describe('analyzeMessages', () => {
    it('should identify files that meet hot criteria with recent access', () => {
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
          content: 'file content',
          tool_call_id: 'call_1',
          name: 'readFile',
        },
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      expect(hotFilesList.length).toBeGreaterThan(0);
      expect(hotFilesList[0].path).toBe('src/index.ts');
      expect(hotFilesList[0].readCount).toBe(1);
    });

    it('should identify files with multiple reads', () => {
      const strategy = new HotFileInclusionStrategy(mockAppPath, {
        minReadCount: 2,
        recencyWindowMs: 0,
      });

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
          content: 'file content',
          tool_call_id: 'call_1',
          name: 'readFile',
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
          content: 'file content again',
          tool_call_id: 'call_2',
          name: 'readFile',
        },
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      expect(hotFilesList.length).toBeGreaterThan(0);
      expect(hotFilesList[0].path).toBe('src/index.ts');
      expect(hotFilesList[0].readCount).toBe(2);
    });

    it('should score files with writes higher than reads', () => {
      const strategy = new HotFileInclusionStrategy(mockAppPath, {
        minReadCount: 1,
        minWriteCount: 1,
        recencyWindowMs: 0,
      });

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
                arguments: JSON.stringify({ path: 'file1.ts' }),
              },
            },
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({ path: 'file2.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          content: 'file1 content',
          tool_call_id: 'call_1',
          name: 'readFile',
        },
        {
          role: 'tool',
          content: 'file2 edited',
          tool_call_id: 'call_2',
          name: 'fileEdit',
        },
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      const file2 = hotFilesList.find((f) => f.path === 'file2.ts');
      expect(file2).toBeDefined();
      expect(file2!.score).toBeGreaterThan(0);
      expect(file2!.writeCount).toBe(1);
    });

    it('should handle messages without tool calls', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Hello',
        },
        {
          role: 'assistant',
          content: 'Hi there',
        },
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      expect(hotFilesList.length).toBe(0);
    });

    it('should handle tool calls with different argument formats', () => {
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
                arguments: JSON.stringify({ file_path: 'index.ts' }),
              },
            },
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'readFile',
                arguments: JSON.stringify({ filePath: 'main.ts' }),
              },
            },
          ],
        },
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      expect(hotFilesList.some((f) => f.path === 'index.ts')).toBe(true);
      expect(hotFilesList.some((f) => f.path === 'main.ts')).toBe(true);
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
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      expect(hotFilesList.length).toBe(0);
    });
  });

  describe('isHotFile', () => {
    it('should return false when no files analyzed', () => {
      expect(strategy.isHotFile('any-file.ts')).toBe(false);
    });

    it('should return false for files not in analysis', () => {
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
                arguments: JSON.stringify({ path: 'hot.ts' }),
              },
            },
          ],
        },
      ];

      strategy.analyzeMessages(messages);
      expect(strategy.isHotFile('not-hot.ts')).toBe(false);
    });
  });

  describe('getHotFilesList', () => {
    it('should return empty array initially', () => {
      const hotFilesList = strategy.getHotFilesList();
      expect(hotFilesList).toEqual([]);
    });

    it('should return sorted list by score', () => {
      const strategy = new HotFileInclusionStrategy(mockAppPath, {
        minReadCount: 1,
        minWriteCount: 1,
        recencyWindowMs: 0,
      });

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
                arguments: JSON.stringify({ path: 'low-score.ts' }),
              },
            },
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({ path: 'high-score.ts' }),
              },
            },
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({ path: 'high-score.ts' }),
              },
            },
            {
              id: 'call_4',
              type: 'function',
              function: {
                name: 'fileEdit',
                arguments: JSON.stringify({ path: 'high-score.ts' }),
              },
            },
          ],
        },
      ];

      strategy.analyzeMessages(messages);
      const hotFilesList = strategy.getHotFilesList();

      expect(hotFilesList[0].path).toBe('high-score.ts');
      expect(hotFilesList[0].writeCount).toBe(3);
    });
  });

  describe('getHotFilesMessage', () => {
    it('should return null when no hot files loaded', () => {
      const messages: LLMMessage[] = [];
      strategy.analyzeMessages(messages);

      const message = strategy.getHotFilesMessage();
      expect(message).toBeNull();
    });

    it('should return null before loadHotFilesContent is called', () => {
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
                arguments: JSON.stringify({ path: 'file.ts' }),
              },
            },
          ],
        },
      ];

      strategy.analyzeMessages(messages);
      const message = strategy.getHotFilesMessage();

      expect(message).toBeNull();
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const defaultStrategy = new HotFileInclusionStrategy();
      expect(defaultStrategy).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const customStrategy = new HotFileInclusionStrategy(mockAppPath, {
        maxTokens: 10000,
        maxFileSize: 500000,
        recencyWindowMs: 5 * 60 * 1000,
        minReadCount: 1,
        minWriteCount: 1,
      });

      expect(customStrategy).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const partialConfigStrategy = new HotFileInclusionStrategy(mockAppPath, {
        minReadCount: 1,
      });

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
                arguments: JSON.stringify({ path: 'file.ts' }),
              },
            },
          ],
        },
      ];

      partialConfigStrategy.analyzeMessages(messages);
      const hotFilesList = partialConfigStrategy.getHotFilesList();

      expect(hotFilesList.length).toBeGreaterThan(0);
    });
  });
});
