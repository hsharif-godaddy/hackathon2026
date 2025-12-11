import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateFileReadStrategy } from '../compression/strategies/DuplicateFileReadStrategy.js';
import { MessageCompressor } from '../compression/MessageCompressor.js';
import type { LLMMessage } from '../ConversationHistoryLoader.js';
import type { ToolModelMessage } from 'ai';

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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool1',
          toolName: 'readFile',
          output: { type: 'text', value: 'export function main() { ... }' }
        }]
      } as ToolModelMessage,
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(2);
    const toolMessage = result.messages[1] as ToolModelMessage;
    expect(Array.isArray(toolMessage.content) && toolMessage.content[0]?.type === 'tool-result').toBe(true);
    expect(result.stats.compressedMessages).toBe(0);
  });

  it('should compress duplicate file reads', () => {
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool1',
          toolName: 'readFile',
          output: { type: 'text', value: 'export function main() { console.log("v1"); }' }
        }]
      } as ToolModelMessage,
      { role: 'user', content: 'Update it' },
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool2',
          toolName: 'readFile',
          output: { type: 'text', value: 'export function main() { console.log("v2"); }' }
        }]
      } as ToolModelMessage,
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(5);
    const compressedMessage = result.messages[1] as ToolModelMessage;
    expect(Array.isArray(compressedMessage.content) && compressedMessage.content[0]?.type === 'tool-result').toBe(true);
    const output = compressedMessage.content[0]?.output;
    const compressedResult = output && typeof output === 'object' && 'type' in output && output.type === 'text' && 'value' in output ? output.value : '';
    expect(compressedResult).toContain('[Duplicate file read removed');
    expect(compressedResult).toContain('/app/src/index.ts');
    const finalMessage = result.messages[4] as ToolModelMessage;
    const finalOutput = finalMessage.content[0]?.output;
    expect(finalOutput && typeof finalOutput === 'object' && 'type' in finalOutput && finalOutput.type === 'text' && 'value' in finalOutput ? finalOutput.value : '').toBe('export function main() { console.log("v2"); }');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should handle multiple different files', () => {
    const messages: LLMMessage[] = [
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool1',
          toolName: 'readFile',
          output: { type: 'text', value: 'file1 content v1' }
        }]
      } as ToolModelMessage,
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool2',
          toolName: 'readFile',
          output: { type: 'text', value: 'file2 content' }
        }]
      } as ToolModelMessage,
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool3',
          toolName: 'readFile',
          output: { type: 'text', value: 'file1 content v2' }
        }]
      } as ToolModelMessage,
    ];

    const result = compressor.compressMessages(messages);

    const compressed1 = result.messages[1] as ToolModelMessage;
    const output1 = compressed1.content[0]?.output;
    const compressedResult1 = output1 && typeof output1 === 'object' && 'type' in output1 && output1.type === 'text' && 'value' in output1 ? output1.value : '';
    expect(compressedResult1).toContain('[Duplicate file read removed');
    const file2Message = result.messages[3] as ToolModelMessage;
    const file2Output = file2Message.content[0]?.output;
    expect(file2Output && typeof file2Output === 'object' && 'type' in file2Output && file2Output.type === 'text' && 'value' in file2Output ? file2Output.value : '').toBe('file2 content');
    const final1 = result.messages[5] as ToolModelMessage;
    const final1Output = final1.content[0]?.output;
    expect(final1Output && typeof final1Output === 'object' && 'type' in final1Output && final1Output.type === 'text' && 'value' in final1Output ? final1Output.value : '').toBe('file1 content v2');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should handle three reads of the same file', () => {
    const messages: LLMMessage[] = [
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool1',
          toolName: 'readFile',
          output: { type: 'text', value: 'content v1' }
        }]
      } as ToolModelMessage,
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool2',
          toolName: 'readFile',
          output: { type: 'text', value: 'content v2' }
        }]
      } as ToolModelMessage,
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool3',
          toolName: 'readFile',
          output: { type: 'text', value: 'content v3' }
        }]
      } as ToolModelMessage,
    ];

    const result = compressor.compressMessages(messages);

    const compressed1st = result.messages[1] as ToolModelMessage;
    const output1st = compressed1st.content[0]?.output;
    const compressedResult1st = output1st && typeof output1st === 'object' && 'type' in output1st && output1st.type === 'text' && 'value' in output1st ? output1st.value : '';
    expect(compressedResult1st).toContain('[Duplicate file read removed');
    const compressed2nd = result.messages[3] as ToolModelMessage;
    const output2nd = compressed2nd.content[0]?.output;
    const compressedResult2nd = output2nd && typeof output2nd === 'object' && 'type' in output2nd && output2nd.type === 'text' && 'value' in output2nd ? output2nd.value : '';
    expect(compressedResult2nd).toContain('[Duplicate file read removed');
    const final3rd = result.messages[5] as ToolModelMessage;
    const final3rdOutput = final3rd.content[0]?.output;
    expect(final3rdOutput && typeof final3rdOutput === 'object' && 'type' in final3rdOutput && final3rdOutput.type === 'text' && 'value' in final3rdOutput ? final3rdOutput.value : '').toBe('content v3');
    expect(result.stats.compressedMessages).toBe(2);
  });

  it('should extract file path from different argument formats', () => {
    const messages: LLMMessage[] = [
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool1',
          toolName: 'readFile',
          output: { type: 'text', value: 'content v1' }
        }]
      } as ToolModelMessage,
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
        content: [{
          type: 'tool-result',
          toolCallId: 'tool2',
          toolName: 'readFile',
          output: { type: 'text', value: 'content v2' }
        }]
      } as ToolModelMessage,
    ];

    const result = compressor.compressMessages(messages);

    const compressedPath = result.messages[1] as ToolModelMessage;
    const outputPath = compressedPath.content[0]?.output;
    const compressedResultPath = outputPath && typeof outputPath === 'object' && 'type' in outputPath && outputPath.type === 'text' && 'value' in outputPath ? outputPath.value : '';
    expect(compressedResultPath).toContain('[Duplicate file read removed');
    const finalPath = result.messages[3] as ToolModelMessage;
    const finalPathOutput = finalPath.content[0]?.output;
    expect(finalPathOutput && typeof finalPathOutput === 'object' && 'type' in finalPathOutput && finalPathOutput.type === 'text' && 'value' in finalPathOutput ? finalPathOutput.value : '').toBe('content v2');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should provide stats about duplicates', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: 'Read file1',
        tool_calls: [{
          id: 'tool1',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tool1', toolName: 'readFile', output: { type: 'text', value: 'content1' } }] } as ToolModelMessage,
      {
        role: 'assistant',
        content: 'Read file1 again',
        tool_calls: [{
          id: 'tool2',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tool2', toolName: 'readFile', output: { type: 'text', value: 'content2' } }] } as ToolModelMessage,
      {
        role: 'assistant',
        content: 'Read file1 third time',
        tool_calls: [{
          id: 'tool3',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file1.ts' }) }
        }]
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tool3', toolName: 'readFile', output: { type: 'text', value: 'content3' } }] } as ToolModelMessage,
      {
        role: 'assistant',
        content: 'Read file2',
        tool_calls: [{
          id: 'tool4',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file2.ts' }) }
        }]
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tool4', toolName: 'readFile', output: { type: 'text', value: 'content4' } }] } as ToolModelMessage,
      {
        role: 'assistant',
        content: 'Read file2 again',
        tool_calls: [{
          id: 'tool5',
          type: 'function',
          function: { name: 'readFile', arguments: JSON.stringify({ file_path: '/app/file2.ts' }) }
        }]
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tool5', toolName: 'readFile', output: { type: 'text', value: 'content5' } }] } as ToolModelMessage,
    ];

    compressor.compressMessages(messages);

    const stats = strategy.getStats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.filesWithDuplicates).toBe(2);
    expect(stats.totalReads).toBe(5);
    expect(stats.duplicateReads).toBe(3);
  });
});
