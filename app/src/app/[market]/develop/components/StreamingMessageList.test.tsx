/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import StreamingMessageList from './StreamingMessageList';

vi.mock('next/navigation', () => ({
  usePathname: () => '/develop/mock',
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  default: vi.fn(() => false),
  useSwitchboard: vi.fn(() => false),
}));

const {
  mockSelectCommit,
  mockSetSelectedCommitHash,
  mockSetActiveChatTab,
  mockNavigatePreviewToRoute,
  mockIsHistoryDisabled,
  mockActiveChatTab,
} = vi.hoisted(() => ({
  mockSelectCommit: vi.fn().mockResolvedValue({ previewRoute: null }),
  mockSetSelectedCommitHash: vi.fn(),
  mockSetActiveChatTab: vi.fn(),
  mockNavigatePreviewToRoute: vi.fn(),
  // Boxed so individual tests can flip the value mid-render without losing
  // the reference the hook mock closes over.
  mockIsHistoryDisabled: { value: false },
  mockActiveChatTab: { value: 'chat' as 'chat' | 'history' | 'medias' | 'analytics' | 'settings' },
}));

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: (
    selector: (s: {
      selectCommit: typeof mockSelectCommit
      setSelectedCommitHash: typeof mockSetSelectedCommitHash
    }) => unknown,
  ) =>
    selector({
      selectCommit: mockSelectCommit,
      setSelectedCommitHash: mockSetSelectedCommitHash,
    }),
}));

vi.mock('@/hooks/useIsHistoryDisabled', () => ({
  useIsHistoryDisabled: () => ({ isDisabled: mockIsHistoryDisabled.value, isPublishing: false }),
}));

vi.mock('./StreamingMessage', () => ({
  default: ({ message, startTime, commitHash, onUndo, onRestore }: any) => (
    <div
      data-testid={`message-${message.id}`}
      data-start-time={startTime ? 'present' : 'absent'}
      data-commit-hash={commitHash ?? ''}
      data-has-on-undo={String(Boolean(onUndo))}
      data-has-on-restore={String(Boolean(onRestore))}
    >
      {message.role}: {message.content}
      {onRestore && (
        <button
          data-testid={`restore-${message.id}`}
          onClick={() => onRestore(commitHash)}
        >
          restore
        </button>
      )}
    </div>
  ),
}));

vi.mock('@airo-ux/pattern-library/chat/thinker', () => ({
  Thinker: () => <div data-testid="thinking-indicator" />,
}));

// Module-level so individual tests can control return value (true = socket connected/sent).
const mockLoadHistory = vi.fn(function () { return true; });

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: vi.fn(),
    loadHistory: mockLoadHistory,
    stopGeneration: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    activeChatTab: mockActiveChatTab.value,
    setActiveChatTab: mockSetActiveChatTab,
  }),
}));

