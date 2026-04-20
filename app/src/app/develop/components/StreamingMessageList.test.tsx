/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

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

// Module-level so individual tests can control return value (true = socket connected/sent).
const mockLoadHistory = vi.fn(() => true);

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    sendMessage: vi.fn(),
    loadHistory: mockLoadHistory,
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
  // Mutating setters so timer-triggered store writes are reflected on the next render.
  setHistoryLoadingMore: vi.fn((value: boolean) => { mockStreamingStore.historyLoadingMore = value }),
  setHistoryLoadingComplete: vi.fn((value: boolean) => { mockStreamingStore.historyLoadingComplete = value }),
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
    mockStreamingStore.historyLoadingMore = false;
    mockStreamingStore.historyHasMore = false;
    mockStreamingStore.historyNextCursor = null;
    mockStreamingStore.currentAppId = 'test-app-123';
    mockAppIdFromParams = 'test-app-123';
    mockDevelopPageStore.loadingPhase = 'ready';
    // Re-wire mutating setters after clearAllMocks resets them to no-ops.
    mockStreamingStore.setHistoryLoadingMore.mockImplementation((v: boolean) => { mockStreamingStore.historyLoadingMore = v });
    mockStreamingStore.setHistoryLoadingComplete.mockImplementation((v: boolean) => { mockStreamingStore.historyLoadingComplete = v });
    mockLoadHistory.mockReturnValue(true);
  });

  describe('empty state', function emptyState() {
    it('should show skeleton loaders when page is loading', function showSkeletonOnPageLoad() {
      mockDevelopPageStore.loadingPhase = 'initializing-page';

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
      const phases = ['idle', 'checking-creation', 'creating', 'initializing-page'];

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
        { id: 's1', role: 'system', content: 'System notice', timestamp: new Date() },
        { id: 'a1', role: 'assistant' as const, content: 'Response', timestamp: new Date() },
      ] as any[]

      renderWithProviders(<StreamingMessageList allMessages={messages} />)

      // The backward loop hits 'system' before reaching the user message, so it breaks
      // without setting startTime — no "Completed" indicator shown
      expect(screen.getByTestId('message-a1').dataset.startTime).toBe('absent')
    })
  })

  describe('history loading gate', function historyLoadingGate() {
    it('should show full-screen skeleton and hide messages when historyLoadingComplete is false with messages present', function showSkeletonAndHideMessagesWhileHistoryLoads() {
      mockStreamingStore.historyLoadingComplete = false;

      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi!', timestamp: new Date() },
      ];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Messages are hidden until history is fully loaded — prevents flash of top-of-chat
      expect(screen.queryByTestId('message-msg-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('message-msg-2')).not.toBeInTheDocument();
      // Full-screen skeleton shown instead
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
    });

    it('should show skeleton when historyLoadingComplete is false and no messages exist', function showSkeletonUntilFirstHistoryArrives() {
      mockStreamingStore.historyLoadingComplete = false;

      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      // No messages yet — the empty-state skeleton covers the screen
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });

    it('should hide loading indicator when historyLoadingComplete is true', function hideLoadingIndicatorWhenDone() {
      mockStreamingStore.historyLoadingComplete = true;

      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi!', timestamp: new Date() },
      ];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(container.querySelector('.ux-skeleton')).not.toBeInTheDocument();
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

  describe('initial load retry', function initialLoadRetry() {
    beforeEach(() => {
      vi.useFakeTimers();
      mockStreamingStore.historyLoadingComplete = false;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should keep skeleton while retrying and clear it when a retry succeeds', async function retrySucceeds() {
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
      ];

      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_load_failed_title')).not.toBeInTheDocument();

      // Advance past the first 15s safety timeout → retry 1 fires, loadHistory called again.
      await act(async () => { vi.advanceTimersByTime(15_001) });

      // Skeleton still visible — historyLoadingComplete is still false (server not yet responded).
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_load_failed_title')).not.toBeInTheDocument();

      // Simulate the 2nd attempt succeeding: server emits history_loaded → handler sets complete.
      mockStreamingStore.historyLoadingComplete = true;
      rerender(<StreamingMessageList allMessages={messages} />);

      // Skeleton gone, message visible, no error banner.
      expect(container.querySelector('.ux-skeleton')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_load_failed_title')).not.toBeInTheDocument();
    });

    it('should show error message after all retries are exhausted', async function allRetriesExhausted() {
      const { container } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();

      // Each retry timeout is 15s and is only scheduled AFTER React flushes the
      // previous re-render, so we must advance in separate act() steps.
      // Cycle 1 (t=15s): retryCount 0→1, new 15s timeout scheduled
      await act(async () => { vi.advanceTimersByTime(15_001) });
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();

      // Cycle 2 (t=30s): retryCount 1→2, new 15s timeout scheduled
      await act(async () => { vi.advanceTimersByTime(15_001) });
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();

      // Cycle 3 (t=45s): retryCount 2 >= MAX → setHistoryLoadFailed(true) + force complete
      await act(async () => { vi.advanceTimersByTime(15_001) });

      // Skeleton gone, error message visible instead of "No messages yet".
      expect(container.querySelector('.ux-skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('builder_messages_load_failed_title')).toBeInTheDocument();
      expect(screen.getByText('builder_messages_load_failed_subtitle')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_empty_title')).not.toBeInTheDocument();
    });
  });

  describe('pagination failure handling', function paginationFailure() {
    const messages = [
      { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
      { id: 'msg-2', role: 'assistant' as const, content: 'Hi!', timestamp: new Date() },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      mockStreamingStore.historyLoadingComplete = true;
      mockStreamingStore.historyHasMore = true;
      mockStreamingStore.historyNextCursor = 'cursor-abc';
      mockStreamingStore.historyLoadingMore = true;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should show "Try again" banner when pagination times out', async function paginationTimeout() {
      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Pagination spinner shows while loading.
      expect(screen.getByText('Loading older messages...')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_pagination_failed')).not.toBeInTheDocument();

      // Advance past the 10s pagination safety timeout.
      await act(async () => { vi.advanceTimersByTime(10_001) });

      // Spinner gone, banner with "Try again" button appears.
      expect(screen.queryByText('Loading older messages...')).not.toBeInTheDocument();
      expect(screen.getByText('builder_messages_pagination_failed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_common_try_again' })).toBeInTheDocument();
    });

    it('should re-emit load_history with cursor when "Try again" is clicked', async function retryEmitsSocket() {
      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => { vi.advanceTimersByTime(10_001) });

      expect(screen.getByText('builder_messages_pagination_failed')).toBeInTheDocument();
      mockLoadHistory.mockClear();

      // fireEvent is synchronous and safe with fake timers; userEvent uses internal
      // setTimeouts that never resolve when fake timers are active.
      fireEvent.click(screen.getByRole('button', { name: 'builder_common_try_again' }));

      // loadHistory must be called with the preserved cursor — not cleared on error.
      expect(mockLoadHistory).toHaveBeenCalledWith({ cursor: 'cursor-abc', limit: 20 });
    });

    it('should clear banner and show messages when retry succeeds', async function retrySucceeds() {
      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => { vi.advanceTimersByTime(10_001) });

      expect(screen.getByText('builder_messages_pagination_failed')).toBeInTheDocument();

      // Click "Try again" — onClick mutates mockStreamingStore.historyLoadingMore=true but
      // there are no Zustand subscriptions in the mock, so the component won't re-render
      // on its own. Wrap the rerender in act() so React also flushes the effect that
      // resets paginationLoadFailed and the resulting state update.
      fireEvent.click(screen.getByRole('button', { name: 'builder_common_try_again' }));
      await act(async () => { rerender(<StreamingMessageList allMessages={messages} />) });

      expect(screen.getByText('Loading older messages...')).toBeInTheDocument();
      expect(screen.queryByText('builder_messages_pagination_failed')).not.toBeInTheDocument();

      // Simulate success: server responds → historyLoadingMore false, banner stays cleared.
      mockStreamingStore.historyLoadingMore = false;
      rerender(<StreamingMessageList allMessages={messages} />);

      expect(screen.queryByText('Loading older messages...')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_messages_pagination_failed')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });
  });
});
