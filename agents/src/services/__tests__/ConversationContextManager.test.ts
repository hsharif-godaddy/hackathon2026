import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConversationContextManager } from '../ConversationContextManager.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import type { ConversationMessage } from '../../database/schema.js';
import type { AgentExecutionContext } from '../../base/agent.interface.js';

// Mock dependencies
vi.mock('../../database/repositories/ConversationRepository.js');
vi.mock('../../logging/index.js', () => {
  const mockLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    logger: mockLogger,
    Logger: { create: vi.fn(() => mockLogger) },
  };
});
vi.mock('../../logging/events/index.js', () => ({
  conversationContextEvents: { buildSuccess: vi.fn() }
}));
vi.mock('../ConversationHistoryLoader.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    ConversationHistoryLoader: vi.fn().mockImplementation(() => ({
      registerCompressionStrategy: vi.fn(),
      loadMessagesWithSummarization: vi.fn().mockResolvedValue({ messages: [] }),
    })),
  };
});
vi.mock('../AppContextManager.js', () => ({
  AppContextManager: vi.fn().mockImplementation(() => ({
    generateContextMessage: vi.fn().mockResolvedValue({
      stableContext: null,
      secretsContext: null,
      mediaSlotsContext: null
    }),
  })),
}));
vi.mock('../TodoContextManager.js', () => ({
  TodoContextManager: vi.fn().mockImplementation(() => ({
    generateTodoContext: vi.fn().mockResolvedValue(null),
  })),
}));

// Import after mocks
const { ConversationHistoryLoader } = await import('../ConversationHistoryLoader.js');
const { AppContextManager } = await import('../AppContextManager.js');
const { TodoContextManager } = await import('../TodoContextManager.js');

function createExecutionContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    metadata: { appId: 'test-app-id' },
    ...overrides,
  } as AgentExecutionContext;
}