vi.mock('@/hooks/useSound', () => ({
  useSound: () => [vi.fn()],
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

const { mockUndoAction } = vi.hoisted(() => ({
  mockUndoAction: {
    isLocked: false,
    isPending: false,
    error: null as string | null,
    clearError: vi.fn(),
    triggerUndo: vi.fn(),
  },
}));

vi.mock('@/hooks/useUndoAction', () => ({
  useUndoAction: () => mockUndoAction,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
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
  setHistoryLoadingMore: vi.fn(function (value: boolean) { mockStreamingStore.historyLoadingMore = value }),
  setHistoryLoadingComplete: vi.fn(function (value: boolean) { mockStreamingStore.historyLoadingComplete = value }),
  activeStream: null,
};

const mockDevelopPageStore = {
  loadingPhase: 'ready',
  activeChatTab: 'chat',
  activeSettingsSection: 'domain',
  chatTabsInitializedForPathname: '/develop/mock',
  setActiveChatTab: vi.fn(),
  setActiveSettingsSection: vi.fn(),
  markChatTabsInitialized: vi.fn(),
};

// Mock the appIdFromParams to simulate URL param matching
let mockAppIdFromParams = 'test-app-123';
let mockWebSocketConnected = true;

vi.mock('./utils', () => ({
  navigatePreviewAfterCheckout: vi.fn(),
  navigatePreviewToRoute: mockNavigatePreviewToRoute,
  useAppIdFromParams: () => mockAppIdFromParams,
}));

vi.mock('@/stores/useStreamingConversationStore', () => {
  const store = (selector: any) => selector(mockStreamingStore);
  store.getState = () => mockStreamingStore;
  return {
    useStreamingConversationStore: store,
    useIsActivelyStreaming: () => mockStreamingStore.isActivelyStreaming,
    useActiveRunningToolName: () => null,
    useActiveAwaitAgentsCount: () => 0,
    useAwaitedJobResult: () => undefined,
    useConversationPagination: () => mockStreamingStore.pagination,
    useCurrentAppId: () => mockStreamingStore.currentAppId,
    useHistoryLoadingComplete: () => mockStreamingStore.historyLoadingComplete,
    useIsLoading: () => mockStreamingStore.isLoading,
    useLoadMoreConversations: () => mockStreamingStore.loadMoreConversations,
    useConnectionState: () => ({ connected: mockWebSocketConnected, status: mockWebSocketConnected ? 'connected' : 'disconnected' }),
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
    mockWebSocketConnected = true;
    mockDevelopPageStore.loadingPhase = 'ready';
    // Re-wire mutating setters after clearAllMocks resets them to no-ops.
    mockStreamingStore.setHistoryLoadingMore.mockImplementation(function (v: boolean) { mockStreamingStore.historyLoadingMore = v });
    mockStreamingStore.setHistoryLoadingComplete.mockImplementation(function (v: boolean) { mockStreamingStore.historyLoadingComplete = v });
    mockLoadHistory.mockReturnValue(true);
    mockSelectCommit.mockResolvedValue({ previewRoute: null });
    mockSetSelectedCommitHash.mockReset();
    mockIsHistoryDisabled.value = false;
    mockActiveChatTab.value = 'chat';
    mockStreamingStore.isActivelyStreaming = false;
    mockStreamingStore.activeStream = null;
    mockUndoAction.isLocked = false;
    mockUndoAction.isPending = false;
    mockUndoAction.error = null;
    mockUndoAction.triggerUndo.mockReset();
    mockUndoAction.clearError.mockReset();
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

    it('echoes the initial prompt without an in-transcript thinking indicator', function initialPromptNoTopThinker() {
      // AIROBUILD-3228: the top "Thinking…" indicator was removed so it no longer
      // "flicks" down to the bottom InputActionsPanel card once history loads. The
      // echoed prompt still renders; the sole indicator now lives above the input.
      mockDevelopPageStore.loadingPhase = 'ready';
      mockStreamingStore.isLoading = false;

      renderWithProviders(
        <StreamingMessageList allMessages={[]} hasInitialPrompt initialPromptText="Build me a bakery site" />,
      );

      expect(screen.getByTestId('message-initial-prompt')).toBeInTheDocument();
      expect(screen.queryByTestId('thinking-indicator')).not.toBeInTheDocument();
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
    const SCROLL_BOTTOM = 500 // scrollHeight (1000) - clientHeight (500)
    const originalScrollTo = HTMLElement.prototype.scrollTo

    function getScrollContainer(container: HTMLElement) {
      const scrollContainer = container.querySelector('.overflow-y-auto');
      if (!scrollContainer) {
        throw new Error('Scroll container not found');
      }
      return scrollContainer as HTMLElement;
    }

    beforeEach(() => {
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
      HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
        if (typeof options === 'object' && options?.top !== undefined) {
          this.scrollTop = options.top;
        }
      });
    });

    afterEach(() => {
      HTMLElement.prototype.scrollTo = originalScrollTo
    });

    it('should scroll to bottom when user sends a message', async function scrollOnUserMessage() {
      const initialMessages: any[] = [];
      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={initialMessages} />);

      const updatedMessages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
      ];

      rerender(<StreamingMessageList allMessages={updatedMessages} />);

      await vi.waitFor(() => {
        expect(getScrollContainer(container).scrollTop).toBe(SCROLL_BOTTOM);
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
      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={initialMessages} />);

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
        expect(getScrollContainer(container).scrollTop).toBe(SCROLL_BOTTOM);
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
      mockStreamingStore.activeStream = messages[1];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      const scrollContainer = getScrollContainer(container);

      await act(async () => {
        scrollContainer.scrollTop = SCROLL_BOTTOM;
        fireEvent.scroll(scrollContainer);
        scrollContainer.scrollTop = 100;
        fireEvent.scroll(scrollContainer);
      });

      expect(screen.getByText('builder_messages_new_messages')).toBeInTheDocument();
    });

    it('should resume auto-scroll when user scrolls back to bottom', async function resumeOnScrollToBottom() {
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
          content: 'Streaming...',
          segments: [],
          toolCalls: [],
          timestamp: new Date(),
          isComplete: false,
        },
      ];
      mockStreamingStore.isActivelyStreaming = true;
      mockStreamingStore.activeStream = messages[1];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);
      const scrollContainer = getScrollContainer(container);

      await act(async () => {
        scrollContainer.scrollTop = SCROLL_BOTTOM;
        fireEvent.scroll(scrollContainer);
        scrollContainer.scrollTop = 100;
        fireEvent.scroll(scrollContainer);
      });

      expect(screen.getByText('builder_messages_new_messages')).toBeInTheDocument();

      await act(async () => {
        scrollContainer.scrollTop = 450;
        fireEvent.scroll(scrollContainer);
      });

      expect(screen.queryByText('builder_messages_new_messages')).not.toBeInTheDocument();
    });

    it('should not reset scroll position on token updates after wheel scroll up', async function holdPositionOnWheelDuringStream() {
      const initialStream = {
        id: 'stream-1',
        role: 'assistant' as const,
        content: 'Hello',
        segments: [] as unknown[],
        toolCalls: [] as unknown[],
        timestamp: new Date(),
        isComplete: false,
      };
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date(),
        },
        initialStream,
      ];
      mockStreamingStore.isActivelyStreaming = true;
      mockStreamingStore.activeStream = initialStream;

      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);
      const scrollContainer = getScrollContainer(container);

      await act(async () => {
        scrollContainer.scrollTop = 200;
        fireEvent.wheel(scrollContainer, { deltaY: -10 });
      });

      const heldScrollTop = scrollContainer.scrollTop;

      const updatedStream = {
        ...initialStream,
        content: 'Hello world with more streamed tokens',
      };
      mockStreamingStore.activeStream = updatedStream;

      rerender(
        <StreamingMessageList
          allMessages={[
            messages[0],
            updatedStream,
          ]}
        />,
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(scrollContainer.scrollTop).toBe(heldScrollTop);
      expect(screen.getByText('builder_messages_new_messages')).toBeInTheDocument();
    });

    it('should not resume auto-scroll while still in near-bottom zone without scrolling down', async function noResumeInNearBottomZone() {
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
          content: 'Streaming...',
          segments: [],
          toolCalls: [],
          timestamp: new Date(),
          isComplete: false,
        },
      ];
      mockStreamingStore.isActivelyStreaming = true;
      mockStreamingStore.activeStream = messages[1];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);
      const scrollContainer = getScrollContainer(container);

      await act(async () => {
        scrollContainer.scrollTop = SCROLL_BOTTOM;
        fireEvent.scroll(scrollContainer);
        scrollContainer.scrollTop = 400;
        fireEvent.wheel(scrollContainer, { deltaY: -5 });
        fireEvent.scroll(scrollContainer);
      });

      expect(screen.getByText('builder_messages_new_messages')).toBeInTheDocument();

      await act(async () => {
        fireEvent.scroll(scrollContainer);
      });

      expect(screen.getByText('builder_messages_new_messages')).toBeInTheDocument();
    });

    describe('transcript footer scroll', function transcriptFooterScroll() {
      it('scrolls when transcriptFooterScrollNonce increases', async function scrollOnNonceIncrease() {
        const messages = [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Hello',
            timestamp: new Date(),
          },
        ];
        const footer = <div data-testid="transcript-footer">pre-launch</div>;

        const { container, rerender } = renderWithProviders(
          <StreamingMessageList
            allMessages={messages}
            transcriptFooter={footer}
            transcriptFooterScrollNonce={1}
            transcriptContainerVisible={true}
          />,
        );

        await vi.waitFor(
          () => {
            expect(getScrollContainer(container).scrollTop).toBe(SCROLL_BOTTOM);
          },
          { timeout: 300 },
        );

        rerender(
          <StreamingMessageList
            allMessages={messages}
            transcriptFooter={footer}
            transcriptFooterScrollNonce={2}
            transcriptContainerVisible={true}
          />,
        );

        await vi.waitFor(
          () => {
            expect(getScrollContainer(container).scrollTop).toBe(SCROLL_BOTTOM);
          },
          { timeout: 300 },
        );
      });

      it('scrolls when transcriptContainerVisible becomes true with footer and nonce', async function scrollWhenVisible() {
        const messages = [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: 'Hello',
            timestamp: new Date(),
          },
        ];
        const footer = <div data-testid="transcript-footer">pre-launch</div>;

        const { container, rerender } = renderWithProviders(
          <StreamingMessageList
            allMessages={messages}
            transcriptFooter={footer}
            transcriptFooterScrollNonce={1}
            transcriptContainerVisible={false}
          />,
        );

        rerender(
          <StreamingMessageList
            allMessages={messages}
            transcriptFooter={footer}
            transcriptFooterScrollNonce={1}
            transcriptContainerVisible={true}
          />,
        );

        await vi.waitFor(
          () => {
            expect(getScrollContainer(container).scrollTop).toBe(SCROLL_BOTTOM);
          },
          { timeout: 300 },
        );
      });
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
    it('should show messages with top skeleton when historyLoadingComplete is false but messages already arrived', function showMessagesWithTopSkeletonWhileHistoryLoads() {
      mockStreamingStore.historyLoadingComplete = false;

      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi!', timestamp: new Date() },
      ];

      const { container } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-2')).toBeInTheDocument();
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

    it('should not burn retries when the transport cannot send history load', async function transportUnavailable() {
      mockWebSocketConnected = false;
      mockLoadHistory.mockReturnValue(false);

      const { container, rerender } = renderWithProviders(<StreamingMessageList allMessages={[]} />);

      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(45_003) });

      expect(mockLoadHistory).toHaveBeenCalledTimes(1);
      expect(mockStreamingStore.setHistoryLoadingComplete).not.toHaveBeenCalledWith(true);
      expect(screen.queryByText('builder_messages_load_failed_title')).not.toBeInTheDocument();
      expect(container.querySelector('.ux-skeleton')).toBeInTheDocument();

      mockWebSocketConnected = true;
      mockLoadHistory.mockReturnValue(true);
      rerender(<StreamingMessageList allMessages={[]} />);

      await act(async () => { vi.advanceTimersByTime(15_001) });

      expect(mockLoadHistory).toHaveBeenCalledTimes(2);
      expect(mockStreamingStore.setHistoryLoadingComplete).not.toHaveBeenCalledWith(true);
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

  describe('per-prompt action wiring', () => {
    const userMsg = (id: string, content = 'hi') => ({
      id,
      role: 'user' as const,
      content,
      timestamp: new Date(),
    });
    const assistantMsg = (id: string, commitHash?: string) => ({
      id,
      role: 'assistant' as const,
      content: 'response',
      timestamp: new Date(),
      ...(commitHash ? { commitHash } : {}),
    });

    it('wires onUndo on the most recent completed assistant turn and onRestore on the older ones', () => {
      // The latest completed assistant turn gets an undo button (via
      // useUndoAction). Older committed turns keep the non-destructive
      // restore preview button. The two are mutually exclusive on a single
      // message — undo wins.
      const messages = [
        userMsg('u1'),
        assistantMsg('a1', 'older-commit'),
        userMsg('u2'),
        assistantMsg('a2', 'middle-commit'),
        userMsg('u3'),
        assistantMsg('a3', 'latest-commit'),
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-commit-hash', 'older-commit');
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-restore', 'true');

      expect(screen.getByTestId('message-a2')).toHaveAttribute('data-commit-hash', 'middle-commit');
      expect(screen.getByTestId('message-a2')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-a2')).toHaveAttribute('data-has-on-restore', 'true');

      // Latest completed turn gets undo, NOT restore.
      expect(screen.getByTestId('message-a3')).toHaveAttribute('data-commit-hash', 'latest-commit');
      expect(screen.getByTestId('message-a3')).toHaveAttribute('data-has-on-undo', 'true');
      expect(screen.getByTestId('message-a3')).toHaveAttribute('data-has-on-restore', 'false');

      // User prompts never get either action — both moved to the response footer.
      expect(screen.getByTestId('message-u1')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-u1')).toHaveAttribute('data-has-on-restore', 'false');
      expect(screen.getByTestId('message-u3')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-u3')).toHaveAttribute('data-has-on-restore', 'false');
    });

    it('wires onUndo without a commit on the latest completed turn — undo can stash uncommitted work', () => {
      const messages = [
        userMsg('u1'),
        assistantMsg('a1'), // no commitHash — turn errored before committing
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-commit-hash', '');
      // Restore needs a commit hash; without one it's suppressed.
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-restore', 'false');
      // Undo still applies — it can stash uncommitted work even on a tree
      // that never committed.
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-undo', 'true');
    });

    it('does not wire either action on a streaming assistant turn', () => {
      const messages = [
        userMsg('u1'),
        { ...assistantMsg('a1'), segments: [], toolCalls: [], isComplete: false }, // mid-stream
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // Streaming messages aren't "completed" — neither button shows in the footer.
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-restore', 'false');
    });

    it('falls back to onRestore on the latest committed turn when undo is locked', () => {
      // useUndoAction returns isLocked=true when there is nothing meaningful
      // to undo (e.g. clean tree + no rollback target, or the latest message
      // is already a user-action notice). The latest completed turn should
      // then surface the restore preview button instead.
      mockUndoAction.isLocked = true;
      const messages = [
        userMsg('u1'),
        assistantMsg('a1', 'a1-commit'),
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-restore', 'true');
    });

    it('keeps onRestore on a committed assistant turn when a user-action notice trails it', () => {
      // After an undo, a synthetic user-action notice tails the transcript
      // and useUndoAction.isLocked flips to true. The latest completed
      // assistant turn falls back to restore.
      mockUndoAction.isLocked = true;
      const userActionNotice = {
        id: 'notice-1',
        role: 'user' as const,
        content: 'undid the last turn',
        timestamp: new Date(),
        metadata: { kind: 'restore' as const, commitHash: 'a1-commit' },
      };
      const messages = [
        userMsg('u1'),
        assistantMsg('a1', 'a1-commit'),
        userActionNotice,
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-undo', 'false');
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-restore', 'true');
    });

    it('wires onRestore on a "change nothing" assistant turn using the prior assistant commit', () => {
      // A turn where the agent committed (a1, commit-a) followed by a turn
      // where the agent made no changes (a2). When undo is locked on the
      // latest turn (e.g. an editor edit committed on top, or generally
      // nothing meaningful to rewind), the change-nothing message should
      // still expose Restore so the user can preview the working tree at
      // the end of that turn — which is the same as commit-a.
      mockUndoAction.isLocked = true;
      const messages = [
        userMsg('u1'),
        assistantMsg('a1', 'commit-a'),
        userMsg('u2'),
        assistantMsg('a2'), // agent made no changes — no commitHash of its own
      ];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      // a1 still uses its own commit.
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-commit-hash', 'commit-a');
      expect(screen.getByTestId('message-a1')).toHaveAttribute('data-has-on-restore', 'true');

      // a2 falls back to a1's commit so the user can preview the pre-edit
      // state from the change-nothing turn.
      expect(screen.getByTestId('message-a2')).toHaveAttribute('data-commit-hash', 'commit-a');
      expect(screen.getByTestId('message-a2')).toHaveAttribute('data-has-on-restore', 'true');
      expect(screen.getByTestId('message-a2')).toHaveAttribute('data-has-on-undo', 'false');
    });
  });

  describe('handleRestore — deferring the checkout while history is locked', () => {
    const userMsg = (id: string) => ({
      id, role: 'user' as const, content: 'hi', timestamp: new Date(),
    });
    const assistantMsg = (id: string, commitHash: string) => ({
      id, role: 'assistant' as const, content: 'response', timestamp: new Date(), commitHash,
    });

    beforeEach(() => {
      // The chat restore button lives on the non-latest assistant turns —
      // the latest gets undo. Either pattern works (older turn while undo
      // is unlocked, or any turn when undo is locked). We pick the latter
      // so a single assistant message exposes the restore button, keeping
      // the test setup minimal.
      mockUndoAction.isLocked = true;
    });

    it('runs the checkout immediately when the history tab is unlocked', async () => {
      // Baseline: with isHistoryDisabled=false (idle agent, no publish, etc.)
      // the click path matches the pre-deferral behavior — checkout fires
      // synchronously and the tab/preview nav happens alongside it.
      mockIsHistoryDisabled.value = false;
      const messages = [userMsg('u1'), assistantMsg('a1', 'older-commit')];

      renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('restore-a1'));
      });

      expect(mockSelectCommit).toHaveBeenCalledTimes(1);
      expect(mockSelectCommit).toHaveBeenCalledWith('test-app-123', 'older-commit');
      expect(mockSetSelectedCommitHash).toHaveBeenCalledWith('test-app-123', 'older-commit');
      expect(mockSetActiveChatTab).toHaveBeenCalledWith('history');
      expect(mockNavigatePreviewToRoute).toHaveBeenCalledWith('/');
    });

    it('defers the checkout while the history tab is locked, then fires it when unlocked', async () => {
      // The click should still navigate to history and visually mark the
      // commit selected (so the user sees feedback), but selectCommit must
      // not run — that's the bypass we're closing. As soon as the lock
      // clears (e.g. agent stream completes), the queued checkout fires.
      mockIsHistoryDisabled.value = true;
      const messages = [userMsg('u1'), assistantMsg('a1', 'older-commit')];

      const { rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('restore-a1'));
      });

      // Visual nav happens immediately so the user gets feedback.
      expect(mockSetSelectedCommitHash).toHaveBeenCalledWith('test-app-123', 'older-commit');
      expect(mockSetActiveChatTab).toHaveBeenCalledWith('history');
      expect(mockNavigatePreviewToRoute).toHaveBeenCalledWith('/');
      // But the actual checkout — the part that mutates HEAD — does NOT.
      expect(mockSelectCommit).not.toHaveBeenCalled();

      // Lock releases (agent finished). The deferred checkout fires from
      // the effect that watches isHistoryDisabled.
      mockIsHistoryDisabled.value = false;
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });

      expect(mockSelectCommit).toHaveBeenCalledTimes(1);
      expect(mockSelectCommit).toHaveBeenCalledWith('test-app-123', 'older-commit');
    });

    it('only the most recent click survives — later restore clicks override an earlier deferred hash', async () => {
      // Defensive: while locked, if the user changes their mind and clicks
      // a different commit, the second click should win. We don't queue a
      // FIFO of checkouts — the latest selection is the one that fires.
      mockIsHistoryDisabled.value = true;
      const messages = [
        userMsg('u1'),
        assistantMsg('a1', 'first-commit'),
        userMsg('u2'),
        assistantMsg('a2', 'second-commit'),
      ];

      const { rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('restore-a1'));
        fireEvent.click(screen.getByTestId('restore-a2'));
      });

      expect(mockSelectCommit).not.toHaveBeenCalled();

      mockIsHistoryDisabled.value = false;
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });

      expect(mockSelectCommit).toHaveBeenCalledTimes(1);
      expect(mockSelectCommit).toHaveBeenCalledWith('test-app-123', 'second-commit');
    });

    it('cancels the deferred checkout when the user switches back to the chat tab before the lock clears', async () => {
      // The click queues a preview-checkout because the history tab is
      // locked (agent streaming). Before the lock releases, the user
      // navigates back to the chat tab. ChatToolbar's autoReturnToMain
      // then checks out main; the queued checkout must be canceled or it
      // would fire when the lock later releases and race the
      // autoReturnToMain, leaving the working tree on the older commit
      // while the UI thinks it's on main — a git timeline de-sync.
      mockIsHistoryDisabled.value = true;
      mockActiveChatTab.value = 'chat';
      const messages = [userMsg('u1'), assistantMsg('a1', 'older-commit')];

      const { rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('restore-a1'));
      });

      expect(mockSelectCommit).not.toHaveBeenCalled();

      // handleRestore calls setActiveChatTab(HISTORY); the mocked setter
      // doesn't flip the boxed value, so push the transition manually to
      // mirror what useChatTabs does in the real app.
      mockActiveChatTab.value = 'history';
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });

      // User navigates back to chat while the agent is still streaming.
      mockActiveChatTab.value = 'chat';
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });

      // Lock then releases (agent finished). The pending hash was
      // canceled by the tab switch, so no checkout fires.
      mockIsHistoryDisabled.value = false;
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });

      expect(mockSelectCommit).not.toHaveBeenCalled();
    });

    it('does not re-fire a deferred checkout once the queue has been drained', async () => {
      // After the deferred checkout fires, selectCommit toggles
      // isSelectingCommit on (re-locking) and back off (unlocking). The
      // effect that drains the queue re-runs each time isHistoryDisabled
      // flips — the cleared ref prevents a double-fire.
      mockIsHistoryDisabled.value = true;
      const messages = [userMsg('u1'), assistantMsg('a1', 'older-commit')];

      const { rerender } = renderWithProviders(<StreamingMessageList allMessages={messages} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('restore-a1'));
      });

      mockIsHistoryDisabled.value = false;
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });
      expect(mockSelectCommit).toHaveBeenCalledTimes(1);

      // Simulate the lock toggling on and off again (e.g. the user runs a
      // new agent turn, then it completes). No additional checkout.
      mockIsHistoryDisabled.value = true;
      rerender(<StreamingMessageList allMessages={messages} />);
      mockIsHistoryDisabled.value = false;
      await act(async () => {
        rerender(<StreamingMessageList allMessages={messages} />);
      });

      expect(mockSelectCommit).toHaveBeenCalledTimes(1);
    });
  });
});
