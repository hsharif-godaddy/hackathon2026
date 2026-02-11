import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackgroundSummarizer } from '../BackgroundSummarizer.js';
import type { ConversationRepository } from '../../../database/repositories/ConversationRepository.js';
import type { SummaryRepository } from '../../../database/repositories/SummaryRepository.js';
import type { SummarizationStrategy } from '../SummarizationStrategy.js';
import type { DatabaseMessage } from '../../ConversationHistoryLoader.js';

// Mock dependencies
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis()
    })
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../../../utils/token-counter.js', () => ({
  countTokens: vi.fn().mockResolvedValue({ tokenCount: 100 })
}));

vi.mock('../../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({ modelName: 'claude-3-5-sonnet' })
}));

describe('BackgroundSummarizer', () => {
  let conversationRepo: ConversationRepository;
  let summaryRepo: SummaryRepository;
  let strategy: SummarizationStrategy;
  let summarizer: BackgroundSummarizer;

  beforeEach(async () => {
    // Create mock repositories
    conversationRepo = {
      getByAppId: vi.fn(),
      getMessagesAfterMessageId: vi.fn(),
      getMessagesBatch: vi.fn(),
      getMessageById: vi.fn(),
      getEstimatedTokensAfterMessageId: vi.fn().mockResolvedValue(50000), // Default to high estimate to not skip
      getEstimatedTokensForApp: vi.fn().mockResolvedValue(50000) // Default to high estimate to not skip
    } as unknown as ConversationRepository;

    summaryRepo = {
      findLatestForApp: vi.fn(),
      create: vi.fn()
    } as unknown as SummaryRepository;

    strategy = {
      name: 'test-strategy',
      summarize: vi.fn().mockResolvedValue({
        summaryText: 'Test summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRange: { startId: 'msg1', endId: 'msg2' },
        modelUsed: 'claude-3-5-sonnet'
      })
    } as unknown as SummarizationStrategy;

    // Create summarizer with test config (0ms debounce, 0 recent turns for easier testing)
    summarizer = new BackgroundSummarizer(
      conversationRepo,
      summaryRepo,
      strategy,
      {
        maxPromptTokens: 1000,
        debounceMs: 0,
        keepRecentTurns: 0  // Don't exclude any messages in tests
      }
    );

    const { countTokens } = await import('../../../utils/token-counter.js');
    vi.mocked(countTokens).mockResolvedValue({ tokenCount: 100 });
  });

  describe('Full Mode Loading', () => {
    it('should load all messages when no existing summary', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Hello',
          createdAt: new Date('2024-01-01T10:00:00Z')
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Hi',
          createdAt: new Date('2024-01-01T10:01:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockMessages);

      await summarizer.checkAndSummarize('app-123');

      // Wait for debounced execution
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify batch query was used (N+1 fix)
      expect(conversationRepo.getMessagesBatch).toHaveBeenCalledWith(['conv1']);
      expect(conversationRepo.getMessagesAfterMessageId).not.toHaveBeenCalled();
    });
  });

  describe('Incremental Mode Loading', () => {
    it('should load only new messages when existing summary present', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2',
        operationLog: 'Previous operations',
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };
      const mockNewMessages: DatabaseMessage[] = [
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'user',
          content: 'New message',
          createdAt: new Date('2024-01-01T10:02:00Z')
        },
        {
          id: 'msg4',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Response',
          createdAt: new Date('2024-01-01T10:03:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesAfterMessageId).mockResolvedValue(mockNewMessages);

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify incremental loading was used (optimization #1)
      expect(conversationRepo.getMessagesAfterMessageId).toHaveBeenCalledWith('app-123', 'msg2');
      expect(conversationRepo.getMessagesBatch).not.toHaveBeenCalled();
    });

    it('should exit early when no new messages after reference', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2',
        operationLog: null,
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesAfterMessageId).mockResolvedValue([]);
      vi.mocked(conversationRepo.getMessageById).mockResolvedValue({
        id: 'msg2',
        conversationId: 'conv1',
        sender: 'agent',
        content: 'Hi',
        createdAt: new Date()
      });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should exit early without calling summarization
      expect(strategy.summarize).not.toHaveBeenCalled();
      expect(summaryRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('Fallback Recovery', () => {
    it('should fallback to full mode when reference message missing', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2-deleted',
        operationLog: null,
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };
      const mockAllMessages: DatabaseMessage[] = [
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Message after deleted ref',
          createdAt: new Date('2024-01-01T10:02:00Z')
        },
        {
          id: 'msg4',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Response',
          createdAt: new Date('2024-01-01T10:03:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getEstimatedTokensAfterMessageId).mockResolvedValue(null); // Reference missing
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockAllMessages);

      // Mock high token count to trigger summarization
      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 600 });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should detect missing reference via estimation and fallback to batch query
      expect(conversationRepo.getEstimatedTokensAfterMessageId).toHaveBeenCalledWith('app-123', 'msg2-deleted');
      expect(conversationRepo.getMessagesBatch).toHaveBeenCalledWith(['conv1']);

      // Should treat as full run (no existingSummary in context)
      expect(strategy.summarize).toHaveBeenCalled();
      const contextArg = vi.mocked(strategy.summarize).mock.calls[0][0];
      expect(contextArg.existingSummary).toBeUndefined();
    });
  });

  describe('Regeneration Loading', () => {
    it('should load full history when incrementalUpdateCount triggers regeneration', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2',
        operationLog: JSON.stringify({
          version: 1,
          entries: [
            {
              tool: 'file_edit',
              files: ['previous.js'],
              mode: 'edit',
              description: 'edit: previous.js',
            },
          ],
        }),
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 5,
        lastFullSummarizationAt: new Date()
      };
      const mockAllMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Hello',
          createdAt: new Date('2024-01-01T10:00:00Z')
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Hi',
          createdAt: new Date('2024-01-01T10:01:00Z')
        },
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'user',
          content: 'New message',
          createdAt: new Date('2024-01-01T10:02:00Z')
        },
        {
          id: 'msg4',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Response',
          createdAt: new Date('2024-01-01T10:03:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockAllMessages);

      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 600 });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(conversationRepo.getMessagesBatch).toHaveBeenCalledWith(['conv1']);
      expect(conversationRepo.getMessagesAfterMessageId).not.toHaveBeenCalled();

      expect(strategy.summarize).toHaveBeenCalled();
      const contextArg = vi.mocked(strategy.summarize).mock.calls[0][0];
      expect(contextArg.fullMessageHistory?.length).toBe(4);
    });
  });

  describe('Operation Log Preservation', () => {
    it('should merge operation logs when both exist', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2',
        operationLog: JSON.stringify({
          version: 1,
          entries: [
            {
              tool: 'file_edit',
              files: ['previous.js'],
              mode: 'edit',
              description: 'edit: previous.js',
            },
          ],
        }),
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };
      const mockNewMessages: DatabaseMessage[] = [
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'agent',
          content: '',
          createdAt: new Date('2024-01-01T10:02:00Z'),
          segments: [{
            id: 'seg1',
            type: 'tool_call',
            timestamp: new Date(),
            tool_call: {
              id: 'call1',
              tool_name: 'file_edit',
              tool_args: { path: 'test.js', content: 'new code' },
              tool_result: { success: true }
            }
          }]
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesAfterMessageId).mockResolvedValue(mockNewMessages);

      // Mock high token count to trigger summarization (above 1000 max)
      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 1200 });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify operation log was passed to summarization
      expect(strategy.summarize).toHaveBeenCalled();
      const contextArg = vi.mocked(strategy.summarize).mock.calls[0][0];
      expect(contextArg.operationLog).toBeDefined();
      expect(contextArg.operationLog).toContain('previous.js');
      expect(contextArg.operationLog).toContain('test.js');
    });

    it('should preserve existing operation log when no new operations', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 100,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2',
        operationLog: JSON.stringify({
          version: 1,
          entries: [
            {
              tool: 'file_edit',
              files: ['previous.js'],
              mode: 'edit',
              description: 'edit: previous.js',
            },
          ],
        }),
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };
      const mockNewMessages: DatabaseMessage[] = [
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Just text, no tool calls',
          createdAt: new Date('2024-01-01T10:02:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesAfterMessageId).mockResolvedValue(mockNewMessages);

      // Mock high token count to trigger summarization (above 1000 max)
      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 1200 });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should preserve existing operation log even when no new operations
      expect(strategy.summarize).toHaveBeenCalled();
      const contextArg = vi.mocked(strategy.summarize).mock.calls[0][0];
      expect(contextArg.operationLog).toBe('Files modified: previous.js');
    });
  });

  describe('Metadata Preservation', () => {
    it('should preserve cumulative message range and token counts in incremental mode', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockExistingSummary = {
        id: 'summary-1',
        appId: 'app-123',
        summaryText: 'Previous summary',
        summaryTokenCount: 50,
        originalTokenCount: 1000,
        messageCount: 2,
        messageRangeStart: 'msg1',
        messageRangeEnd: 'msg2',
        operationLog: JSON.stringify({
          version: 1,
          entries: [
            {
              tool: 'file_edit',
              files: ['previous.js'],
              mode: 'edit',
              description: 'edit: previous.js',
            },
          ],
        }),
        createdAt: new Date(),
        modelUsed: 'claude-3-5-sonnet',
        incrementalUpdateCount: 1,
        lastFullSummarizationAt: new Date()
      };
      const mockNewMessages: DatabaseMessage[] = [
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'user',
          content: 'New message',
          createdAt: new Date('2024-01-01T10:02:00Z')
        },
        {
          id: 'msg4',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Response',
          createdAt: new Date('2024-01-01T10:03:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(mockExistingSummary);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesAfterMessageId).mockResolvedValue(mockNewMessages);

      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 200 });

      const metadataSummarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        {
          maxPromptTokens: 100,
          debounceMs: 0,
          keepRecentTurns: 0
        }
      );

      await metadataSummarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(strategy.summarize).toHaveBeenCalled();
      const contextArg = vi.mocked(strategy.summarize).mock.calls[0][0];
      expect(contextArg.messageRange.startId).toBe('msg1');
      expect(contextArg.messageRange.endId).toBe('msg4');
      expect(contextArg.originalTokenCount).toBe(1400);
    });
  });

  describe('Max Prompt Tokens', () => {
    it('should exit early when below max prompt tokens', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Short',
          createdAt: new Date('2024-01-01T10:00:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockMessages);

      // Mock low token count
      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 50 });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should exit without summarizing (50 < 1000 max)
      expect(strategy.summarize).not.toHaveBeenCalled();
    });

    it('should trigger summarization when above max prompt tokens', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Long message',
          createdAt: new Date('2024-01-01T10:00:00Z')
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Response',
          createdAt: new Date('2024-01-01T10:01:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockMessages);

      // Mock high token count
      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 600 });

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should trigger summarization (1200 > 1000 max)
      expect(strategy.summarize).toHaveBeenCalled();
    });
  });

  describe('Recent Turns Calculation', () => {
    it('should exclude recent turns from summarization', async () => {
      // Create summarizer with keepRecentTurns=2 for this test
      const recentTurnsSummarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        {
          maxPromptTokens: 1000,
          debounceMs: 0,
          keepRecentTurns: 2
        }
      );

      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Old message 1',
          createdAt: new Date('2024-01-01T10:00:00Z')
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Old response 1',
          createdAt: new Date('2024-01-01T10:01:00Z')
        },
        {
          id: 'msg3',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Recent message 1',
          createdAt: new Date('2024-01-01T10:02:00Z')
        },
        {
          id: 'msg4',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Recent response 1',
          createdAt: new Date('2024-01-01T10:03:00Z')
        },
        {
          id: 'msg5',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Recent message 2',
          createdAt: new Date('2024-01-01T10:04:00Z')
        },
        {
          id: 'msg6',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Recent response 2',
          createdAt: new Date('2024-01-01T10:05:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockMessages);

      // Mock high token count to trigger summarization
      const { countTokens } = await import('../../../utils/token-counter.js');
      vi.mocked(countTokens).mockResolvedValue({ tokenCount: 1200 });

      await recentTurnsSummarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // With keepRecentTurns=2, should only summarize first 2 messages
      expect(strategy.summarize).toHaveBeenCalled();
      const contextArg = vi.mocked(strategy.summarize).mock.calls[0][0];
      expect(contextArg.fullMessageHistory.length).toBe(2); // Only msg1 and msg2
    });

    it('should exit when all messages are within recent turns', async () => {
      // Create summarizer with keepRecentTurns=2 for this test
      const recentTurnsSummarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        {
          maxPromptTokens: 1000,
          debounceMs: 0,
          keepRecentTurns: 2
        }
      );

      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Recent message',
          createdAt: new Date('2024-01-01T10:00:00Z')
        },
        {
          id: 'msg2',
          conversationId: 'conv1',
          sender: 'agent',
          content: 'Recent response',
          createdAt: new Date('2024-01-01T10:01:00Z')
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockMessages);

      await recentTurnsSummarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // With keepRecentTurns=2 and only 1 turn (2 messages), nothing to summarize
      expect(strategy.summarize).not.toHaveBeenCalled();
    });
  });

  describe('Debouncing', () => {
    it('should debounce multiple rapid calls', async () => {
      const mockConversations = [
        { id: 'conv1', appId: 'app-123', agentId: 'initial', title: 'Conv 1' }
      ];
      const mockMessages: DatabaseMessage[] = [
        {
          id: 'msg1',
          conversationId: 'conv1',
          sender: 'user',
          content: 'Message',
          createdAt: new Date()
        }
      ];

      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue(mockConversations);
      vi.mocked(conversationRepo.getMessagesBatch).mockResolvedValue(mockMessages);

      // Make multiple rapid calls
      await summarizer.checkAndSummarize('app-123');
      await summarizer.checkAndSummarize('app-123');
      await summarizer.checkAndSummarize('app-123');

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should only process once due to debouncing
      expect(conversationRepo.getByAppId).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully without crashing', async () => {
      vi.mocked(conversationRepo.getByAppId).mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(summarizer.checkAndSummarize('app-123')).resolves.toBeUndefined();

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not have called subsequent methods
      expect(summaryRepo.create).not.toHaveBeenCalled();
    });

    it('should handle empty conversation list', async () => {
      vi.mocked(summaryRepo.findLatestForApp).mockResolvedValue(null);
      vi.mocked(conversationRepo.getByAppId).mockResolvedValue([]);

      await summarizer.checkAndSummarize('app-123');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should exit early without calling message loading
      expect(conversationRepo.getMessagesBatch).not.toHaveBeenCalled();
      expect(strategy.summarize).not.toHaveBeenCalled();
    });
  });
});