describe('ConversationContextManager', () => {
  let contextManager: ConversationContextManager;
  let mockConversationRepo: vi.Mocked<ConversationRepository>;
  let mockHistoryLoader: any;
  let mockAppContextManager: any;
  let mockTodoContextManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConversationRepo = {
      getMessages: vi.fn(),
    } as any;

    contextManager = new ConversationContextManager(mockConversationRepo, 5);

    // Get mock instances from constructors
    mockHistoryLoader = vi.mocked(ConversationHistoryLoader).mock.results.at(-1)?.value;
    mockAppContextManager = vi.mocked(AppContextManager).mock.results.at(-1)?.value;
    mockTodoContextManager = vi.mocked(TodoContextManager).mock.results.at(-1)?.value;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should build messages with system prompt and current user message only when no conversation ID', async () => {
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Hello, how are you?';

    const messages = await contextManager.buildMessages(systemPrompt, userMessage);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: systemPrompt });
    expect(messages[1]).toEqual({ role: 'user', content: userMessage });
    expect(mockHistoryLoader.loadMessagesWithSummarization).not.toHaveBeenCalled();
  });

  it('should not load conversation history without executionContext (no appId)', async () => {
    const messages = await contextManager.buildMessages(
      'You are a helpful assistant',
      'What did we discuss?',
      'test-conv-123'
    );

    // Without executionContext, loadConversationHistoryCompressed returns empty
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('What did we discuss?');
    // History loader should NOT be called (missing appId)
    expect(mockHistoryLoader.loadMessagesWithSummarization).not.toHaveBeenCalled();
  });

  it('should load conversation history when executionContext with appId is provided', async () => {
    mockHistoryLoader.loadMessagesWithSummarization.mockResolvedValue({
      messages: [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ]
    });

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt',
      'Current message',
      'test-conv-123',
      undefined,
      executionContext
    );

    expect(mockHistoryLoader.loadMessagesWithSummarization).toHaveBeenCalledWith(
      'test-app-id', 40000, undefined, true, true
    );
    // system + 2 history + current user = 4
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Previous question' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Previous answer' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Current message' });
  });

  it('should insert stable context before conversation history', async () => {
    mockAppContextManager.generateContextMessage.mockResolvedValue({
      stableContext: '[Current Project Context]\nstable content',
      secretsContext: null,
      mediaSlotsContext: null
    });

    mockHistoryLoader.loadMessagesWithSummarization.mockResolvedValue({
      messages: [
        { role: 'user', content: 'History message 1' },
        { role: 'assistant', content: 'History message 2' },
      ]
    });

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt',
      'Current message',
      'test-conv-123',
      undefined,
      executionContext
    );

    // system + stable context + 2 history + current = 5
    expect(messages).toHaveLength(5);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('[Current Project Context]');
    expect(messages[2]).toEqual({ role: 'user', content: 'History message 1' });
    expect(messages[3]).toEqual({ role: 'assistant', content: 'History message 2' });
    expect(messages[4]).toEqual({ role: 'user', content: 'Current message' });
  });

  it('should include tool call messages from history', async () => {
    mockHistoryLoader.loadMessagesWithSummarization.mockResolvedValue({
      messages: [
        { role: 'user', content: 'Build a page' },
        {
          role: 'assistant',
          content: 'I will create the file.',
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'writeFile', arguments: '{}' } }]
        },
        { role: 'tool', content: 'File created', tool_call_id: 'tc1', name: 'writeFile' },
      ]
    });

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt', 'Next step', 'conv-1', undefined, executionContext
    );

    // system + 3 history + current user = 5
    expect(messages).toHaveLength(5);
    expect(messages[2].role).toBe('assistant');
    expect((messages[2] as any).tool_calls).toHaveLength(1);
    expect(messages[3].role).toBe('tool');
  });

  it('should filter out empty content messages', async () => {
    mockHistoryLoader.loadMessagesWithSummarization.mockResolvedValue({
      messages: [
        { role: 'user', content: 'Valid message' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'Another valid message' },
      ]
    });

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt', 'Current', 'conv-1', undefined, executionContext
    );

    // system + 2 valid history (empty assistant filtered) + current user = 4
    expect(messages).toHaveLength(4);
    expect(messages.every(m => {
      const content = typeof m.content === 'string' ? m.content : '';
      return content.trim() !== '';
    })).toBe(true);
  });

  it('should include app context when executionContext is provided', async () => {
    mockAppContextManager.generateContextMessage.mockResolvedValue({
      stableContext: '[Current Project Structure]\nindex.html\nstyle.css',
      secretsContext: null,
      mediaSlotsContext: null
    });

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt', 'Build a page', undefined, undefined, executionContext
    );

    expect(mockAppContextManager.generateContextMessage).toHaveBeenCalledWith(executionContext);
    // system + app context + current user = 3
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toContain('[Current Project Structure]');
  });

  it('should include todo context when executionContext is provided', async () => {
    mockTodoContextManager.generateTodoContext.mockResolvedValue('[Current Todo List]\n- [ ] Task 1');

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt', 'What are my tasks?', undefined, undefined, executionContext, 'todo-list-1'
    );

    expect(mockTodoContextManager.generateTodoContext).toHaveBeenCalledWith(executionContext, 'todo-list-1');
    expect(messages.some(m => typeof m.content === 'string' && m.content.includes('[Current Todo List]'))).toBe(true);
  });

  it('should gracefully handle history loader errors', async () => {
    mockHistoryLoader.loadMessagesWithSummarization.mockRejectedValue(new Error('DB connection failed'));

    const executionContext = createExecutionContext();
    const messages = await contextManager.buildMessages(
      'System prompt', 'Current message', 'conv-1', undefined, executionContext
    );

    // Should still return system + current user (error caught internally)
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('Current message');
  });

  it('should provide conversation summary', async () => {
    const conversationId = 'test-conv-summary';
    const mockMessages: ConversationMessage[] = [
      { id: 'msg1', conversationId, sender: 'user', content: 'Message 1', createdAt: new Date(), updatedAt: new Date() },
      { id: 'msg2', conversationId, sender: 'agent', content: 'Message 2', createdAt: new Date(), updatedAt: new Date() },
      { id: 'msg3', conversationId, sender: 'user', content: 'Message 3', createdAt: new Date(), updatedAt: new Date() },
    ];

    mockConversationRepo.getMessages.mockResolvedValue(mockMessages);

    const summary = await contextManager.getConversationSummary(conversationId);

    expect(summary.totalMessages).toBe(3);
    expect(summary.messageTypes).toEqual({ user: 2, agent: 1 });
  });

  it('should handle empty content validation', async () => {
    const systemPrompt = 'You are a helpful assistant';
    const userMessage = 'Valid message';

    await expect(contextManager.buildMessages('', userMessage)).rejects.toThrow('System prompt cannot be empty');
    await expect(contextManager.buildMessages(systemPrompt, '')).rejects.toThrow('Current user message cannot be empty');
    await expect(contextManager.buildMessages('   ', userMessage)).rejects.toThrow('System prompt cannot be empty');
  });
});