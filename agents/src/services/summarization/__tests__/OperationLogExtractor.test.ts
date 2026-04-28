import { describe, it, expect } from 'vitest';
import { OperationLogExtractor } from '../OperationLogExtractor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

describe('OperationLogExtractor', function operationLogExtractorTests() {
  describe('extractAndPrune', function extractAndPruneTests() {
    it('should extract and prune when exceeding limit', function exceedsLimit() {
      // Create messages with many tool calls to exceed the 500 limit
      const messages: LLMMessage[] = [];

      // Create 600 messages with str_replace_based_edit_tool calls
      for (let i = 0; i < 600; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `call${i}`,
              type: 'function',
              function: {
                name: 'str_replace_based_edit_tool',
                arguments: JSON.stringify({
                  command: 'str_replace',
                  path: `/path/to/file${i}.ts`,
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
      expect(entries.every(e => e.tool === 'str_replace_based_edit_tool')).toBe(true);
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
                name: 'str_replace_based_edit_tool',
                arguments: JSON.stringify({
                  command: 'str_replace',
                  path: '/path/to/file.ts',
                }),
              },
            },
          ],
        },
      ];

      const entries = OperationLogExtractor.extractAndPrune(messages, 500);

      expect(entries.length).toBe(1);
      expect(entries[0]?.tool).toBe('str_replace_based_edit_tool');
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
                name: 'terminalCommand',
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
      expect(entries.every(e => e.tool === 'terminalCommand')).toBe(true);
    });

    it('should handle mixed operation types', function mixedTypes() {
      const messages: LLMMessage[] = [];

      // Create 800 file edit operations
      for (let i = 0; i < 800; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `file${i}`,
              type: 'function',
              function: {
                name: 'str_replace_based_edit_tool',
                arguments: JSON.stringify({
                  command: 'str_replace',
                  path: `/path/to/file${i}.ts`,
                }),
              },
            },
          ],
        });
      }

      // Create 200 terminal command operations
      for (let i = 0; i < 200; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `term${i}`,
              type: 'function',
              function: {
                name: 'terminalCommand',
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

      const fileOps = entries.filter(e => e.tool === 'str_replace_based_edit_tool');
      const terminalOps = entries.filter(e => e.tool === 'terminalCommand');

      expect(fileOps.length).toBe(375);
      expect(terminalOps.length).toBe(125);
    });
  });

  describe('serialize/deserialize', function serializeDeserializeTests() {
    it('should parse legacy formatted logs', function legacyRoundTrip() {
      const formatted = [
        'Files modified: foo.ts, bar.ts',
        'Files read: readme.md',
        'Commands run: npm: npm install; git: git status',
        'Git operations: git commit; git push',
      ].join('\n');

      const parsed = OperationLogExtractor.deserialize(formatted);
      const reformatted = OperationLogExtractor.format(parsed);

      expect(reformatted).toBe(formatted);
    });

    it('should deserialize versioned JSON envelope format', function jsonEnvelopeFormat() {
      const entries = [
        { tool: 'readFile', files: ['readme.md'], description: 'Read readme.md' },
      ];
      const raw = JSON.stringify({ version: 1, entries });

      const parsed = OperationLogExtractor.deserialize(raw);

      expect(parsed).toEqual(entries);
    });

    it('should fall back on malformed JSON', function malformedJsonFallback() {
      const parsed = OperationLogExtractor.deserialize('{"version":1,"entries":[');

      expect(parsed).toEqual([]);
    });

    it('should handle whitespace and BOM before JSON', function bomWhitespace() {
      const entries = [
        { tool: 'git', description: 'git status' },
      ];
      const raw = `\uFEFF  ${JSON.stringify({ version: 1, entries })}`;

      const parsed = OperationLogExtractor.deserialize(raw);

      expect(parsed).toEqual(entries);
    });

    it('should round-trip serialized entries', function jsonRoundTrip() {
      const entries = [
        { tool: 'str_replace_based_edit_tool', files: ['foo.ts'], mode: 'edit', description: 'edit: foo.ts' },
        { tool: 'git', description: 'git commit' },
      ];

      const serialized = OperationLogExtractor.serialize(entries);
      const parsed = OperationLogExtractor.deserialize(serialized);

      expect(parsed).toEqual(entries);
    });
  });

  describe('str_replace_based_edit_tool view command', function viewCommandTests() {
    function makeMessage(command: string, path: string): LLMMessage {
      return {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'str_replace_based_edit_tool',
              arguments: JSON.stringify({ command, path }),
            },
          },
        ],
      };
    }

    it('should produce a readFile entry for view command', function viewProducesRead() {
      const entries = OperationLogExtractor.extract([makeMessage('view', '/src/index.ts')]);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.tool).toBe('readFile');
      expect(entries[0]?.files).toEqual(['index.ts']);
    });

    it('should appear under Files read not Files modified in format output', function viewInFilesRead() {
      const entries = OperationLogExtractor.extract([makeMessage('view', '/src/index.ts')]);
      const formatted = OperationLogExtractor.format(entries);

      expect(formatted).toContain('Files read: index.ts');
      expect(formatted).not.toContain('Files modified:');
    });

    it('should not affect str_replace and create_file commands', function mutatingCommandsUnchanged() {
      const messages = [
        makeMessage('str_replace', '/src/a.ts'),
        makeMessage('create', '/src/b.ts'),
        makeMessage('view', '/src/c.ts'),
      ];
      const entries = OperationLogExtractor.extract(messages);

      expect(entries).toHaveLength(3);
      expect(entries[0]?.tool).toBe('str_replace_based_edit_tool');
      expect(entries[1]?.tool).toBe('str_replace_based_edit_tool');
      expect(entries[2]?.tool).toBe('readFile');

      const formatted = OperationLogExtractor.format(entries);
      expect(formatted).toContain('Files modified: a.ts, b.ts');
      expect(formatted).toContain('Files read: c.ts');
    });
  });

  describe('mergeAndPrune', function mergeAndPruneTests() {
    it('should deduplicate by tool + description keeping most recent', function dedupe() {
      const existing = [
        { tool: 'git', description: 'git commit' },
        { tool: 'terminalCommand', description: 'npm: npm install' },
      ];
      const newer = [
        { tool: 'git', description: 'git commit' },
        { tool: 'git', description: 'git push' },
      ];

      const merged = OperationLogExtractor.mergeAndPrune(existing, newer, 500);

      expect(merged.length).toBe(3);
      expect(merged[merged.length - 2]?.description).toBe('git commit');
      expect(merged[merged.length - 1]?.description).toBe('git push');
    });

    it('should prune to max size', function pruneToMax() {
      const existing = [];
      const newer = Array.from({ length: 600 }, (_, i) => ({
        tool: 'str_replace_based_edit_tool',
        files: [`file-${i}.ts`],
        mode: 'edit',
        description: `edit: file-${i}.ts`,
      }));

      const merged = OperationLogExtractor.mergeAndPrune(existing, newer, 500);

      expect(merged.length).toBe(500);
      expect(merged.every(entry => entry.tool === 'str_replace_based_edit_tool')).toBe(true);
    });
  });
});
