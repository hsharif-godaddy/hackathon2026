import { describe, it, expect } from 'vitest';
import { OperationLogExtractor } from '../OperationLogExtractor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

describe('OperationLogExtractor', function operationLogExtractorTests() {
  describe('extractAndPrune', function extractAndPruneTests() {
    it('should extract and prune when exceeding limit', function exceedsLimit() {
      // Create messages with many tool calls to exceed the 500 limit
      const messages: LLMMessage[] = [];

      // Create 600 messages with file_edit tool calls
      for (let i = 0; i < 600; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `call${i}`,
              type: 'function',
              function: {
                name: 'file_edit',
                arguments: JSON.stringify({
                  path: `/path/to/file${i}.ts`,
                  mode: 'edit',
                }),
              },
            },
          ],
        });
      }

      // Should extract and prune to 500 operations
      const entries = OperationLogExtractor.extractAndPrune(messages, 500);

      // With only file operations, pruner redistributes unused "other" quota (125)
      // to file ops, resulting in full 500 (375 + 125 redistribution)
      expect(entries.length).toBe(500);
      expect(entries.every(e => e.tool === 'file_edit')).toBe(true);
    });

    it('should not prune when below limit', function belowLimit() {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call1',
              type: 'function',
              function: {
                name: 'file_edit',
                arguments: JSON.stringify({
                  path: '/path/to/file.ts',
                  mode: 'edit',
                }),
              },
            },
          ],
        },
      ];

      const entries = OperationLogExtractor.extractAndPrune(messages, 500);

      expect(entries.length).toBe(1);
      expect(entries[0]?.tool).toBe('file_edit');
    });

    it('should use default max operations', function defaultMax() {
      const messages: LLMMessage[] = [];

      // Create 600 messages to exceed default limit
      for (let i = 0; i < 600; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `call${i}`,
              type: 'function',
              function: {
                name: 'terminal',
                arguments: JSON.stringify({
                  command: `echo ${i}`,
                }),
              },
            },
          ],
        });
      }

      // Should use default of 500
      const entries = OperationLogExtractor.extractAndPrune(messages);

      // With only terminal operations, pruner redistributes unused "file" quota (375)
      // to terminal ops, resulting in full 500 (125 + 375 redistribution)
      expect(entries.length).toBe(500);
      expect(entries.every(e => e.tool === 'terminal')).toBe(true);
    });

    it('should handle mixed operation types', function mixedTypes() {
      const messages: LLMMessage[] = [];

      // Create 800 file operations
      for (let i = 0; i < 800; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `file${i}`,
              type: 'function',
              function: {
                name: 'file_edit',
                arguments: JSON.stringify({
                  path: `/path/to/file${i}.ts`,
                  mode: 'edit',
                }),
              },
            },
          ],
        });
      }

      // Create 200 terminal operations
      for (let i = 0; i < 200; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `term${i}`,
              type: 'function',
              function: {
                name: 'terminal',
                arguments: JSON.stringify({
                  command: `echo ${i}`,
                }),
              },
            },
          ],
        });
      }

      const entries = OperationLogExtractor.extractAndPrune(messages, 500);

      // Should have 375 file ops (75%) + 125 terminal ops (25%) = 500
      expect(entries.length).toBe(500);

      const fileOps = entries.filter(e => e.tool === 'file_edit');
      const terminalOps = entries.filter(e => e.tool === 'terminal');

      expect(fileOps.length).toBe(375);
      expect(terminalOps.length).toBe(125);
    });
  });
});
