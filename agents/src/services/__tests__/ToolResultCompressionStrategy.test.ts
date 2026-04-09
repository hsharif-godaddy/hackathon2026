import { describe, it, expect, beforeEach } from 'vitest';
import { ToolResultCompressionStrategy } from '../compression/strategies/ToolResultCompressionStrategy.js';
import { MessageCompressor } from '../compression/MessageCompressor.js';
import type { LLMMessage } from '../ConversationHistoryLoader.js';
import type { ToolModelMessage } from 'ai';

function makeAssistantWithToolCall(toolCallId: string, toolName: string, filePath: string, command: string = 'str_replace'): LLMMessage {
  return {
    role: 'assistant',
    content: 'Editing file',
    tool_calls: [{
      id: toolCallId,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify({ path: filePath, command }),
      },
    }],
  };
}

function makeAIToolResult(toolCallId: string, toolName: string, output: string): ToolModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId,
      toolName,
      output: { type: 'text', value: output },
    }],
  } as ToolModelMessage;
}

function makeOpenAIToolResult(toolCallId: string, toolName: string, output: string): LLMMessage {
  return {
    role: 'tool',
    content: output,
    tool_call_id: toolCallId,
    name: toolName,
  };
}

function getOutputValue(message: LLMMessage): string {
  if (Array.isArray((message as any).content)) {
    const content = (message as ToolModelMessage).content;
    const output = content[0]?.output;
    if (output && typeof output === 'object' && 'type' in output && output.type === 'text' && 'value' in output) {
      return (output as { type: 'text'; value: string }).value;
    }
    return '';
  }
  return (message as any).content || '';
}

