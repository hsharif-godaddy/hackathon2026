import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationHistoryLoader, sanitizeToolUseId, type LLMMessage } from '../ConversationHistoryLoader.js';
import type { MessageStore, SummaryStore } from '../../memory/interfaces/index.js';
import conversationFixture from './fixtures/conversation-messages.json';

// Mock token counter to provide deterministic token counts
vi.mock('../../utils/token-counter.js', () => ({
  countTokens: vi.fn().mockImplementation(function (text: string) {
    // Simulate ~4 chars per token for deterministic testing
    const tokenCount = Math.ceil(text.length / 4);
    return Promise.resolve({ tokenCount, provider: 'anthropic', normalizedModelName: 'claude-sonnet-4-6' });
  })
}));

describe('ConversationHistoryLoader', () => {
  let loader: ConversationHistoryLoader;
  let mockMessageStore: MessageStore;
  let mockSummaryStore: SummaryStore;
  let latestSummary: any;
  let summaryByIdStore: Map<string, any>;

  beforeEach(() => {
    latestSummary = null;
    summaryByIdStore = new Map<string, any>();
    mockMessageStore = {
      getMessagesForHistory: vi.fn(),
      getMessageById: vi.fn().mockResolvedValue(null),
    } as unknown as MessageStore;
    mockSummaryStore = {
      findLatestForApp: vi.fn().mockImplementation(async function () { return latestSummary; }),
      findById: vi.fn().mockImplementation(async function (id: string) { return summaryByIdStore.get(id) ?? null; }),
    } as unknown as SummaryStore;

    loader = new ConversationHistoryLoader(mockMessageStore, undefined, mockSummaryStore);
  });

  describe('loadDatabaseMessagesByConversationId', () => {
    it('should load and sort messages by conversation ID', async () => {
      const normalizedMessages = conversationFixture.map((msg: any) => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        sender: msg.sender,
        content: msg.content,
        segments: msg.segments ? msg.segments.map((seg: any) => ({
          id: seg.id,
          type: seg.type,
          content: seg.content,
          tool_call: seg.toolCall ? {
            id: seg.toolCall.id,
            toolName: seg.toolCall.name,
            toolArgs: seg.toolCall.input,
            toolResult: seg.toolCall.result,
            error: seg.toolCall.error
          } : undefined,
          timestamp: new Date(seg.timestamp)
        })) : undefined,
        createdAt: new Date(msg.created_at)
      }));

      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue(normalizedMessages);

      const result = await loader.loadDatabaseMessagesByConversationId('D5wI4wo3ThTl');

      expect(result).toHaveLength(4);
      expect(result[0].sender).toBe('user');
      expect(result[1].sender).toBe('agent');
      expect(mockMessageStore.getMessagesForHistory).toHaveBeenCalledWith('D5wI4wo3ThTl');
    });

    it('should sort messages chronologically (oldest first)', async () => {
      const messages = [
        { id: '3', conversationId: 'conv1', sender: 'user' as const, content: 'msg3', createdAt: new Date('2025-01-03') },
        { id: '1', conversationId: 'conv1', sender: 'user' as const, content: 'msg1', createdAt: new Date('2025-01-01') },
        { id: '2', conversationId: 'conv1', sender: 'user' as const, content: 'msg2', createdAt: new Date('2025-01-02') },
      ];

      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue(messages);

      const result = await loader.loadDatabaseMessagesByConversationId('conv1');

      expect(result.map(m => m.id)).toEqual(['1', '2', '3']);
    });
  });

  describe('convertToLLMMessages', () => {
    it('should convert user messages to LLM format', () => {
      const dbMessages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user' as const,
          content: 'Hello, I need help',
          createdAt: new Date()
        }
      ];

      const result = loader.convertToLLMMessages(dbMessages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'Hello, I need help'
      });
    });

    it('should skip user messages with empty content', () => {
      const dbMessages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user' as const,
          content: '',
          createdAt: new Date()
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'user' as const,
          content: '   ',
          createdAt: new Date()
        }
      ];

      const result = loader.convertToLLMMessages(dbMessages);

      expect(result).toHaveLength(0);
    });

    it('should fallback to content for agent messages without segments', () => {
      const dbMessages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'agent' as const,
          content: 'Some content',
          segments: undefined,
          createdAt: new Date()
        }
      ];

      const result = loader.convertToLLMMessages(dbMessages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'assistant',
        content: 'Some content'
      });
    });

    it('should convert agent messages with content segments', () => {
      const dbMessages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'agent' as const,
          content: 'Hello there',
          segments: [
            {
              id: 'seg1',
              type: 'content' as const,
              content: 'Hello ',
              timestamp: new Date()
            },
            {
              id: 'seg2',
              type: 'content' as const,
              content: 'there',
              timestamp: new Date()
            }
          ],
          createdAt: new Date()
        }
      ];

      const result = loader.convertToLLMMessages(dbMessages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'assistant',
        content: 'Hello there'
      });
    });

    it('should handle agent messages with tool calls and results', () => {
      const dbMessages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'agent' as const,
          content: 'Let me search for that',
          segments: [
            {
              id: 'seg1',
              type: 'content' as const,
              content: 'Let me search',
              timestamp: new Date('2025-01-01T00:00:00.000Z')
            },
            {
              id: 'seg2',
              type: 'tool_call' as const,
              tool_call: {
                id: 'tool1',
                toolName: 'search',
                toolArgs: { query: 'test' },
                toolResult: 'Found 3 results'
              },
              timestamp: new Date('2025-01-01T00:00:01.000Z')
            }
          ],
          createdAt: new Date()
        }
      ];

      const result = loader.convertToLLMMessages(dbMessages);

      // Now produces 3 messages: content, tool_call, and tool result
      expect(result).toHaveLength(3);

      // First message: assistant content
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Let me search');
      expect(result[0].tool_calls).toBeUndefined();

      // Second message: assistant with tool call
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toBe(' ');
      expect(result[1].tool_calls).toHaveLength(1);
      expect(result[1].tool_calls![0]).toEqual({
        id: 'tool1',
        type: 'function',
        function: {
          name: 'search',
          arguments: JSON.stringify({ query: 'test' })
        }
      });

      // Third message: tool result
      expect(result[2].role).toBe('tool');
      expect(result[2].content).toBe('Found 3 results');
      expect(result[2].tool_call_id).toBe('tool1');
      expect(result[2].name).toBe('search');
    });

    it('should skip tool calls without results', () => {
      const dbMessages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'agent' as const,
          content: 'Calling tool',
          segments: [
            {
              id: 'seg1',
              type: 'content' as const,
              content: 'Calling tool',
              timestamp: new Date()
            },
            {
              id: 'seg2',
              type: 'tool_call' as const,
              tool_call: {
                id: 'tool1',
                toolName: 'search',
                toolArgs: { query: 'test' }
              },
              timestamp: new Date()
            }
          ],
          createdAt: new Date()
        }
      ];

      const result = loader.convertToLLMMessages(dbMessages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Calling tool');
      expect(result[0].tool_calls).toBeUndefined();
    });

    it('should handle real fixture data', () => {
      const normalizedMessages = conversationFixture.map((msg: any) => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        sender: msg.sender,
        content: msg.content,
        segments: msg.segments ? msg.segments.map((seg: any) => ({
          id: seg.id,
          type: seg.type,
          content: seg.content,
          tool_call: seg.toolCall ? {
            id: seg.toolCall.id,
            toolName: seg.toolCall.name,
            toolArgs: seg.toolCall.input,
            toolResult: seg.toolCall.result,
            error: seg.toolCall.error
          } : undefined,
          timestamp: new Date(seg.timestamp)
        })) : undefined,
        createdAt: new Date(msg.created_at)
      }));

      const result = loader.convertToLLMMessages(normalizedMessages);

      expect(result.length).toBeGreaterThan(0);
      
      const userMessages = result.filter(m => m.role === 'user');
      const assistantMessages = result.filter(m => m.role === 'assistant');
      const toolMessages = result.filter(m => m.role === 'tool');

      expect(userMessages.length).toBeGreaterThan(0);
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(toolMessages.length).toBeGreaterThan(0);

      const assistantWithToolCalls = assistantMessages.filter(m => m.tool_calls && m.tool_calls.length > 0);
      expect(assistantWithToolCalls.length).toBeGreaterThan(0);

      toolMessages.forEach(toolMsg => {
        expect(toolMsg.tool_call_id).toBeDefined();
        expect(toolMsg.name).toBeDefined();
        expect(toolMsg.content).toBeDefined();
      });
    });
  });

  describe('applyTokenLimit', () => {
    it('should keep all messages if under token limit', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Short message 1' },
        { role: 'assistant', content: 'Short response 1' },
        { role: 'user', content: 'Short message 2' },
        { role: 'assistant', content: 'Short response 2' },
      ];

      const result = await loader.applyTokenLimit(messages, 10000);

      expect(result).toHaveLength(4);
      expect(result).toEqual(messages);
    });

    it('should drop oldest messages when over token limit', async () => {
      const longText = 'x'.repeat(1000);
      const messages: any[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: longText },
        { role: 'assistant', content: longText },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      const result = await loader.applyTokenLimit(messages, 100);

      expect(result.length).toBeLessThan(messages.length);
      expect(result[result.length - 1].content).toBe('Recent response');
    });

    it('should include tool calls in token count', async () => {
      const messages: any[] = [
        {
          role: 'assistant',
          content: 'Let me search',
          tool_calls: [
            {
              id: 'tool1',
              type: 'function',
              function: { name: 'search', arguments: JSON.stringify({ query: 'test' }) }
            }
          ]
        },
        { role: 'tool', content: 'Search result', tool_call_id: 'tool1', name: 'search' }
      ];

      const result = await loader.applyTokenLimit(messages, 50);

      expect(result.length).toBeLessThanOrEqual(messages.length);
    });

    it('should always include at least one message', async () => {
      const messages: any[] = [
        { role: 'user', content: 'x'.repeat(10000) },
      ];

      const result = await loader.applyTokenLimit(messages, 10);

      expect(result).toHaveLength(1);
    });

    it('should handle empty message array', async () => {
      const result = await loader.applyTokenLimit([], 1000);

      expect(result).toHaveLength(0);
    });

    it('should use model-based token counting when model name provided', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Test response' },
      ];

      const result = await loader.applyTokenLimit(messages, 10000, 'claude-sonnet-4-6');

      expect(result).toHaveLength(2);
    });
  });

  describe('applyTokenLimit and formatMessagesForAISDK orphan contract', () => {
    it('leaves token-limit orphans in applyTokenLimit output and strips them in formatMessagesForAISDK', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'x'.repeat(1000) },
        {
          role: 'assistant',
          content: 'Calling tool',
          tool_calls: [{
            id: 'call_orphaned',
            type: 'function',
            function: { name: 'readFile', arguments: '{}' },
          }],
        },
        {
          role: 'tool',
          content: 'file contents',
          tool_call_id: 'call_orphaned',
          name: 'readFile',
        },
      ];

      const limited = await loader.applyTokenLimit(messages, 12);

      expect(limited.some(msg => msg.role === 'tool')).toBe(true);
      expect(limited.some(msg => msg.role === 'assistant')).toBe(false);

      const formatted = loader.formatMessagesForAISDK(limited, 'test-app', 'test-agent');

      expect(formatted.filter(msg => msg.role === 'tool')).toHaveLength(0);
    });
  });

  describe('loadMessagesWithTokenLimitByConversationId', () => {
    it('should load and apply token limit by conversation ID', async () => {
      const messages = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user' as const,
          content: 'Hello',
          createdAt: new Date('2025-01-01')
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'agent' as const,
          content: 'Hi there',
          segments: [
            { id: 'seg1', type: 'content' as const, content: 'Hi there', timestamp: new Date() }
          ],
          createdAt: new Date('2025-01-02')
        }
      ];

      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue(messages);

      const result = await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, 'claude-sonnet-4-6');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });

    it('should refresh summary pin when appId is provided', async () => {
      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue([]);
      latestSummary = { id: 'sum-1', summaryText: '# Summary', summaryTokenCount: 100, originalTokenCount: 1000 };
      summaryByIdStore.set('sum-1', latestSummary);

      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      expect(loader.getPinnedSummaryId('test-app')).toBe('sum-1');
    });

    it('should not refresh summary pin when appId is omitted', async () => {
      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue([]);
      latestSummary = { id: 'sum-1', summaryText: '# Summary', summaryTokenCount: 100, originalTokenCount: 1000 };

      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000);

      expect(loader.getPinnedSummaryId('test-app')).toBeNull();
    });
  });

  describe('formatMessagesForAISDK - orphaned tool result detection', () => {
    it('should strip tool results without matching tool calls', () => {
      const llmMessages = [
        // Orphaned tool result (tool call was dropped during token limiting)
        {
          role: 'tool' as const,
          content: 'File content here',
          tool_call_id: 'call_dropped',
          name: 'readFile'
        },
        // Valid assistant message
        {
          role: 'assistant' as const,
          content: ' ',
          tool_calls: [{
            id: 'call_valid',
            type: 'function',
            function: {
              name: 'writeFile',
              arguments: JSON.stringify({ path: 'test.txt', content: 'hello' })
            }
          }]
        },
        // Valid tool result
        {
          role: 'tool' as const,
          content: 'File written',
          tool_call_id: 'call_valid',
          name: 'writeFile'
        },
        // Final assistant response
        {
          role: 'assistant' as const,
          content: 'Done!'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have 3 messages (orphaned tool result stripped)
      expect(result.length).toBe(3);

      // Verify orphaned tool result was removed
      const toolResults = result.filter(msg => msg.role === 'tool');
      expect(toolResults.length).toBe(1);

      // Verify the remaining tool result matches a tool call
      const assistantMessages = result.filter(msg => msg.role === 'assistant');
      const assistantWithToolCall = assistantMessages.find((msg: any) => {
        if (Array.isArray(msg.content)) {
          return msg.content.some((part: any) => part.type === 'tool-call');
        }
        return false;
      });
      expect(assistantWithToolCall).toBeDefined();

      const toolCallPart = (assistantWithToolCall as any).content.find((part: any) => part.type === 'tool-call');
      expect(toolCallPart.toolCallId).toBe('call_valid');

      const toolResult = toolResults[0] as any;
      expect(toolResult.content[0].toolCallId).toBe('call_valid');
    });

    it('should handle multiple orphaned tool results', () => {
      const llmMessages = [
        {
          role: 'tool' as const,
          content: 'Result 1',
          tool_call_id: 'call_1',
          name: 'tool1'
        },
        {
          role: 'tool' as const,
          content: 'Result 2',
          tool_call_id: 'call_2',
          name: 'tool2'
        },
        {
          role: 'assistant' as const,
          content: 'All done'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should only have the assistant message (both tool results stripped)
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('assistant');

      // Verify no tool results remain
      const toolResults = result.filter(msg => msg.role === 'tool');
      expect(toolResults.length).toBe(0);
    });

    it('should preserve valid tool call/result pairs', () => {
      const llmMessages = [
        {
          role: 'assistant' as const,
          content: ' ',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search',
              arguments: JSON.stringify({ query: 'test' })
            }
          }]
        },
        {
          role: 'tool' as const,
          content: 'Search results',
          tool_call_id: 'call_1',
          name: 'search'
        },
        {
          role: 'assistant' as const,
          content: 'Here are the results'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have all 3 messages
      expect(result.length).toBe(3);

      // Verify tool result is preserved
      const toolResults = result.filter(msg => msg.role === 'tool');
      expect(toolResults.length).toBe(1);

      // Verify tool result matches tool call
      const toolResult = toolResults[0] as any;
      expect(toolResult.content[0].toolCallId).toBe('call_1');
      expect(toolResult.content[0].toolName).toBe('search');
    });

    it('should handle mixed valid and orphaned tool results', () => {
      const llmMessages = [
        // Orphaned result
        {
          role: 'tool' as const,
          content: 'Orphaned result',
          tool_call_id: 'call_orphaned',
          name: 'orphanedTool'
        },
        // Valid pair
        {
          role: 'assistant' as const,
          content: ' ',
          tool_calls: [{
            id: 'call_valid',
            type: 'function',
            function: {
              name: 'validTool',
              arguments: JSON.stringify({ arg: 'value' })
            }
          }]
        },
        {
          role: 'tool' as const,
          content: 'Valid result',
          tool_call_id: 'call_valid',
          name: 'validTool'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have 2 messages (orphaned result stripped)
      expect(result.length).toBe(2);

      // Verify only valid tool result remains
      const toolResults = result.filter(msg => msg.role === 'tool');
      expect(toolResults.length).toBe(1);

      const toolResult = toolResults[0] as any;
      expect(toolResult.content[0].toolCallId).toBe('call_valid');
    });

    it('should strip orphaned AIToolMessage tool results without matching tool calls', () => {
      const llmMessages: LLMMessage[] = [
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_orphaned',
            toolName: 'readFile',
            output: { type: 'text', value: 'orphaned result' },
          }],
        },
        {
          role: 'assistant',
          content: ' ',
          tool_calls: [{
            id: 'call_valid',
            type: 'function',
            function: { name: 'writeFile', arguments: '{}' },
          }],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_valid',
            toolName: 'writeFile',
            output: { type: 'text', value: 'ok' },
          }],
        },
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      const toolResults = result.filter(msg => msg.role === 'tool');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).content[0].toolCallId).toBe('call_valid');
    });

    it('should not strip tool results when all tool calls are present', () => {
      const llmMessages = [
        {
          role: 'assistant' as const,
          content: ' ',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'tool1', arguments: '{}' }
            },
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'tool2', arguments: '{}' }
            }
          ]
        },
        {
          role: 'tool' as const,
          content: 'Result 1',
          tool_call_id: 'call_1',
          name: 'tool1'
        },
        {
          role: 'tool' as const,
          content: 'Result 2',
          tool_call_id: 'call_2',
          name: 'tool2'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have all 3 messages
      expect(result.length).toBe(3);

      // Verify both tool results are preserved
      const toolResults = result.filter(msg => msg.role === 'tool');
      expect(toolResults.length).toBe(2);
    });
  });

  describe('formatMessagesForAISDK - orphaned tool call detection', () => {
    it('should strip tool calls without matching tool results', () => {
      const llmMessages = [
        { role: 'user', content: 'Search for something' },
        // Assistant with tool call that never got a result (failed execution)
        { 
          role: 'assistant', 
          content: '',
          tool_calls: [{
            id: 'call_failed',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"test"}' }
          }]
        },
        { role: 'user', content: 'Another message' }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have 2 messages (assistant with failed tool call should be stripped)
      expect(result.length).toBe(2);
      
      // Verify no assistant messages remain (the one with only orphaned tool call was removed)
      const assistantMessages = result.filter(msg => msg.role === 'assistant');
      expect(assistantMessages.length).toBe(0);
    });

    it('should strip only orphaned tool calls from assistant messages with mixed content', () => {
      const llmMessages = [
        { role: 'user', content: 'Do two things' },
        { 
          role: 'assistant', 
          content: 'Let me help with that',
          tool_calls: [
            {
              id: 'call_success',
              type: 'function',
              function: { name: 'readFile', arguments: '{"path":"file.txt"}' }
            },
            {
              id: 'call_failed',
              type: 'function',
              function: { name: 'writeFile', arguments: '{"path":"file.txt","content":"test"}' }
            }
          ]
        },
        // Only one tool result (the other call failed)
        { 
          role: 'tool', 
          content: 'File content here',
          tool_call_id: 'call_success',
          name: 'readFile'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have 3 messages (user, assistant, tool)
      expect(result.length).toBe(3);
      
      // Verify assistant message has only one tool call (the failed one was stripped)
      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      expect(assistantMsg).toBeDefined();
      
      const toolCallParts = assistantMsg.content.filter((part: any) => part.type === 'tool-call');
      expect(toolCallParts.length).toBe(1);
      expect(toolCallParts[0].toolCallId).toBe('call_success');
    });

    it('should preserve assistant messages with text content after stripping all orphaned tool calls', () => {
      const llmMessages = [
        { role: 'user', content: 'Search for something' },
        { 
          role: 'assistant', 
          content: 'I tried to search but it failed',
          tool_calls: [{
            id: 'call_failed',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"test"}' }
          }]
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have 2 messages (user and assistant with just text)
      expect(result.length).toBe(2);
      
      // Verify assistant message exists with only text content
      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toHaveLength(1);
      expect(assistantMsg.content[0].type).toBe('text');
      expect(assistantMsg.content[0].text).toBe('I tried to search but it failed');
    });

    it('should handle multiple orphaned tool calls', () => {
      const llmMessages = [
        { role: 'user', content: 'Do three things' },
        { 
          role: 'assistant', 
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'tool1', arguments: '{}' }
            },
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'tool2', arguments: '{}' }
            }
          ]
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should only have the user message (assistant with only orphaned tool calls was removed)
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
    });

    it('should preserve valid tool call/result pairs while stripping orphaned calls', () => {
      const llmMessages = [
        { role: 'user', content: 'Do things' },
        { 
          role: 'assistant', 
          content: 'Working on it',
          tool_calls: [
            {
              id: 'call_valid',
              type: 'function',
              function: { name: 'readFile', arguments: '{"path":"file.txt"}' }
            },
            {
              id: 'call_orphaned',
              type: 'function',
              function: { name: 'writeFile', arguments: '{"path":"file.txt","content":"test"}' }
            }
          ]
        },
        { 
          role: 'tool', 
          content: 'File content',
          tool_call_id: 'call_valid',
          name: 'readFile'
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      // Should have 3 messages
      expect(result.length).toBe(3);
      
      // Verify assistant has only valid tool call
      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      const toolCallParts = assistantMsg.content.filter((part: any) => part.type === 'tool-call');
      expect(toolCallParts.length).toBe(1);
      expect(toolCallParts[0].toolCallId).toBe('call_valid');
      
      // Verify tool result is preserved
      const toolMsg = result.find(msg => msg.role === 'tool') as any;
      expect(toolMsg.content[0].toolCallId).toBe('call_valid');
    });
  });

  describe('formatMessagesForAISDK - tool ID sanitization for Anthropic compatibility', () => {
    const kimiPairMessages = (): LLMMessage[] => [
      {
        role: 'assistant',
        content: ' ',
        tool_calls: [{
          id: 'functions.tools_readFile:9',
          type: 'function',
          function: { name: 'readFile', arguments: '{"path":"a.txt"}' }
        }]
      },
      {
        role: 'tool',
        content: 'file body',
        tool_call_id: 'functions.tools_readFile:9',
        name: 'readFile'
      }
    ];

    it('sanitizes Kimi/LiteLLM-style tool IDs when target is an Anthropic model', () => {
      const result = loader.formatMessagesForAISDK(
        kimiPairMessages(),
        'test-app',
        'test-agent',
        'claude-sonnet-4-6',
      );

      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      const toolCallPart = assistantMsg.content.find((part: any) => part.type === 'tool-call');
      const toolMsg = result.find(msg => msg.role === 'tool') as any;

      expect(toolCallPart.toolCallId).toBe('functions_tools_readFile_9');
      expect(toolMsg.content[0].toolCallId).toBe('functions_tools_readFile_9');
      expect(toolCallPart.toolCallId).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('leaves Kimi-style tool IDs untouched when the target is the same OpenAI-compatible provider', () => {
      const result = loader.formatMessagesForAISDK(
        kimiPairMessages(),
        'test-app',
        'test-agent',
        'azure/kimi-k2.6',
      );

      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      const toolCallPart = assistantMsg.content.find((part: any) => part.type === 'tool-call');
      const toolMsg = result.find(msg => msg.role === 'tool') as any;

      expect(toolCallPart.toolCallId).toBe('functions.tools_readFile:9');
      expect(toolMsg.content[0].toolCallId).toBe('functions.tools_readFile:9');
    });

    it('falls back to sanitizing when no target model is provided', () => {
      const result = loader.formatMessagesForAISDK(kimiPairMessages(), 'test-app', 'test-agent');

      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      const toolCallPart = assistantMsg.content.find((part: any) => part.type === 'tool-call');
      expect(toolCallPart.toolCallId).toBe('functions_tools_readFile_9');
    });

    it('preserves the assistant→tool pairing after sanitization', () => {
      const result = loader.formatMessagesForAISDK(
        kimiPairMessages(),
        'test-app',
        'test-agent',
        'claude-sonnet-4-6',
      );

      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      const toolCallId = assistantMsg.content.find((p: any) => p.type === 'tool-call').toolCallId;
      const toolMsg = result.find(msg => msg.role === 'tool') as any;
      expect(toolMsg.content[0].toolCallId).toBe(toolCallId);
      expect(result.length).toBe(2);
    });

    it('leaves already-valid Anthropic tool IDs untouched', () => {
      const id = 'toolu_bdrk_014madvBmvYNvN2jPSdyEiGP';
      const llmMessages: LLMMessage[] = [
        {
          role: 'assistant',
          content: ' ',
          tool_calls: [{
            id,
            type: 'function',
            function: { name: 'readFile', arguments: '{}' }
          }]
        },
        { role: 'tool', content: 'ok', tool_call_id: id, name: 'readFile' }
      ];

      const result = loader.formatMessagesForAISDK(
        llmMessages,
        'test-app',
        'test-agent',
        'claude-sonnet-4-6',
      );

      const assistantMsg = result.find(msg => msg.role === 'assistant') as any;
      const toolMsg = result.find(msg => msg.role === 'tool') as any;
      expect(assistantMsg.content.find((p: any) => p.type === 'tool-call').toolCallId).toBe(id);
      expect(toolMsg.content[0].toolCallId).toBe(id);
    });
  });

  describe('sanitizeToolUseId', () => {
    it('replaces all non-conformant characters with underscores', () => {
      expect(sanitizeToolUseId('functions.tools_readFile:9')).toBe('functions_tools_readFile_9');
      expect(sanitizeToolUseId('a/b c+d=e')).toBe('a_b_c_d_e');
    });

    it('returns conformant IDs unchanged', () => {
      expect(sanitizeToolUseId('toolu_01ABCxyz-789')).toBe('toolu_01ABCxyz-789');
      expect(sanitizeToolUseId('call_abc123')).toBe('call_abc123');
    });

    it('is deterministic so paired IDs collapse to the same value', () => {
      const a = sanitizeToolUseId('functions.tools_readFile:9');
      const b = sanitizeToolUseId('functions.tools_readFile:9');
      expect(a).toBe(b);
    });
  });

  describe('formatMessagesForAISDK - cachePoint to providerOptions conversion', () => {
    it('should convert cachePoint on user messages to providerOptions', () => {
      const llmMessages: LLMMessage[] = [
        {
          role: 'user',
          content: '[CONVERSATION SUMMARY]\n# Summary text',
          cachePoint: { type: 'ephemeral' }
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.role).toBe('user');
      expect(msg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    });

    it('should not add providerOptions when cachePoint is absent', () => {
      const llmMessages: LLMMessage[] = [
        { role: 'user', content: 'Hello' }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.providerOptions).toBeUndefined();
    });

    it('should convert cachePoint on system messages to providerOptions', () => {
      const llmMessages: LLMMessage[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant',
          cachePoint: { type: 'ephemeral' }
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.role).toBe('system');
      expect(msg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    });

    it('should convert cachePoint on assistant messages to providerOptions', () => {
      const llmMessages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Here is my response',
          cachePoint: { type: 'ephemeral' }
        }
      ];

      const result = loader.formatMessagesForAISDK(llmMessages, 'test-app', 'test-agent');

      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.role).toBe('assistant');
      expect(msg.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    });
  });

  describe('formatMessagesForAISDK - reasoning content exclusion', () => {
    it('does not emit reasoning parts when rebuilding persisted conversation history', () => {
      const llmMessages: LLMMessage[] = [
        { role: 'user', content: 'Do something' },
        {
          role: 'assistant',
          content: 'I will read the file.',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'readFile', arguments: '{"path":"a.txt"}' }
          }]
        },
        {
          role: 'tool',
          content: 'file contents',
          tool_call_id: 'call_1',
          name: 'readFile'
        },
        { role: 'assistant', content: 'Done.' }
      ];

      const result = loader.formatMessagesForAISDK(
        llmMessages,
        'test-app',
        'test-agent',
        'azure/Kimi-K2.6-thinking',
      );

      for (const message of result) {
        if (message.role !== 'assistant' || !Array.isArray(message.content)) {
          continue;
        }
        expect(message.content.every((part) => part.type !== 'reasoning')).toBe(true);
      }
    });
  });

  describe('summary pinning via loadMessagesWithTokenLimitByConversationId', () => {
    const summary1 = {
      id: 'sum-1',
      summaryText: '# Summary v1',
      summaryTokenCount: 100,
      originalTokenCount: 1000,
      messageRangeStart: 'm1',
      messageRangeEnd: 'm1'
    };
    const summary2 = {
      id: 'sum-2',
      summaryText: '# Summary v2',
      summaryTokenCount: 150,
      originalTokenCount: 1500,
      messageRangeStart: 'm1',
      messageRangeEnd: 'm3'
    };

    beforeEach(() => {
      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue([
        { id: 'm2', conversationId: 'conv1', sender: 'agent' as const, content: 'hi', createdAt: new Date('2025-01-02') }
      ]);
    });

    it('should pin summary on first load and reuse it on subsequent loads', async () => {
      latestSummary = summary1;
      summaryByIdStore.set(summary1.id, summary1);
      summaryByIdStore.set(summary2.id, summary2);
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      // Switch the "latest" to v2 - simulates BackgroundSummarizer creating a new summary
      latestSummary = summary2;
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      // Should still use v1 because it's pinned
      expect(loader.getPinnedSummaryId('test-app')).toBe('sum-1');
    });

    it('should expose pinned summary ID via getPinnedSummaryId()', async () => {
      expect(loader.getPinnedSummaryId('test-app')).toBeNull();

      latestSummary = summary1;
      summaryByIdStore.set(summary1.id, summary1);
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      expect(loader.getPinnedSummaryId('test-app')).toBe('sum-1');
    });

    it('should refresh pin after MAX_PINNED_TURNS', async () => {
      latestSummary = summary1;
      summaryByIdStore.set(summary1.id, summary1);
      summaryByIdStore.set(summary2.id, summary2);
      // Exhaust the epoch
      for (let i = 0; i < ConversationHistoryLoader.MAX_PINNED_TURNS; i++) {
        await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');
      }

      // Now switch to v2 and load again - epoch should have expired
      latestSummary = summary2;
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      expect(loader.getPinnedSummaryId('test-app')).toBe('sum-2');
    });

    it('should fall back to latest when pinned summary is deleted', async () => {
      latestSummary = summary1;
      summaryByIdStore.set(summary1.id, summary1);
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      // Pin is set to sum-1, but now sum-1 is deleted and sum-2 is latest
      summaryByIdStore.delete(summary1.id);
      summaryByIdStore.set(summary2.id, summary2);
      latestSummary = summary2;
      // findById returns null for sum-1 because it was deleted from summaryStore
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');

      // Should fall back to latest (sum-2) and re-pin
      expect(loader.getPinnedSummaryId('test-app')).toBe('sum-2');
    });
  });

  describe('stable region compression via loadMessagesWithTokenLimitByConversationId', () => {
    it('should track previousTurnMessageCount and pass as stableRegionEnd', async () => {
      const compressSpy = vi.spyOn(loader.getCompressor(), 'compressMessages');

      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue([
        { id: 'm1', conversationId: 'conv1', sender: 'user' as const, content: 'hello', createdAt: new Date('2025-01-01') },
        { id: 'm2', conversationId: 'conv1', sender: 'agent' as const, content: 'hi there', createdAt: new Date('2025-01-02') }
      ]);

      // First call: no previous count, stableRegionEnd should be undefined
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');
      const firstCall = compressSpy.mock.calls[0];
      expect(firstCall[2]).toBeUndefined(); // No stable region on first call

      // Second call: should pass previous turn's post-token-limit count as stableRegionEnd
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000, undefined, true, 'test-app');
      const secondCall = compressSpy.mock.calls[1];
      // stableRegionEnd should be min(previousCount, currentCount) = 2
      expect(secondCall[2]).toBe(2);

      compressSpy.mockRestore();
    });

    it('should not track stable region when appId is omitted', async () => {
      const compressSpy = vi.spyOn(loader.getCompressor(), 'compressMessages');

      vi.mocked(mockMessageStore.getMessagesForHistory).mockResolvedValue([
        { id: 'm1', conversationId: 'conv1', sender: 'user' as const, content: 'hello', createdAt: new Date('2025-01-01') },
        { id: 'm2', conversationId: 'conv1', sender: 'agent' as const, content: 'hi there', createdAt: new Date('2025-01-02') }
      ]);

      // Two calls without appId - stableRegionEnd should always be undefined
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000);
      await loader.loadMessagesWithTokenLimitByConversationId('conv1', 40000);

      expect(compressSpy.mock.calls[0][2]).toBeUndefined();
      expect(compressSpy.mock.calls[1][2]).toBeUndefined();

      compressSpy.mockRestore();
    });
  });
});
