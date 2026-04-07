/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import Growl from '@ux/growl';

import { ChatTab } from '@/app/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import ChatPane from './ChatPane';

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}));

// Mock child components
vi.mock('@/app/develop/components/chat/ChatInput', () => ({
  default: ({ onSendMessage, inputValue, onInputChange, isBudgetExceeded, isDisabled, onLargePasteDetected, referencedFiles }: any) => (
    <div data-testid="chat-input" data-budget-exceeded={isBudgetExceeded} data-disabled={isDisabled}>
      <input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Type a message"
        disabled={isDisabled}
      />
      <button onClick={onSendMessage}>Send</button>
      {onLargePasteDetected && (
        <>
          <button data-testid="simulate-large-paste" onClick={() => onLargePasteDetected('x'.repeat(6000))}>Paste</button>
          <button data-testid="simulate-empty-paste" onClick={() => onLargePasteDetected('')}>Empty paste</button>
          <button data-testid="simulate-whitespace-paste" onClick={() => onLargePasteDetected('   \n  ')}>Whitespace paste</button>
        </>
      )}
      {referencedFiles?.map((f: any) => (
        <span key={f.path} data-testid="referenced-file">{f.path}</span>
      ))}
    </div>
  ),
}));

vi.mock('@/app/develop/components/chat/ChatToolbar', () => ({
  default: ({ ventureId }: any) => (
    <div data-testid="chat-toolbar">Venture: {ventureId}</div>
  ),
}));

vi.mock('@/app/develop/components/StreamingMessageList', () => ({
  default: ({ messages }: any) => (
    <div data-testid="message-list">Messages: {messages?.length ?? 0}</div>
  ),
}));

vi.mock('@/app/develop/components/VersionHistory', () => ({
  default: () => <div data-testid="version-history">Version History</div>,
}));

vi.mock('@/app/develop/components/preview/PreviewPane', () => ({
  default: () => <div data-testid="preview-pane">Preview Pane</div>,
}));

vi.mock('@/app/develop/components/settings/SettingsView', () => ({
  default: () => <div data-testid="settings-view">Settings View</div>,
}));

vi.mock('@/app/develop/components/PlanTracker', () => ({
  default: () => <div data-testid="plan-tracker">Plan Tracker</div>,
}));

vi.mock('@/app/develop/components/PersistentTodoList', () => ({
  default: () => <div data-testid="todo-list">Todo List</div>,
}));

vi.mock('@/app/develop/components/chat/BudgetExceededBanner', () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="budget-exceeded-banner">
      {onClose && <button onClick={onClose}>Close</button>}
    </div>
  ),
}));

// Mock stores
const mockStreamingStore = {
  inputValue: '',
  isLoading: false,
  currentAppId: 'test-app-123',
  isActivelyStreaming: false,
  messages: [] as any[],
  activeStream: null as any,
  developmentPlan: null,
  aiEditContext: null,
  buildErrorContext: null,
  historyLoadingComplete: true,
  setInputValue: vi.fn(),
  setAiEditContext: vi.fn(),
  setBuildErrorContext: vi.fn(),
  setCurrentAppId: vi.fn(),
};

const mockDevelopPageStore = {
  expandedPlan: false,
  isMobile: false,
  toggleExpandedPlan: vi.fn(),
  setIsVersionHistoryOpen: vi.fn(),
};
const mockChatTabs = {
  activeChatTab: ChatTab.CHAT,
  setActiveChatTab: vi.fn(),
  activeSettingsSection: 'domain',
  setActiveSettingsSection: vi.fn(),
};

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useMessages: () => mockStreamingStore.messages,
  useActiveStream: () => mockStreamingStore.activeStream,
  useInputValue: () => mockStreamingStore.inputValue,
  useIsLoading: () => mockStreamingStore.isLoading,
  useCurrentAppId: () => mockStreamingStore.currentAppId,
  useIsActivelyStreaming: () => mockStreamingStore.isActivelyStreaming,
  useDevelopmentPlan: () => mockStreamingStore.developmentPlan,
  useAiEditContext: () => mockStreamingStore.aiEditContext,
  useBuildErrorContext: () => mockStreamingStore.buildErrorContext,
  useBudgetExceeded: () => mockStreamingStore.activeStream?.budgetExceeded === true || mockStreamingStore.messages[mockStreamingStore.messages.length - 1]?.budgetExceeded === true,
  useSetInputValue: () => mockStreamingStore.setInputValue,
  useSetAiEditContext: () => mockStreamingStore.setAiEditContext,
  useSetBuildErrorContext: () => mockStreamingStore.setBuildErrorContext,
  useSetCurrentAppId: () => mockStreamingStore.setCurrentAppId,
  useHistoryLoadingComplete: () => mockStreamingStore.historyLoadingComplete,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopPageStore),
}));
vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => mockChatTabs,
}));

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-123',
}));