describe('ToolResultCompressionStrategy', () => {
  let strategy: ToolResultCompressionStrategy;
  let compressor: MessageCompressor;

  beforeEach(() => {
    strategy = new ToolResultCompressionStrategy();
    compressor = new MessageCompressor();
    compressor.registerStrategy(strategy);
  });

  it('should keep single edit results unchanged', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeAIToolResult('tool1', 'str_replace_based_edit_tool', 'Successfully replaced text at exactly one location.'),
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(2);
    expect(getOutputValue(result.messages[1]!)).toBe('Successfully replaced text at exactly one location.');
    expect(result.stats.compressedMessages).toBe(0);
  });

  it('should compress older successful edits, keep most recent', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeAIToolResult('tool1', 'str_replace_based_edit_tool', 'Successfully replaced text at exactly one location.'),
      { role: 'user', content: 'Make another change' },
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeAIToolResult('tool2', 'str_replace_based_edit_tool', 'Successfully replaced text at exactly one location.'),
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(5);
    // First edit should be compressed
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit succeeded]');
    // Most recent edit should be kept
    expect(getOutputValue(result.messages[4]!)).toBe('Successfully replaced text at exactly one location.');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should compress failed edits superseded by success on same file', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeAIToolResult('tool1', 'str_replace_based_edit_tool', 'No match found for replacement.'),
      { role: 'user', content: 'Try again' },
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeAIToolResult('tool2', 'str_replace_based_edit_tool', 'Successfully replaced text at exactly one location.'),
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(5);
    // Failed edit should be compressed with appropriate message
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit failed, later retried successfully]');
    // Successful edit is the most recent, kept as-is
    expect(getOutputValue(result.messages[4]!)).toBe('Successfully replaced text at exactly one location.');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should keep failed edits with no subsequent success', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeAIToolResult('tool1', 'str_replace_based_edit_tool', 'No match found for replacement.'),
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(2);
    expect(getOutputValue(result.messages[1]!)).toBe('No match found for replacement.');
    expect(result.stats.compressedMessages).toBe(0);
  });

  it('should handle mixed files correctly', () => {
    const messages: LLMMessage[] = [
      // Edit file A (success)
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/fileA.ts'),
      makeAIToolResult('tool1', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
      // Edit file B (fail)
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/fileB.ts'),
      makeAIToolResult('tool2', 'str_replace_based_edit_tool', 'No match found.'),
      // Edit file A again (success) — most recent edit for file A
      makeAssistantWithToolCall('tool3', 'str_replace_based_edit_tool', '/app/fileA.ts'),
      makeAIToolResult('tool3', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
    ];

    const result = compressor.compressMessages(messages);

    // First edit on file A: compressed (older success, not most recent for fileA)
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit succeeded]');
    // Failed edit on file B: kept (most recent edit for fileB, and no later success)
    expect(getOutputValue(result.messages[3]!)).toBe('No match found.');
    // Last edit on file A: kept (most recent edit for fileA)
    expect(getOutputValue(result.messages[5]!)).toBe('Successfully replaced text.');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should preserve the most recent edit per file, not just globally', () => {
    const messages: LLMMessage[] = [
      // Edit file A (success)
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/fileA.ts'),
      makeAIToolResult('tool1', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
      // Edit file B (success) — only edit of file B
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/fileB.ts'),
      makeAIToolResult('tool2', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
      // Edit file A again (success) — most recent edit for file A
      makeAssistantWithToolCall('tool3', 'str_replace_based_edit_tool', '/app/fileA.ts'),
      makeAIToolResult('tool3', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
    ];

    const result = compressor.compressMessages(messages);

    // First edit on file A: compressed (older success, not most recent for fileA)
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit succeeded]');
    // Only edit on file B: kept (most recent edit for fileB)
    expect(getOutputValue(result.messages[3]!)).toBe('Successfully replaced text.');
    // Last edit on file A: kept (most recent edit for fileA)
    expect(getOutputValue(result.messages[5]!)).toBe('Successfully replaced text.');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should handle AI SDK v6 format (AIToolMessage)', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'textEditor', '/app/index.ts'),
      makeAIToolResult('tool1', 'textEditor', 'Successfully replaced text.'),
      { role: 'user', content: 'More changes' },
      makeAssistantWithToolCall('tool2', 'textEditor', '/app/index.ts'),
      makeAIToolResult('tool2', 'textEditor', 'Successfully replaced text.'),
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(5);
    const compressed = result.messages[1] as ToolModelMessage;
    expect(Array.isArray(compressed.content)).toBe(true);
    expect(getOutputValue(compressed)).toBe('[Edit succeeded]');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should handle OpenAI message format', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeOpenAIToolResult('tool1', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
      { role: 'user', content: 'More changes' },
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/index.ts'),
      makeOpenAIToolResult('tool2', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
    ];

    const result = compressor.compressMessages(messages);

    expect(result.messages).toHaveLength(5);
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit succeeded]');
    expect(getOutputValue(result.messages[4]!)).toBe('Successfully replaced text.');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should not misclassify failed edits whose file content contains "successfully"', () => {
    // Error message embeds file content that happens to contain "successfully"
    const errorWithSuccessInContent =
      'No match found for replacement. The text you provided does not exist in the file.\n\n' +
      'File content (5 lines):\n' +
      '1: // Successfully connected to database\n' +
      '2: export function init() {\n' +
      '3:   return true;\n' +
      '4: }\n' +
      '5: ';

    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/db.ts'),
      makeOpenAIToolResult('tool1', 'str_replace_based_edit_tool', errorWithSuccessInContent),
      { role: 'user', content: 'Try again' },
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/db.ts'),
      makeOpenAIToolResult('tool2', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
    ];

    const result = compressor.compressMessages(messages);

    // The failed edit (index 1) should be compressed as a failed-then-retried result,
    // NOT as a success — despite "Successfully" appearing in the embedded file content
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit failed, later retried successfully]');
    // The successful edit (index 4) is the most recent and should be kept
    expect(getOutputValue(result.messages[4]!)).toBe('Successfully replaced text.');
    expect(result.stats.compressedMessages).toBe(1);
  });

  it('should not treat view commands as edits', () => {
    // Sequence: edit fileA → view fileA (to verify) → edit fileA again
    // The view should NOT become the "most recent edit" for fileA
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('tool1', 'str_replace_based_edit_tool', '/app/index.ts', 'str_replace'),
      makeOpenAIToolResult('tool1', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
      { role: 'user', content: 'Let me check that' },
      makeAssistantWithToolCall('tool2', 'str_replace_based_edit_tool', '/app/index.ts', 'view'),
      makeOpenAIToolResult('tool2', 'str_replace_based_edit_tool', '1: const x = 1\n2: const y = 2'),
      { role: 'user', content: 'Now change y' },
      makeAssistantWithToolCall('tool3', 'str_replace_based_edit_tool', '/app/index.ts', 'str_replace'),
      makeOpenAIToolResult('tool3', 'str_replace_based_edit_tool', 'Successfully replaced text.'),
    ];

    const result = compressor.compressMessages(messages);

    // First edit (index 1) should be compressed — it's not the most recent edit
    expect(getOutputValue(result.messages[1]!)).toBe('[Edit succeeded]');
    // View result (index 4) should be untouched — not tracked as an edit
    expect(getOutputValue(result.messages[4]!)).toBe('1: const x = 1\n2: const y = 2');
    // Second edit (index 7) should be kept — most recent edit for this file
    expect(getOutputValue(result.messages[7]!)).toBe('Successfully replaced text.');
    expect(result.stats.compressedMessages).toBe(1);
  });
});
