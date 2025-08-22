import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConversationContextManager } from '../ConversationContextManager.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import type { ConversationMessage } from '../../database/schema.js';

// Mock the ConversationRepository
vi.mock('../../database/repositories/ConversationRepository.js');

describe('ConversationContextManager', () => {
  let contextManager: ConversationContextManager;
  let mockConversationRepo: vi.Mocked<ConversationRepository>;

  beforeEach(() => {
    mockConversationRepo = {
      getMessages: vi.fn(),
    } as any;
    
    contextManager = new ConversationContextManager(mockConversationRepo, 5);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should build messages with system prompt and current user message only when no conversation ID', async () => {
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Hello, how are you?';

    // Mock console.log to avoid debug output in tests
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const messages = await contextManager.buildMessages(systemPrompt, userMessage);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: systemPrompt
    });
    expect(messages[1]).toEqual({
      role: 'user',
      content: userMessage
    });
    expect(mockConversationRepo.getMessages).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should include conversation history when conversation ID is provided', async () => {
    const conversationId = 'test-conv-123';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'What did we discuss earlier?';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'user',
        content: 'Hello, tell me about TypeScript',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:00:00Z')
      },
      {
        id: 'msg2', 
        conversationId,
        sender: 'agent',
        content: 'TypeScript is a typed superset of JavaScript...',
        createdAt: new Date('2025-01-01T10:01:00Z'),
        updatedAt: new Date('2025-01-01T10:01:00Z')
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const messages = await contextManager.buildMessages(systemPrompt, userMessage, conversationId);

    expect(mockConversationRepo.getMessages).toHaveBeenCalledWith(conversationId);
    expect(messages).toHaveLength(4); // system + user + agent + current user
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('Hello, tell me about TypeScript');
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toBe('TypeScript is a typed superset of JavaScript...');
    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toBe('What did we discuss earlier?');
    
    consoleSpy.mockRestore();
  });

  it('should handle messages with tool calls', async () => {
    const conversationId = 'test-conv-456';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Current message';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'user',
        content: 'List files in current directory',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:00:00Z')
      },
      {
        id: 'msg2',
        conversationId,
        sender: 'agent',
        content: 'I will list the files for you.',
        toolCalls: [
          {
            id: 'call_123',
            tool_name: 'list_files',
            tool_args: { path: '.' },
            tool_result: 'file1.txt\\nfile2.js\\npackage.json',
            status: 'success' as const
          }
        ],
        createdAt: new Date('2025-01-01T10:01:00Z'),
        updatedAt: new Date('2025-01-01T10:01:00Z')
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const messages = await contextManager.buildMessages(systemPrompt, userMessage, conversationId);

    expect(messages).toHaveLength(5); // system + user + assistant with tool calls + tool result + current user
    
    const assistantMessage = messages[2];
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.tool_calls).toBeDefined();
    expect(assistantMessage.tool_calls![0]).toEqual({
      id: 'call_123',
      type: 'function',
      function: {
        name: 'list_files',
        arguments: JSON.stringify({ path: '.' })
      }
    });

    const toolMessage = messages[3];
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toBe('file1.txt\\nfile2.js\\npackage.json');
    expect(toolMessage.tool_call_id).toBe('call_123');
    expect(toolMessage.name).toBe('list_files');
    
    consoleSpy.mockRestore();
  });

  it('should limit messages to the configured maximum', async () => {
    const contextManagerWithLimit = new ConversationContextManager(mockConversationRepo, 2);
    const conversationId = 'test-conv-789';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Current message';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create many messages to test the limit
    const mockMessages: ConversationMessage[] = [];
    for (let i = 1; i <= 10; i++) {
      mockMessages.push({
        id: `msg${i}`,
        conversationId,
        sender: i % 2 === 1 ? 'user' : 'agent',
        content: `Message ${i}`,
        createdAt: new Date(`2025-01-01T10:0${i}:00Z`),
        updatedAt: new Date(`2025-01-01T10:0${i}:00Z`)
      });
    }

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const messages = await contextManagerWithLimit.buildMessages(systemPrompt, userMessage, conversationId);

    // Should have: system + (limited history) + current user
    // With limit of 2, should include system + at most 2 history messages + current user
    expect(messages.length).toBeLessThanOrEqual(1 + 2 + 1); // system + max history + current
    expect(messages[0].role).toBe('system');
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toBe('Current message');
    
    consoleSpy.mockRestore();
  });

  it('should provide conversation summary', async () => {
    const conversationId = 'test-conv-summary';
    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'user',
        content: 'Message 1',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'msg2',
        conversationId,
        sender: 'agent', 
        content: 'Message 2',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'msg3',
        conversationId,
        sender: 'user',
        content: 'Message 3',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const summary = await contextManager.getConversationSummary(conversationId);

    expect(summary.totalMessages).toBe(3);
    expect(summary.messageTypes).toEqual({
      user: 2,
      agent: 1
    });
  });

  it('should handle empty content validation', async () => {
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Valid message';

    // Test empty system prompt
    await expect(
      contextManager.buildMessages('', userMessage)
    ).rejects.toThrow('System prompt cannot be empty');

    // Test empty user message  
    await expect(
      contextManager.buildMessages(systemPrompt, '')
    ).rejects.toThrow('Current user message cannot be empty');

    // Test with whitespace only
    await expect(
      contextManager.buildMessages('   ', userMessage)
    ).rejects.toThrow('System prompt cannot be empty');
  });

  it('should filter out messages with empty content from conversation history', async () => {
    const conversationId = 'test-conv-empty';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Current message';

    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'user',
        content: 'Valid user message',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'msg2',
        conversationId,
        sender: 'agent',
        content: '', // Empty content - should be filtered
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'msg3',
        conversationId,
        sender: 'user',
        content: '   ', // Whitespace only - should be filtered  
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'msg4',
        conversationId,
        sender: 'agent',
        content: 'Valid agent message',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    // Mock console methods to avoid output during tests
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const messages = await contextManager.buildMessages(systemPrompt, userMessage, conversationId);

    // Should have: system + valid user + valid agent + current user = 4 messages
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('Valid user message');
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toBe('Valid agent message');
    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toBe('Current message');

    // Verify empty messages were warned about
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping message msg2 with empty content')
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping message msg3 with empty content')
    );

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should filter out tool calls without results to prevent Bedrock errors', async () => {
    const conversationId = 'test-conv-tool-filter';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Current message';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'user',
        content: 'Please run a command',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'msg2',
        conversationId,
        sender: 'agent',
        content: 'I will run that command for you.',
        toolCalls: [
          {
            id: 'call_with_result',
            tool_name: 'run_command',
            tool_args: { command: 'ls' },
            tool_result: 'file1.txt\nfile2.js',
            status: 'success' as const
          },
          {
            id: 'call_without_result',
            tool_name: 'incomplete_command',
            tool_args: { command: 'sleep 10' },
            status: 'running' as const
            // No tool_result - this should be filtered out
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const messages = await contextManager.buildMessages(systemPrompt, userMessage, conversationId);

    // Should have: system + user + assistant with only tool calls that have results + tool result + current user
    expect(messages).toHaveLength(5);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('assistant');
    
    // Assistant message should only have the tool call with result
    expect(messages[2].tool_calls).toHaveLength(1);
    expect(messages[2].tool_calls![0].id).toBe('call_with_result');
    
    // Should have corresponding tool result message
    expect(messages[3].role).toBe('tool');
    expect(messages[3].tool_call_id).toBe('call_with_result');
    expect(messages[3].content).toBe('file1.txt\nfile2.js');
    
    // Current user message
    expect(messages[4].role).toBe('user');
    expect(messages[4].content).toBe('Current message');

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should filter out segments with tool calls without results', async () => {
    const conversationId = 'test-conv-segment-filter';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Current message';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'agent',
        content: 'I will help you with that.',
        segments: [
          {
            id: 'seg_1',
            type: 'content',
            content: 'I will help you with that.',
            timestamp: new Date('2025-01-01T10:00:00Z')
          },
          {
            id: 'seg_2',
            type: 'tool_call',
            tool_call: {
              id: 'call_complete',
              tool_name: 'complete_tool',
              tool_args: {},
              tool_result: 'Success!',
              status: 'success'
            },
            timestamp: new Date('2025-01-01T10:01:00Z')
          },
          {
            id: 'seg_3',
            type: 'tool_call',
            tool_call: {
              id: 'call_incomplete',
              tool_name: 'incomplete_tool',
              tool_args: {},
              status: 'running'
              // No tool_result - should be filtered
            },
            timestamp: new Date('2025-01-01T10:02:00Z')
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const messages = await contextManager.buildMessages(systemPrompt, userMessage, conversationId);

    // Should have: system + assistant with only complete tool calls + tool result + current user
    expect(messages).toHaveLength(4);
    
    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls![0].id).toBe('call_complete');
    
    // Should have warning about skipped tool call
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping tool call call_incomplete without result')
    );

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should handle string timestamps in segments from database', async () => {
    const conversationId = 'test-conv-string-timestamps';
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Current message';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockMessages: ConversationMessage[] = [
      {
        id: 'msg1',
        conversationId,
        sender: 'agent',
        content: 'Processing your request.',
        segments: [
          {
            id: 'seg_1',
            type: 'content',
            content: 'Processing your request.',
            timestamp: '2025-01-01T10:00:00Z' as any // String timestamp from DB
          },
          {
            id: 'seg_2',
            type: 'tool_call',
            tool_call: {
              id: 'call_string_test',
              tool_name: 'string_test_tool',
              tool_args: {},
              tool_result: 'Success!',
              status: 'success'
            },
            timestamp: '2025-01-01T10:01:00Z' as any // String timestamp from DB
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    // Should not throw error despite string timestamps
    const messages = await contextManager.buildMessages(systemPrompt, userMessage, conversationId);

    expect(messages).toHaveLength(4); // system + assistant + tool + current user
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Processing your request.');
    expect(messages[2].role).toBe('tool');
    expect(messages[2].tool_call_id).toBe('call_string_test');

    consoleSpy.mockRestore();
  });
});