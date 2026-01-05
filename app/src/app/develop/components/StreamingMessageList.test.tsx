import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import StreamingMessageList from './StreamingMessageList';

vi.mock('./StreamingMessage', () => ({
  default: ({ message }: any) => (
    <div data-testid={`message-${message.id}`}>
      {message.role}: {message.content}
    </div>
  ),
}));

const mockStreamingStore = {
  messages: [],
  activeStream: null,
  isActivelyStreaming: false,
  pagination: {
    total: 0,
    loaded: 0,
    hasMore: false,
    isLoading: false,
  },
  currentAppId: 'test-app-123',
  isLoading: false,
  loadMoreConversations: vi.fn(),
};

const mockDevelopPageStore = {
  loadingPhase: 'ready',
};

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useMessages: () => mockStreamingStore.messages,
  useActiveStream: () => mockStreamingStore.activeStream,
  useIsActivelyStreaming: () => mockStreamingStore.isActivelyStreaming,
  useConversationPagination: () => mockStreamingStore.pagination,
  useCurrentAppId: () => mockStreamingStore.currentAppId,
  useIsLoading: () => mockStreamingStore.isLoading,
  useLoadMoreConversations: () => mockStreamingStore.loadMoreConversations,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => {
    if (typeof selector === 'function') {
      return selector(mockDevelopPageStore);
    }
    return mockDevelopPageStore;
  },
}));

describe('StreamingMessageList', function packageTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamingStore.messages = [];
    mockStreamingStore.activeStream = null;
    mockStreamingStore.isLoading = false;
    mockDevelopPageStore.loadingPhase = 'ready';
  });

  describe('empty state', function emptyState() {
    it('should show spinner when page is loading', function showSpinnerOnPageLoad() {
      mockDevelopPageStore.loadingPhase = 'loading-history';

      renderWithProviders(<StreamingMessageList />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });

    it('should show spinner when messages are loading', function showSpinnerOnMessageLoad() {
      mockStreamingStore.isLoading = true;

      renderWithProviders(<StreamingMessageList />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });

    it('should show empty state when ready and no messages', function showEmptyState() {
      mockDevelopPageStore.loadingPhase = 'ready';
      mockStreamingStore.isLoading = false;

      renderWithProviders(<StreamingMessageList />);

      expect(screen.getByText('No messages yet.')).toBeInTheDocument();
      expect(screen.getByText('Start a conversation!')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('should show spinner during initialization phases', function showSpinnerDuringInit() {
      const phases = ['idle', 'checking-creation', 'creating', 'initializing-page', 'loading-history'];

      phases.forEach((phase) => {
        mockDevelopPageStore.loadingPhase = phase as any;

        const { unmount } = renderWithProviders(<StreamingMessageList />);

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();

        unmount();
      });
    });
  });

  describe('with messages', function withMessages() {
    it('should render messages when available', function renderMessages() {
      mockStreamingStore.messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there!',
          timestamp: new Date(),
        },
      ];

      renderWithProviders(<StreamingMessageList />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-2')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });

    it('should include active stream in message list', function includeActiveStream() {
      mockStreamingStore.messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];
      mockStreamingStore.activeStream = {
        id: 'stream-1',
        role: 'assistant',
        content: 'Thinking...',
        segments: [],
        toolCalls: [],
        timestamp: new Date(),
        isComplete: false,
      };

      renderWithProviders(<StreamingMessageList />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-stream-1')).toBeInTheDocument();
    });
  });

  describe('pagination', function pagination() {
    it('should show load more button when has more conversations', function showLoadMore() {
      mockStreamingStore.messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];
      mockStreamingStore.pagination = {
        total: 10,
        loaded: 1,
        hasMore: true,
        isLoading: false,
      };

      renderWithProviders(<StreamingMessageList />);

      expect(screen.getByText('Load previous conversations')).toBeInTheDocument();
    });

    it('should not show load more button when no more conversations', function hideLoadMore() {
      mockStreamingStore.messages = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        },
      ];
      mockStreamingStore.pagination = {
        total: 1,
        loaded: 1,
        hasMore: false,
        isLoading: false,
      };

      renderWithProviders(<StreamingMessageList />);

      expect(screen.queryByText('Load previous conversations')).not.toBeInTheDocument();
    });
  });
});

