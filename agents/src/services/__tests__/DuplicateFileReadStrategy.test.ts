import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateFileReadStrategy } from '../compression/strategies/DuplicateFileReadStrategy.js';
import { MessageCompressor } from '../compression/MessageCompressor.js';
import type { LLMMessage } from '../ConversationHistoryLoader.js';

describe('DuplicateFileReadStrategy', () => {
  let strategy: DuplicateFileReadStrategy;
  let compressor: MessageCompressor;

  beforeEach(() => {
    strategy = new DuplicateFileReadStrategy();
    compressor = new MessageCompressor();
    compressor.registerStrategy(strategy);
  });

  it('should keep single file reads unchanged', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: 'Let me read the file',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/src/index.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'export function main() { ... }',
        tool_call_id: 'tool1',
        name: 'readFile'
      },
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('export function main() { ... }');
    expect(result.stats.compressedMessages).toBe(0);
  });

  it('should compress duplicate file reads', () => {
    const messages: LLMMessage[] = [
      // First read
      {
        role: 'assistant',
        content: 'Let me read the file',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/src/index.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'export function main() { console.log("v1"); }',
        tool_call_id: 'tool1',
        name: 'readFile'
      },
      // Some other messages
      { role: 'user', content: 'Update it' },
      // Second read of same file
      {
        role: 'assistant',
        content: 'Let me read it again',
        tool_calls: [{
          id: 'tool2',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/src/index.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'export function main() { console.log("v2"); }',
        tool_call_id: 'tool2',
        name: 'readFile'
      },
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(5);
    expect(result.messages[1].content).toContain('[Duplicate file read removed');
    expect(result.messages[1].content).toContain('/app/src/index.ts');
    expect(result.messages[4].content).toBe('export function main() { console.log("v2"); }');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should handle multiple different files', () => {
    const messages: LLMMessage[] = [
      // Read file 1
      {
        role: 'assistant',
        content: 'Read file 1',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'file1 content v1',
        tool_call_id: 'tool1',
        name: 'readFile'
      },
      // Read file 2
      {
        role: 'assistant',
        content: 'Read file 2',
        tool_calls: [{
          id: 'tool2',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file2.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'file2 content',
        tool_call_id: 'tool2',
        name: 'readFile'
      },
      // Re-read file 1
      {
        role: 'assistant',
        content: 'Read file 1 again',
        tool_calls: [{
          id: 'tool3',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'file1 content v2',
        tool_call_id: 'tool3',
        name: 'readFile'
      },
    ];

    const result = compressor.compressMessages(messages);

    // First read of file1 should be compressed, file2 unchanged, second read of file1 kept
    expect(result.messages[1].content).toContain('[Duplicate file read removed');
    expect(result.messages[3].content).toBe('file2 content');
    expect(result.messages[5].content).toBe('file1 content v2');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should handle three reads of the same file', () => {
    const messages: LLMMessage[] = [
      // Read 1
      {
        role: 'assistant',
        content: 'Read 1',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/test.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'content v1',
        tool_call_id: 'tool1',
        name: 'readFile'
      },
      // Read 2
      {
        role: 'assistant',
        content: 'Read 2',
        tool_calls: [{
          id: 'tool2',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/test.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'content v2',
        tool_call_id: 'tool2',
        name: 'readFile'
      },
      // Read 3
      {
        role: 'assistant',
        content: 'Read 3',
        tool_calls: [{
          id: 'tool3',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/test.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'content v3',
        tool_call_id: 'tool3',
        name: 'readFile'
      },
    ];

    const result = compressor.compressMessages(messages);

    // First two reads should be compressed, third kept
    expect(result.messages[1].content).toContain('[Duplicate file read removed');
    expect(result.messages[3].content).toContain('[Duplicate file read removed');
    expect(result.messages[5].content).toBe('content v3');
    expect(result.stats.compressedMessages).toBe(2);
  });

  it('should extract file path from different argument formats', () => {
    const messages: LLMMessage[] = [
      // Using file_path
      {
        role: 'assistant',
        content: 'Read with file_path',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/test.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'content v1',
        tool_call_id: 'tool1',
        name: 'readFile'
      },
      // Using path
      {
        role: 'assistant',
        content: 'Read with path',
        tool_calls: [{
          id: 'tool2',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ path: '/app/test.ts' }) }
        }]
      },
      {
        role: 'tool',
        content: 'content v2',
        tool_call_id: 'tool2',
        name: 'readFile'
      },
    ];

    const result = compressor.compressMessages(messages);

    // Both should be recognized as the same file
    expect(result.messages[1].content).toContain('[Duplicate file read removed');
    expect(result.messages[3].content).toBe('content v2');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should provide stats about duplicates', () => {
    const messages: LLMMessage[] = [
      // File 1 - read 3 times
      {
        role: 'assistant',
        content: 'Read file1',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      { role: 'tool', content: 'content1', tool_call_id: 'tool1', name: 'readFile' },
      {
        role: 'assistant',
        content: 'Read file1 again',
        tool_calls: [{
          id: 'tool2',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      { role: 'tool', content: 'content2', tool_call_id: 'tool2', name: 'readFile' },
      {
        role: 'assistant',
        content: 'Read file1 third time',
        tool_calls: [{
          id: 'tool3',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      { role: 'tool', content: 'content3', tool_call_id: 'tool3', name: 'readFile' },
      // File 2 - read 2 times
      {
        role: 'assistant',
        content: 'Read file2',
        tool_calls: [{
          id: 'tool4',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file2.ts' }) }
        }]
      },
      { role: 'tool', content: 'content4', tool_call_id: 'tool4', name: 'readFile' },
      {
        role: 'assistant',
        content: 'Read file2 again',
        tool_calls: [{
          id: 'tool5',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file2.ts' }) }
        }]
      },
      { role: 'tool', content: 'content5', tool_call_id: 'tool5', name: 'readFile' },
    ];

    compressor.compressMessages(messages);

    const stats = strategy.getStats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.filesWithDuplicates).toBe(2);
    expect(stats.totalReads).toBe(5);
    expect(stats.duplicateReads).toBe(3); // 2 duplicates from file1, 1 from file2
  });
});
