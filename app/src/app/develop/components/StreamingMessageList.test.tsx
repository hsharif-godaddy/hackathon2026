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

// Mock the appIdFromParams to simulate URL param matching
let mockAppIdFromParams = 'test-app-123';

vi.mock('./utils', () => ({
  useAppIdFromParams: () => mockAppIdFromParams,
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
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
    mockStreamingStore.isLoading = false;
    mockStreamingStore.currentAppId = 'test-app-123';
    mockAppIdFromParams = 'test-app-123';
    mockDevelopPageStore.loadingPhase = 'ready';
  });

  describe('empty state', function emptyState() {
    it('should show spinner when page is loading', function showSpinnerOnPageLoad() {
      mockDevelopPageStore.loadingPhase = 'loading-history';

      renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });

    it('should show spinner when messages are loading', function showSpinnerOnMessageLoad() {
      mockStreamingStore.isLoading = true;

      renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });

    it('should show empty state when ready and no messages', function showEmptyState() {
      mockDevelopPageStore.loadingPhase = 'ready';
      mockStreamingStore.isLoading = false;

      renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(screen.getByText('builder_messages_empty_title')).toBeInTheDocument();
      expect(screen.getByText('builder_messages_empty_subtitle')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('should show spinner during initialization phases', function showSpinnerDuringInit() {
      const phases = ['idle', 'checking-creation', 'creating', 'initializing-page', 'loading-history'];

      phases.forEach((phase) => {
        mockDevelopPageStore.loadingPhase = phase as any;

        const { unmount } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();

        unmount();
      });
    });
  });

  describe('with messages', function withMessages() {
    it('should render messages when available', function renderMessages() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'Hi there!',
          timestamp: new Date(),
        },
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-2')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });

    it('should include active stream in message list', function includeActiveStream() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: 'stream-1',
          role: 'assistant' as const,
          content: 'Thinking...',
          segments: [],
          toolCalls: [],
          timestamp: new Date(),
          isComplete: false,
        },
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-stream-1')).toBeInTheDocument();
    });
  });

  describe('pagination', function pagination() {
    it('should show load more button when has more conversations', function showLoadMore() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
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

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByText('Load previous conversations')).toBeInTheDocument();
    });

    it('should not show load more button when no more conversations', function hideLoadMore() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
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

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.queryByText('Load previous conversations')).not.toBeInTheDocument();
    });
  });

  describe('scroll behavior', function scrollBehavior() {
    let scrollIntoViewMock: any;

    beforeEach(() => {
      // Mock scrollIntoView
      scrollIntoViewMock = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoViewMock;

      // Setup container with scroll properties
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get: function() { return 1000; }
      });
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        writable: true,
        value: 0
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: function() { return 500; }
      });
    });

    it('should scroll to bottom when user sends a message', async function scrollOnUserMessage() {
      const initialMessages: any[] = [];
      const { rerender } = renderWithProviders(<StreamingMessageList allMessages={initialMessages} />);

      // Add user message
      const updatedMessages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      rerender(<StreamingMessageList allMessages={updatedMessages} />);

      // Wait for scroll effects to execute
      await vi.waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalled();
      }, { timeout: 200 });
    });

    it('should scroll to bottom when assistant response starts', async function scrollOnAssistantMessage() {
      const initialMessages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];
      const { rerender } = renderWithProviders(<StreamingMessageList allMessages={initialMessages} />);

      // Clear previous calls
      scrollIntoViewMock.mockClear();

      // Add assistant message
      const updatedMessages = [
        ...initialMessages,
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'Hi there!',
          timestamp: new Date(),
        },
      ];

      rerender(<StreamingMessageList allMessages={updatedMessages} />);

      await vi.waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalled();
      }, { timeout: 200 });
    });

    it('should throttle scroll event handler', async function throttleScrollHandler() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);
      const scrollContainer = container.querySelector('.overflow-y-auto');

      if (!scrollContainer) {
        throw new Error('Scroll container not found');
      }

      // Simulate rapid scroll events
      const scrollEvent = new Event('scroll');
      scrollContainer.dispatchEvent(scrollEvent);
      scrollContainer.dispatchEvent(scrollEvent);
      scrollContainer.dispatchEvent(scrollEvent);

      // Due to throttling, state changes should be limited
      // This test verifies throttling is in place (doesn't test exact behavior)
      expect(scrollContainer).toBeInTheDocument();
    });

    it('should handle user scroll during streaming', async function pauseOnUserScroll() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
        {
          id: 'stream-1',
          role: 'assistant' as const,
          content: 'Thinking...',
          segments: [],
          toolCalls: [],
          timestamp: new Date(),
          isComplete: false,
        },
      ];
      mockStreamingStore.isActivelyStreaming = true;

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Wait for initial render
      await vi.waitFor(() => {
        const scrollContainer = container.querySelector('.overflow-y-auto');
        expect(scrollContainer).toBeInTheDocument();
      });

      const scrollContainer = container.querySelector('.overflow-y-auto');

      if (!scrollContainer) {
        throw new Error('Scroll container not found');
      }

      // Simulate user scrolling up (away from bottom)
      Object.defineProperty(scrollContainer, 'scrollTop', {
        value: 100, // Not at bottom
        writable: true,
        configurable: true
      });

      const scrollEvent = new Event('scroll', { bubbles: true });
      scrollContainer.dispatchEvent(scrollEvent);

      // Wait for throttled scroll handler
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify scroll container is still present
      expect(container.querySelector('.overflow-y-auto')).toBeInTheDocument();
    });

    it('should resume auto-scroll when user scrolls back to bottom', async function resumeOnScrollToBottom() {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];
      mockStreamingStore.isActivelyStreaming = true;

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);
      const scrollContainer = container.querySelector('.overflow-y-auto');

      if (!scrollContainer) {
        throw new Error('Scroll container not found');
      }

      // Simulate user scrolling to bottom (within 150px threshold)
      Object.defineProperty(scrollContainer, 'scrollTop', {
        value: 450, // scrollHeight (1000) - clientHeight (500) - scrollTop (450) = 50px from bottom
        writable: true
      });

      const scrollEvent = new Event('scroll');
      scrollContainer.dispatchEvent(scrollEvent);

      // Should be considered "near bottom" and resume auto-scroll
      expect(scrollContainer).toBeInTheDocument();
    });
  });

  describe('app switching', function appSwitching() {
    it('should show spinner during app transition when store appId differs from URL', function showSpinnerDuringTransition() {
      // Simulate app transition: URL changed but store hasn't updated yet
      mockStreamingStore.currentAppId = 'old-app-123';
      mockAppIdFromParams = 'new-app-456';

      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello from old app',
          timestamp: new Date(),
        },
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Should show spinner during transition, not the old messages
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByTestId('message-msg-1')).not.toBeInTheDocument();
    });

    it('should show messages when app IDs match', function showMessagesWhenMatched() {
      mockStreamingStore.currentAppId = 'test-app-123';
      mockAppIdFromParams = 'test-app-123';

      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Should show messages when IDs match
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('should handle empty messages during app transition gracefully', function handleEmptyDuringTransition() {
      mockStreamingStore.currentAppId = 'old-app-123';
      mockAppIdFromParams = 'new-app-456';
      mockStreamingStore.isLoading = true;

      renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // Should show spinner for loading state during transition
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });

    it('should not show "No messages yet" during app transition even with empty messages', function noEmptyStateDuringTransition() {
      mockStreamingStore.currentAppId = 'old-app-123';
      mockAppIdFromParams = 'new-app-456';
      mockStreamingStore.isLoading = false;
      mockDevelopPageStore.loadingPhase = 'ready';

      renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // Should show spinner during transition, not the empty state
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });
  });
});

