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

      expect(result).toHaveLength(2);
      
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Let me search');
      expect(result[0].tool_calls).toHaveLength(1);
      expect(result[0].tool_calls![0]).toEqual({
        id: 'tool1',
        type: 'function',
        function: {
          name: 'search',
          arguments: JSON.stringify({ query: 'test' })
        }
      });

      expect(result[1].role).toBe('tool');
      expect(result[1].content).toBe('Found 3 results');
      expect(result[1].tool_call_id).toBe('tool1');
      expect(result[1].name).toBe('search');
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
});
