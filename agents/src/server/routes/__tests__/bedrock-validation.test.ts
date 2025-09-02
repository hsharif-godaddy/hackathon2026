import { describe, it, expect } from 'vitest';

// Import the functions we want to test
// Note: These are currently internal functions in websocket.ts
// For testing, we'll define them here or we could export them from websocket.ts

/**
 * Validate messages array for Bedrock compatibility
 * Returns array of validation errors
 */
function validateMessagesForBedrock(messages: any[]): string[] {
  const errors: string[] = [];
  const pendingToolCalls = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    if (msg.role === 'assistant' && msg.tool_calls) {
      // Assistant message with tool calls - track expected tool results
      for (const toolCall of msg.tool_calls) {
        pendingToolCalls.add(toolCall.id);
      }
    } else if (msg.role === 'tool') {
      // Tool result message - should match a pending tool call
      if (!pendingToolCalls.has(msg.tool_call_id)) {
        errors.push(`Tool result at index ${i} has unexpected tool_call_id: ${msg.tool_call_id}`);
      } else {
        pendingToolCalls.delete(msg.tool_call_id);
      }
    }
  }

  // Check for any unmatched tool calls
  if (pendingToolCalls.size > 0) {
    errors.push(`Unmatched tool calls: ${Array.from(pendingToolCalls).join(', ')}`);
  }

  return errors;
}

/**
 * Fix Bedrock validation issues by removing assistant messages with unmatched tool calls
 */
function fixBedrockValidationIssues(messages: any[]): any[] {
  const fixedMessages: any[] = [];
  const pendingToolCalls = new Set<string>();
  const toolResults = new Set<string>();

  // First pass: collect all tool results
  for (const msg of messages) {
    if (msg.role === 'tool') {
      toolResults.add(msg.tool_call_id);
    }
  }

  // Second pass: filter out problematic messages
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      // Only include assistant messages where all tool calls have results
      const validToolCalls = msg.tool_calls.filter((tc: any) => toolResults.has(tc.id));
      
      if (validToolCalls.length > 0) {
        // Include assistant message with only valid tool calls
        fixedMessages.push({
          ...msg,
          tool_calls: validToolCalls
        });
        
        // Track these as pending
        for (const toolCall of validToolCalls) {
          pendingToolCalls.add(toolCall.id);
        }
      } else if (msg.content && msg.content.trim()) {
        // Include assistant message without tool calls if it has content
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { tool_calls, ...msgWithoutToolCalls } = msg;
        fixedMessages.push(msgWithoutToolCalls);
      }
    } else if (msg.role === 'tool') {
      // Include tool result if we have a pending tool call for it
      if (pendingToolCalls.has(msg.tool_call_id)) {
        fixedMessages.push(msg);
        pendingToolCalls.delete(msg.tool_call_id);
      }
    } else {
      // Include all other message types (system, user)
      fixedMessages.push(msg);
    }
  }

  return fixedMessages;
}

describe('Bedrock Message Validation', () => {
  it('should validate correct message sequence', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' },
      { 
        role: 'assistant', 
        content: 'I will help you',
        tool_calls: [{ id: 'call_123', function: { name: 'test_tool' } }]
      },
      { role: 'tool', content: 'Tool result', tool_call_id: 'call_123' },
      { role: 'assistant', content: 'Done!' }
    ];

    const errors = validateMessagesForBedrock(messages);
    expect(errors).toHaveLength(0);
  });

  it('should detect unmatched tool calls', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { 
        role: 'assistant', 
        content: 'I will help you',
        tool_calls: [{ id: 'call_123', function: { name: 'test_tool' } }]
      }
      // Missing tool result
    ];

    const errors = validateMessagesForBedrock(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Unmatched tool calls: call_123');
  });

  it('should detect unexpected tool results', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'tool', content: 'Tool result', tool_call_id: 'call_orphan' }
      // No preceding assistant message with this tool call
    ];

    const errors = validateMessagesForBedrock(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unexpected tool_call_id: call_orphan');
  });

  it('should fix messages by removing unmatched tool calls', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { 
        role: 'assistant', 
        content: 'I will help you',
        tool_calls: [
          { id: 'call_matched', function: { name: 'matched_tool' } },
          { id: 'call_unmatched', function: { name: 'unmatched_tool' } }
        ]
      },
      { role: 'tool', content: 'Tool result', tool_call_id: 'call_matched' },
      // Missing result for call_unmatched
      { role: 'assistant', content: 'Done!' }
    ];

    const fixed = fixBedrockValidationIssues(messages);
    
    expect(fixed).toHaveLength(4); // system, assistant, tool, assistant
    expect(fixed[1].tool_calls).toHaveLength(1); // Only matched tool call
    expect(fixed[1].tool_calls[0].id).toBe('call_matched');
  });

  it('should remove assistant message with only unmatched tool calls but keep content', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { 
        role: 'assistant', 
        content: 'I will try to help',
        tool_calls: [{ id: 'call_unmatched', function: { name: 'unmatched_tool' } }]
      }
      // No tool result
    ];

    const fixed = fixBedrockValidationIssues(messages);
    
    expect(fixed).toHaveLength(2); // system, assistant (without tool_calls)
    expect(fixed[1].role).toBe('assistant');
    expect(fixed[1].content).toBe('I will try to help');
    expect(fixed[1].tool_calls).toBeUndefined();
  });

  it('should remove orphaned tool results', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'tool', content: 'Orphaned result', tool_call_id: 'call_orphan' },
      { role: 'assistant', content: 'Hello!' }
    ];

    const fixed = fixBedrockValidationIssues(messages);
    
    expect(fixed).toHaveLength(2); // system, assistant (orphaned tool result removed)
    expect(fixed[1].role).toBe('assistant');
    expect(fixed[1].content).toBe('Hello!');
  });
});