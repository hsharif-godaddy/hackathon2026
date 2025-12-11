import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationHistoryLoader } from '../ConversationHistoryLoader.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import conversationFixture from './fixtures/conversation-messages.json';

describe('ConversationHistoryLoader', () => {
  let loader: ConversationHistoryLoader;
  let mockRepo: ConversationRepository;

  beforeEach(() => {
    mockRepo = {
      findByAppAndAgent: vi.fn(),
      getMessagesForHistory: vi.fn(),
    } as any;

    loader = new ConversationHistoryLoader(mockRepo);
  });

  describe('loadDatabaseMessages', () => {
    it('should load and sort messages from multiple conversations', async () => {
      vi.mocked(mockRepo.findByAppAndAgent).mockResolvedValue([
        { id: 'D5wI4wo3ThTl', appId: 'test-app', agentId: 'develop', createdAt: new Date(), updatedAt: new Date() }
      ]);

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
            tool_name: seg.toolCall.name,
            tool_args: seg.toolCall.input,
            tool_result: seg.toolCall.result,
            error: seg.toolCall.error
          } : undefined,
          timestamp: new Date(seg.timestamp)
        })) : undefined,
        createdAt: new Date(msg.created_at)
      }));

      vi.mocked(mockRepo.getMessagesForHistory).mockResolvedValue(normalizedMessages);

      const result = await loader.loadDatabaseMessages('test-app', 'develop');

      expect(result).toHaveLength(4);
      expect(result[0].sender).toBe('user');
      expect(result[1].sender).toBe('agent');
      expect(mockRepo.findByAppAndAgent).toHaveBeenCalledWith('test-app', 'develop');
      expect(mockRepo.getMessagesForHistory).toHaveBeenCalledWith('D5wI4wo3ThTl');
    });

    it('should sort messages chronologically (oldest first)', async () => {
      vi.mocked(mockRepo.findByAppAndAgent).mockResolvedValue([
        { id: 'conv1', appId: 'test-app', agentId: 'develop', createdAt: new Date(), updatedAt: new Date() }
      ]);

      const messages = [
        { id: '3', conversationId: 'conv1', sender: 'user' as const, content: 'msg3', createdAt: new Date('2025-01-03') },
        { id: '1', conversationId: 'conv1', sender: 'user' as const, content: 'msg1', createdAt: new Date('2025-01-01') },
        { id: '2', conversationId: 'conv1', sender: 'user' as const, content: 'msg2', createdAt: new Date('2025-01-02') },
      ];

      vi.mocked(mockRepo.getMessagesForHistory).mockResolvedValue(messages);

      const result = await loader.loadDatabaseMessages('test-app', 'develop');

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
                tool_name: 'search',
                tool_args: { query: 'test' },
                tool_result: 'Found 3 results'
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
                tool_name: 'search',
                tool_args: { query: 'test' }
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
            tool_name: seg.toolCall.name,
            tool_args: seg.toolCall.input,
            tool_result: seg.toolCall.result,
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
    it('should keep all messages if under token limit', () => {
      const messages: any[] = [
        { role: 'user', content: 'Short message 1' },
        { role: 'assistant', content: 'Short response 1' },
        { role: 'user', content: 'Short message 2' },
        { role: 'assistant', content: 'Short response 2' },
      ];

      const result = loader.applyTokenLimit(messages, 10000);

      expect(result).toHaveLength(4);
      expect(result).toEqual(messages);
    });

    it('should drop oldest messages when over token limit', () => {
      const longText = 'x'.repeat(1000);
      const messages: any[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: longText },
        { role: 'assistant', content: longText },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      const result = loader.applyTokenLimit(messages, 100);

      expect(result.length).toBeLessThan(messages.length);
      expect(result[result.length - 1].content).toBe('Recent response');
    });

    it('should include tool calls in token count', () => {
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

      const result = loader.applyTokenLimit(messages, 50);

      expect(result.length).toBeLessThanOrEqual(messages.length);
    });

    it('should always include at least one message', () => {
      const messages: any[] = [
        { role: 'user', content: 'x'.repeat(10000) },
      ];

      const result = loader.applyTokenLimit(messages, 10);

      expect(result).toHaveLength(1);
    });

    it('should handle empty message array', () => {
      const result = loader.applyTokenLimit([], 1000);

      expect(result).toHaveLength(0);
    });

    it('should use model-based token counting when model name provided', () => {
      const messages: any[] = [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Test response' },
      ];

      const result = loader.applyTokenLimit(messages, 10000, 'claude4');

      expect(result).toHaveLength(2);
    });
  });

  describe('loadMessagesWithTokenLimit', () => {
    it('should load and apply token limit in one operation', async () => {
      vi.mocked(mockRepo.findByAppAndAgent).mockResolvedValue([
        { id: 'conv1', appId: 'test-app', agentId: 'develop', createdAt: new Date(), updatedAt: new Date() }
      ]);

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

      vi.mocked(mockRepo.getMessagesForHistory).mockResolvedValue(messages);

      const result = await loader.loadMessagesWithTokenLimit('test-app', 'develop', 40000, 'claude4');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });

    it('should use default max tokens of 40000', async () => {
      vi.mocked(mockRepo.findByAppAndAgent).mockResolvedValue([
        { id: 'conv1', appId: 'test-app', agentId: 'develop', createdAt: new Date(), updatedAt: new Date() }
      ]);

      vi.mocked(mockRepo.getMessagesForHistory).mockResolvedValue([]);

      await loader.loadMessagesWithTokenLimit('test-app', 'develop');

      expect(mockRepo.findByAppAndAgent).toHaveBeenCalledWith('test-app', 'develop');
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
});