// Mock grants-related hooks and utilities
const mockSubscriptionData = { data: undefined as { id: string } | undefined };
const mockGrantsData = { data: undefined as any[] | undefined, isFetching: false };
const mockActiveGrant = { result: undefined as any };

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockSubscriptionData,
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => mockGrantsData,
}));

vi.mock('@/utils/credits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/credits')>()),
  getActiveGrant: () => mockActiveGrant.result,
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock auth context — default to non-impersonation session
const mockAuthContextState: { authState: any } = { authState: null };
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContextState,
}));

vi.mock('@/utils/instrumentation', () => ({
  logAiroHQEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
  logClickEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe('ChatPane', () => {
  const mockSendMessage = vi.fn();
  const mockStopGeneration = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.isMobile = false;
    mockChatTabs.activeChatTab = ChatTab.CHAT;
    mockStreamingStore.messages = [];
    mockStreamingStore.activeStream = null;
    mockStreamingStore.inputValue = '';
    mockStreamingStore.isLoading = false;
    mockStreamingStore.isActivelyStreaming = false;
    mockStreamingStore.historyLoadingComplete = true;

    // Reset grants-related mocks
    mockSubscriptionData.data = undefined;
    mockGrantsData.data = undefined;
    mockGrantsData.isFetching = false;
    mockActiveGrant.result = undefined;

    // Reset auth context mock to non-impersonation session
    mockAuthContextState.authState = null;

    // Mock fetch for ventureId
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ventureId: 'venture-123' }),
      } as Response)
    );
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('should render chat input', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('should render chat toolbar', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('chat-toolbar')).toBeInTheDocument();
  });

  it('should render message list', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('message-list')).toBeInTheDocument();
  });

  it('should show version history when HISTORY tab is active', () => {
    mockChatTabs.activeChatTab = ChatTab.HISTORY;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('version-history')).toBeInTheDocument();
  });

  it('should fall back to CHAT tab on desktop if PREVIEW is selected', () => {
    mockChatTabs.activeChatTab = ChatTab.PREVIEW;
    mockDevelopPageStore.isMobile = false;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(mockChatTabs.setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
  });

  it('should fetch ventureId on mount', async () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    await waitFor(() => {
      const urls = (global.fetch as any).mock.calls.map((call: any[]) => String(call[0]))
      expect(urls.some((u: string) => u.endsWith('/api/venture'))).toBe(true)
    });
  });

  it('should handle sendMessage prop', () => {
    const sendMessage = vi.fn();

    renderWithProviders(<ChatPane sendMessage={sendMessage} stopGeneration={vi.fn()} />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  describe('input disabled during recovery', () => {
    it('should not disable input when only historyLoadingComplete is false', () => {
      // History loads asynchronously in the background — user must be free to type
      // immediately. historyLoadingComplete no longer gates the input.
      mockStreamingStore.historyLoadingComplete = false;
      mockStreamingStore.isLoading = false;
      mockStreamingStore.isActivelyStreaming = false;
      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-disabled', 'false');
    });

    it('should enable input when historyLoadingComplete is true and not streaming', () => {
      mockStreamingStore.historyLoadingComplete = true;
      mockStreamingStore.isLoading = false;
      mockStreamingStore.isActivelyStreaming = false;
      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-disabled', 'false');
    });
  });

  describe('airo-error-fix event', () => {
    it('should send message when airo-error-fix fires with matching appId and input', () => {
      mockStreamingStore.inputValue = 'fix this error'
      const sendMessage = vi.fn()

      renderWithProviders(<ChatPane sendMessage={sendMessage} stopGeneration={vi.fn()} />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent('airo-error-fix', { detail: { appId: 'test-app-123' } })
        )
      })

      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'fix this error',
          aiEditContext: expect.objectContaining({ screenshot: null }),
          selectedAssets: undefined
        })
      )
    })

    it('should not send message when airo-error-fix fires with mismatched appId', () => {
      mockStreamingStore.inputValue = 'fix this error'
      const sendMessage = vi.fn()

      renderWithProviders(<ChatPane sendMessage={sendMessage} stopGeneration={vi.fn()} />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent('airo-error-fix', { detail: { appId: 'different-app' } })
        )
      })

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('should not send message when airo-error-fix fires with empty input', () => {
      mockStreamingStore.inputValue = ''
      const sendMessage = vi.fn()

      renderWithProviders(<ChatPane sendMessage={sendMessage} stopGeneration={vi.fn()} />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent('airo-error-fix', { detail: { appId: 'test-app-123' } })
        )
      })

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('should not send message when isLoading is true', () => {
      mockStreamingStore.inputValue = 'fix this error'
      mockStreamingStore.isLoading = true
      const sendMessage = vi.fn()

      renderWithProviders(<ChatPane sendMessage={sendMessage} stopGeneration={vi.fn()} />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent('airo-error-fix', { detail: { appId: 'test-app-123' } })
        )
      })

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('should not send message when isActivelyStreaming is true', () => {
      mockStreamingStore.inputValue = 'fix this error'
      mockStreamingStore.isActivelyStreaming = true
      const sendMessage = vi.fn()

      renderWithProviders(<ChatPane sendMessage={sendMessage} stopGeneration={vi.fn()} />)

      act(() => {
        window.dispatchEvent(
          new CustomEvent('airo-error-fix', { detail: { appId: 'test-app-123' } })
        )
      })

      expect(sendMessage).not.toHaveBeenCalled()
    })
  })

  it('should render plan tracker when development plan exists', () => {
    mockStreamingStore.developmentPlan = { phases: [] };

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('plan-tracker')).toBeInTheDocument();
  });

  it('should not render rebuild context panel', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.queryByText(/rebuild mode/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/loading rebuild context/i)).not.toBeInTheDocument();
  });

  describe('budget exceeded with grants', () => {
    it('should not disable input when budget exceeded flag is false', () => {
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should disable input when budget exceeded and grants feature is disabled', () => {
      mockStreamingStore.messages = [{ budgetExceeded: true }];


      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should disable input when budget exceeded, grants enabled, but no available credits', () => {
      mockStreamingStore.messages = [{ budgetExceeded: true }];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined; // No active grant available

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should NOT disable input when budget exceeded but grants show available credits', () => {
      mockStreamingStore.messages = [{ budgetExceeded: true }];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 50, creditsMax: 100 }];
      mockActiveGrant.result = { id: 'grant-1' }; // Active grant available

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should disable input when budget flag is set and grants are still loading', () => {
      // This tests the safe fallback: if user previously hit budget exceeded
      // and grants haven't loaded yet, we can't confirm they have credits,
      // so we default to disabled. This does NOT affect users who never hit
      // budget exceeded (budgetExceededFlag would be false).
      mockStreamingStore.messages = [{ budgetExceeded: true }];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = undefined; // Still loading

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should NOT disable input during grants loading if budget flag was never set', () => {
      // Users who never hit budget exceeded should not see disabled state
      // during grants loading - the flag check comes first
      mockStreamingStore.messages = []; // No budget exceeded in history
      mockStreamingStore.activeStream = null;

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = undefined; // Still loading

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should disable input when grants enabled but grants array is empty', () => {
      mockStreamingStore.messages = [{ budgetExceeded: true }];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should check active stream for budget exceeded flag', () => {
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = { budgetExceeded: true };


      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should enable input after page refresh when user has credits (rehydrated history)', () => {
      // Simulates: user hit budget exceeded, refreshed page, now has credits
      // History shows budgetExceeded but grants show available credits
      mockStreamingStore.messages = [
        { content: 'Hello' },
        { content: 'Budget exceeded', budgetExceeded: true }, // Last message from history
      ];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 0, creditsMax: 100 }];
      mockActiveGrant.result = { id: 'grant-1' }; // Fresh grant available

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should enable input when user purchases credits mid-session (grants update)', () => {
      // Simulates: user hit budget exceeded, purchased credits, grants refetched
      // The flag is still true from last message but grants now show credits
      mockStreamingStore.messages = [{ budgetExceeded: true }];

      mockSubscriptionData.data = { id: 'sub-123' };
      // After purchase, grants data updates with new credit pack
      mockGrantsData.data = [
        { id: 'monthly', creditsSpent: 100, creditsMax: 100 }, // Exhausted monthly
        { id: 'credit-pack-new', creditsSpent: 0, creditsMax: 500 }, // New purchase
      ];
      mockActiveGrant.result = { id: 'credit-pack-new' }; // New pack is active

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should disable input proactively when grants loaded and exhausted with no prior budget error', () => {
      // NEW: proactive check — user opens the page with credits already exhausted
      // but has never sent a message yet (no budget error in message history)
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined; // No active grant

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should disable input proactively when grants loaded as empty array with no prior budget error', () => {
      // NEW: proactive check — user has grants enabled but no grants at all
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should NOT disable input proactively while grants are still loading', () => {
      // Loading state safety — grants undefined means fetch in progress, do not block
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = undefined; // Still fetching

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should keep input disabled when budgetExceededFlag is true even while stale grants are refetching', () => {
      // budgetExceededFlag=true + isFetching=true + stale exhausted grants:
      // grantsLoaded=false (isFetching guard) but budgetExceededFlag still drives budgetExceeded=true.
      // The user hit the limit mid-session; a background refetch does not re-enable the input.
      mockStreamingStore.messages = [{ budgetExceeded: true }];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }]; // Stale exhausted
      mockGrantsData.isFetching = true; // Background refetch in progress
      mockActiveGrant.result = undefined; // No active grant in stale data

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });

    it('should NOT disable input proactively when stale exhausted cache is being background-refetched', () => {
      // Stale cache false-positive guard: React Query returns cached (exhausted) data immediately
      // while silently refetching. The user may have purchased credits between page visits.
      // isFetching=true means a background refetch is in progress — don't block until it resolves.
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }]; // Stale: looks exhausted
      mockGrantsData.isFetching = true; // Background refetch in progress
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should hide proactive banner after user dismisses it', async function dismissBanner() {
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

      await waitFor(function assertBannerVisible() {
        expect(screen.getByTestId('budget-exceeded-banner')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByTestId('budget-exceeded-banner')).not.toBeInTheDocument();
    });
  });

  describe('large paste detection', () => {
    it('should convert large paste to referenced file attachment', async function convertPaste() {
      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByTestId('simulate-large-paste'));

      await waitFor(function assertFileAdded() {
        const files = screen.getAllByTestId('referenced-file');
        expect(files).toHaveLength(1);
        expect(files[0].textContent).toMatch(/^pasted-content-.*\.txt$/);
      });

      expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'chat-large-paste-attachment',
          emphasis: 'info',
          lifetime: 5000,
        })
      );
    });

    it('should ignore empty large-paste callback without attachment or growl', async function emptyPaste() {
      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByTestId('simulate-empty-paste'));

      await waitFor(function assertNoFile() {
        expect(screen.queryAllByTestId('referenced-file')).toHaveLength(0);
      });
      expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
    });

    it('should ignore whitespace-only large-paste callback', async function whitespacePaste() {
      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByTestId('simulate-whitespace-paste'));

      await waitFor(function assertNoFile() {
        expect(screen.queryAllByTestId('referenced-file')).toHaveLength(0);
      });
      expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
    });
  });

  describe('CRM skip / impersonation session', function impersonationTests() {
    it('should keep chat enabled for e2s session even when budget is exceeded', function e2sBudgetBypass() {
      mockAuthContextState.authState = { authType: 'e2s' };
      mockStreamingStore.messages = [{ budgetExceeded: true }];


      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should keep chat enabled for e2s2s session even when budget is exceeded', function e2s2sBudgetBypass() {
      mockAuthContextState.authState = { authType: 'e2s2s' };
      mockStreamingStore.messages = [{ budgetExceeded: true }];


      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should keep chat enabled for e2s session even with exhausted grants', function e2sExhaustedGrants() {
      mockAuthContextState.authState = { authType: 'e2s' };
      mockStreamingStore.messages = [];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'false');
    });

    it('should still disable chat for basic auth sessions when budget is exceeded', function basicBudgetExceeded() {
      mockAuthContextState.authState = { authType: 'basic' };
      mockStreamingStore.messages = [{ budgetExceeded: true }];


      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      const chatInput = screen.getByTestId('chat-input');
      expect(chatInput).toHaveAttribute('data-budget-exceeded', 'true');
    });
  });
});
