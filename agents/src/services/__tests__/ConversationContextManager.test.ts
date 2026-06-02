import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConversationContextManager } from '../ConversationContextManager.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import type { ConversationMessage } from '../../database/schema.js';

// Mock dependencies
vi.mock('../../database/repositories/ConversationRepository.js');
vi.mock('../../logging/index.js', () => {
  const mockLogger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    logger: mockLogger,
    Logger: { create: vi.fn(function () { return mockLogger; }) },
  };
});
const mockRegisterCompressionStrategy = vi.fn();
vi.mock('../ConversationHistoryLoader.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    ConversationHistoryLoader: vi.fn().mockImplementation(function () { return {
      registerCompressionStrategy: mockRegisterCompressionStrategy,
    }; }),
  };
});

describe('ConversationContextManager', () => {
  let contextManager: ConversationContextManager;
  let mockConversationRepo: vi.Mocked<ConversationRepository>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConversationRepo = {
      getMessages: vi.fn(),
    } as any;

    contextManager = new ConversationContextManager(mockConversationRepo, 5);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should expose history loader via getHistoryLoader()', () => {
    const historyLoader = contextManager.getHistoryLoader();
    expect(historyLoader).toBeDefined();
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

  it('should register compression strategies on construction', () => {
    // 7 strategies: DuplicateFileRead, AppContextRemoval, TodoListRemoval,
    // SecretOperationCompression, CssSuggestCompression, MediaSearchSummary, ToolResultCompression
    expect(mockRegisterCompressionStrategy).toHaveBeenCalledTimes(7);
  });
});
