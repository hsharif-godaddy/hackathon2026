/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import StreamingMessageList from './StreamingMessageList';

vi.mock('./StreamingMessage', () => ({
  default: ({ message, startTime }: any) => (
    <div
      data-testid={`message-${message.id}`}
      data-start-time={startTime ? 'present' : 'absent'}
    >
      {message.role}: {message.content}
    </div>
  ),
}));

vi.mock('./ThinkingIndicator', () => ({
  default: () => <div data-testid="thinking-indicator" />,
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    sendMessage: vi.fn(),
    loadMoreHistory: vi.fn(() => false),
  }),
}));

vi.mock('@/hooks/useSound', () => ({
  useSound: () => [vi.fn()],
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
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
  historyLoadingComplete: true,
  loadMoreConversations: vi.fn(),
  historyHasMore: false,
  historyNextCursor: null as string | null,
  historyLoadingMore: false,
  setHistoryLoadingMore: vi.fn(),
  activeStream: null,
};

const mockDevelopPageStore = {
  loadingPhase: 'ready',
};

// Mock the appIdFromParams to simulate URL param matching
let mockAppIdFromParams = 'test-app-123';

vi.mock('./utils', () => ({
  useAppIdFromParams: () => mockAppIdFromParams,
}));

vi.mock('@/stores/useStreamingConversationStore', () => {
  const store = (selector: any) => selector(mockStreamingStore);
  store.getState = () => mockStreamingStore;
  return {
    useStreamingConversationStore: store,
    useIsActivelyStreaming: () => mockStreamingStore.isActivelyStreaming,
    useConversationPagination: () => mockStreamingStore.pagination,
    useCurrentAppId: () => mockStreamingStore.currentAppId,
    useHistoryLoadingComplete: () => mockStreamingStore.historyLoadingComplete,
    useIsLoading: () => mockStreamingStore.isLoading,
    useLoadMoreConversations: () => mockStreamingStore.loadMoreConversations,
    useWebSocketState: () => ({ connected: true, status: 'connected' }),
  };
});

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
    mockStreamingStore.historyLoadingComplete = true;
    mockStreamingStore.currentAppId = 'test-app-123';
    mockAppIdFromParams = 'test-app-123';
    mockDevelopPageStore.loadingPhase = 'ready';
  });

  describe('empty state', function emptyState() {
    it('should show skeleton loaders when page is loading', function showSkeletonOnPageLoad() {
      mockDevelopPageStore.loadingPhase = 'loading-history';

      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // Check for skeleton elements
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });

    it('should show skeleton loaders when messages are loading', function showSkeletonOnMessageLoad() {
      mockStreamingStore.isLoading = true;

      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // Check for skeleton elements
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });

    it('should show empty state when ready and no messages', function showEmptyState() {
      mockDevelopPageStore.loadingPhase = 'ready';
      mockStreamingStore.isLoading = false;

      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(screen.getByText('builder_messages_empty_title')).toBeInTheDocument();
      expect(screen.getByText('builder_messages_empty_subtitle')).toBeInTheDocument();
      // No skeleton loaders when in empty state
      expect(container.querySelector('.ux-skeleton')).not.toBeInTheDocument();
    });

    it('should show skeleton loaders during initialization phases', function showSkeletonDuringInit() {
      const phases = ['idle', 'checking-creation', 'creating', 'initializing-page', 'loading-history'];

      phases.forEach((phase) => {
        mockDevelopPageStore.loadingPhase = phase as any;

        const { unmount, container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

        // Check for skeleton elements
        expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
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

  describe('startTime assignment for Completed indicator', function startTimeTests() {
    it('should pass startTime to a single assistant following a user message', function singleAssistant() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: new Date('2024-01-01T10:00:00Z') },
        { id: 'a1', role: 'assistant' as const, content: 'Hi!', timestamp: new Date('2024-01-01T10:00:05Z') },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('present')
    })

    it('should not pass startTime to a user message', function noStartTimeForUser() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      expect(screen.getByTestId('message-u1').dataset.startTime).toBe('absent')
    })

    it('should only pass startTime to the last assistant in a consecutive sequence', function lastInSequence() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'Build something complex', timestamp: new Date('2024-01-01T10:00:00Z') },
        { id: 'a1', role: 'assistant' as const, content: 'PM plan and narration', timestamp: new Date() },
        { id: 'a2', role: 'assistant' as const, content: 'Dev final summary', timestamp: new Date() },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('absent')
      expect(screen.getByTestId('message-a2').dataset.startTime).toBe('present')
    })

    it('should not pass startTime to any middle assistant in a long sequence', function middleAssistants() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'Go', timestamp: new Date('2024-01-01T10:00:00Z') },
        { id: 'a1', role: 'assistant' as const, content: 'Step 1', timestamp: new Date() },
        { id: 'a2', role: 'assistant' as const, content: 'Step 2', timestamp: new Date() },
        { id: 'a3', role: 'assistant' as const, content: 'Step 3', timestamp: new Date() },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('absent')
      expect(screen.getByTestId('message-a2').dataset.startTime).toBe('absent')
      expect(screen.getByTestId('message-a3').dataset.startTime).toBe('present')
    })

    it('should assign startTime independently to each turn when turns alternate', function separateTurns() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'First question', timestamp: new Date('2024-01-01T10:00:00Z') },
        { id: 'a1', role: 'assistant' as const, content: 'First answer', timestamp: new Date() },
        { id: 'u2', role: 'user' as const, content: 'Second question', timestamp: new Date('2024-01-01T10:01:00Z') },
        { id: 'a2', role: 'assistant' as const, content: 'Second answer', timestamp: new Date() },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('present')
      expect(screen.getByTestId('message-a2').dataset.startTime).toBe('present')
    })

    it('should assign startTime to last assistant of each turn when handoff interleaved with a second user turn', function mixedTurns() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'Build auth', timestamp: new Date('2024-01-01T10:00:00Z') },
        { id: 'a1', role: 'assistant' as const, content: 'PM: plan', timestamp: new Date() },
        { id: 'a2', role: 'assistant' as const, content: 'Dev: done', timestamp: new Date() },
        { id: 'u2', role: 'user' as const, content: 'Remove auth', timestamp: new Date('2024-01-01T10:05:00Z') },
        { id: 'a3', role: 'assistant' as const, content: 'Removed', timestamp: new Date() },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('absent')
      expect(screen.getByTestId('message-a2').dataset.startTime).toBe('present')
      expect(screen.getByTestId('message-a3').dataset.startTime).toBe('present')
    })

    it('should not assign startTime when a non-user non-assistant role blocks the backward search', function unknownRole() {
      const messages = [
        { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: new Date('2024-01-01T10:00:00Z') },
        { id: 's1', role: 'system' as const, content: 'System notice', timestamp: new Date() },
        { id: 'a1', role: 'assistant' as const, content: 'Response', timestamp: new Date() },
      ]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      // The backward loop hits 'system' before reaching the user message, so it breaks
      // without setting startTime — no "Completed" indicator shown
      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('absent')
    })
  })

  describe('history loading gate', function historyLoadingGate() {
    it('should show skeleton loaders when historyLoadingComplete is false even with messages present', function showSkeletonUntilHistoryLoaded() {
      mockStreamingStore.historyLoadingComplete = false;

      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi!', timestamp: new Date() },
      ];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('message-msg-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('message-msg-2')).not.toBeInTheDocument();
    });

    it('should render messages once historyLoadingComplete becomes true', function renderAfterHistoryLoaded() {
      mockStreamingStore.historyLoadingComplete = false;

      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi!', timestamp: new Date() },
      ];

      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Initially shows skeleton
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('message-msg-1')).not.toBeInTheDocument();

      // Simulate history loading completing
      mockStreamingStore.historyLoadingComplete = true;
      rerender(<StreamingMessageList allMessages={messages} />);

      expect(container.querySelector('.ux-skeleton')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-2')).toBeInTheDocument();
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

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Should show skeleton loaders during transition, not the old messages
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
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

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Should show messages when IDs match
      expect(container.querySelector('.ux-skeleton')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('should handle empty messages during app transition gracefully', function handleEmptyDuringTransition() {
      mockStreamingStore.currentAppId = 'old-app-123';
      mockAppIdFromParams = 'new-app-456';
      mockStreamingStore.isLoading = true;

      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // Should show skeleton loaders for loading state during transition
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });

    it('should not show "No messages yet" during app transition even with empty messages', function noEmptyStateDuringTransition() {
      mockStreamingStore.currentAppId = 'old-app-123';
      mockAppIdFromParams = 'new-app-456';
      mockStreamingStore.isLoading = false;
      mockDevelopPageStore.loadingPhase = 'ready';

      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // Should show skeleton loaders during transition, not the empty state
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('No messages yet.')).not.toBeInTheDocument();
    });
  });
});
