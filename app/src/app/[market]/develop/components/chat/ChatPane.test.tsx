/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import Growl from '@ux/growl';

import { ChatTab } from '@/app/[market]/develop/components/types';
import { getFileUploadAgent } from '@/lib/file-agent';
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore';
import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import { MAX_FILE_SIZE, MAX_TOTAL_ASSETS } from '@/utils/file-upload-validation';
import ChatPane from './ChatPane';

vi.mock('@/lib/file-agent', () => ({
  getFileUploadAgent: vi.fn(),
}));

const mockSiteData: { agentUrl: string | undefined } = { agentUrl: 'http://localhost:4000' };
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: any) => selector({
    getSite: () => ({ agent_url: mockSiteData.agentUrl }),
  }),
}));

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}));

// Mock child components
vi.mock('@/app/[market]/develop/components/chat/ChatInput', () => ({
  default: ({ onSendMessage, inputValue, onInputChange, isDisabled, isAwaitingStream, isStreaming, onLargePasteDetected, onScreenshotCaptured, onUploadError, onStageFiles, onClearSelectedAsset, onRemoveStagedFile, selectedAssets, stagedFiles, referencedFiles, mediaLimitError }: any) => (
    <div
      data-testid="chat-input"
      data-disabled={isDisabled}
      data-awaiting-stream={isAwaitingStream ? 'true' : 'false'}
      data-streaming={isStreaming ? 'true' : 'false'}
    >
      {mediaLimitError && (
        <div role="alert" data-testid="chat-attachment-limit-error">
          {mediaLimitError}
        </div>
      )}
      <input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Type a message"
        disabled={isDisabled}
      />
      <button onClick={() => onSendMessage()}>Send</button>
      {onLargePasteDetected && (
        <>
          <button data-testid="simulate-large-paste" onClick={() => onLargePasteDetected('x'.repeat(6000))}>Paste</button>
          <button data-testid="simulate-empty-paste" onClick={() => onLargePasteDetected('')}>Empty paste</button>
          <button data-testid="simulate-whitespace-paste" onClick={() => onLargePasteDetected('   \n  ')}>Whitespace paste</button>
        </>
      )}
      {onScreenshotCaptured && (
        <button data-testid="simulate-screenshot" onClick={() => onScreenshotCaptured('data:image/jpeg;base64,/9j/fakedata')}>Screenshot</button>
      )}
      {onUploadError && (
        <button data-testid="simulate-attachment-error" onClick={() => onUploadError('builder_chatfiles_error_max_attachments')}>Error</button>
      )}
      {onStageFiles && (
        <>
          <button
            data-testid="simulate-stage-file"
            onClick={() => onStageFiles([new File(['small'], 'small.txt', { type: 'text/plain' })])}
          >
            Stage
          </button>
          <button
            data-testid="simulate-stage-oversized-file"
            onClick={() => onStageFiles([new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'huge.bin', { type: 'application/octet-stream' })])}
          >
            Stage oversized
          </button>
        </>
      )}
      {selectedAssets?.map((a: any, i: number) => (
        <span key={i} data-testid="selected-asset" data-url={a.imageUrl}>
          {a.filename}
          {onClearSelectedAsset && (
            <button type="button" data-testid={`clear-asset-${i}`} onClick={() => onClearSelectedAsset(i)}>×</button>
          )}
        </span>
      ))}
      {stagedFiles?.map((s: any) => (
        <span key={s.id} data-testid="staged-file">
          {s.file.name}
          {onRemoveStagedFile && (
            <button type="button" data-testid={`clear-staged-${s.id}`} onClick={() => onRemoveStagedFile(s.id)}>×</button>
          )}
        </span>
      ))}
      {referencedFiles?.map((f: any) => (
        <span key={f.path} data-testid="referenced-file">{f.path}</span>
      ))}
    </div>
  ),
}));

vi.mock('@/app/[market]/develop/components/chat/ChatToolbar', () => ({
  default: ({ ventureId }: any) => (
    <div data-testid="chat-toolbar">Venture: {ventureId}</div>
  ),
}));

vi.mock('@/app/[market]/develop/components/StreamingMessageList', () => ({
  default: ({ allMessages, transcriptFooter }: any) => (
    <div data-testid="message-list">
      Messages: {allMessages?.length ?? 0}
      {transcriptFooter}
    </div>
  ),
}));

vi.mock('@/app/[market]/develop/components/VersionHistory', () => ({
  default: () => <div data-testid="version-history">Version History</div>,
}));

vi.mock('@/app/[market]/develop/components/preview/PreviewPane', () => ({
  default: () => <div data-testid="preview-pane">Preview Pane</div>,
}));

vi.mock('@/app/[market]/develop/components/settings/SettingsView', () => ({
  default: () => <div data-testid="settings-view">Settings View</div>,
}));

vi.mock('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel', () => ({
  default: () => <div data-testid="analytics-panel">Analytics Panel</div>,
}));

vi.mock('@/app/[market]/develop/components/media/MediaPanel', () => ({
  default: () => <div data-testid="media-panel">Media Panel</div>,
}));

vi.mock('@/app/[market]/develop/components/PanelSkeleton', () => ({
  default: () => <div data-testid="panel-skeleton">Loading...</div>,
}));

vi.mock('@/app/[market]/develop/components/PlanTracker', () => ({
  default: () => <div data-testid="plan-tracker">Plan Tracker</div>,
}));

vi.mock('@/app/[market]/develop/components/PersistentTodoList', () => ({
  default: () => <div data-testid="todo-list">Todo List</div>,
}));


// Mock stores
const mockStreamingStore = {
  inputValue: '',
  isLoading: false,
  currentAppId: 'test-app-123',
  isActivelyStreaming: false,
  streamingState: 'idle' as 'idle' | 'streaming' | 'completing' | 'retrying' | 'error',
  messages: [] as any[],
  activeStream: null as any,
  developmentPlan: null,
  aiEditContext: null,
  aiEditContexts: [] as any[],
  buildErrorContext: null,
  historyLoadingComplete: true,
  setInputValue: vi.fn(),
  setAiEditContext: vi.fn(),
  addAiEditContext: vi.fn(),
  removeAiEditContext: vi.fn(),
  clearAiEditContexts: vi.fn(),
  setBuildErrorContext: vi.fn(),
  setCurrentAppId: vi.fn(),
};

const mockDevelopPageStore = {
  expandedPlan: false,
  isMobile: false,
  toggleExpandedPlan: vi.fn(),
  setIsVersionHistoryOpen: vi.fn(),
  getPublishState: vi.fn(function () { return {
    isPublishing: false,
    publishError: false,
    buildErrorDetails: null,
    lastPublishedCommitHash: null,
    deploymentsRefetch: null,
    deploymentInProgressId: null,
    showSuccessAlert: false,
    showPaywallModal: false,
    showPublishLimitModal: false,
    publishLimitData: null,
    showFirstPublishCongrats: false,
    firstPublishDeployPending: false,
    hasGoneLive: false,
    wentLiveAt: null,
    showGoLiveModal: false,
    goLiveModalDismissed: false,
    goLiveModalStep: null,
    securityScanResults: null,
    launchVideoResult: null,
    featureSelections: null,
    marketingSelections: null,
  }; }),
};
const mockChatTabs = {
  activeChatTab: ChatTab.CHAT,
  setActiveChatTab: vi.fn(),
  activeSettingsSection: 'domain',
  setActiveSettingsSection: vi.fn(),
};

vi.mock('@/stores/useStreamingConversationStore', () => {
  const mockPersistHistory = vi.fn()
  const mockResolvedSecretsComposerToolCallIds: Record<string, true> = {}
  const queueState = {
    enqueueMessage: vi.fn(() => true),
    setQueueStoppedOnError: vi.fn(),
    takeNextQueuedMessage: vi.fn(() => null),
    retryState: { isRetrying: false, retryCount: 0 },
    queuedMessages: [] as unknown[],
  }

  function streamingGetState() {
    return {
      ...queueState,
      aiEditContext: mockStreamingStore.aiEditContext,
      currentAppId: mockStreamingStore.currentAppId,
      persistHistory: mockPersistHistory,
      resolvedSecretsComposerToolCallIds: mockResolvedSecretsComposerToolCallIds,
    }
  }

  function useStreamingConversationStore(selector: (s: ReturnType<typeof streamingGetState>) => unknown) {
    return selector(streamingGetState())
  }
  Object.assign(useStreamingConversationStore, { getState: streamingGetState })

  return {
    QUEUE_MAX: 10,
    useMessages: () => mockStreamingStore.messages,
    useActiveStream: () => mockStreamingStore.activeStream,
    useInputValue: () => mockStreamingStore.inputValue,
    useIsLoading: () => mockStreamingStore.isLoading,
    useCurrentAppId: () => mockStreamingStore.currentAppId,
    useIsActivelyStreaming: () => mockStreamingStore.isActivelyStreaming,
    useStreamingState: () => mockStreamingStore.streamingState,
    useDevelopmentPlan: () => mockStreamingStore.developmentPlan,
    useAiEditContext: () => mockStreamingStore.aiEditContext,
    useAiEditContexts: () => mockStreamingStore.aiEditContexts,
    useBuildErrorContext: () => mockStreamingStore.buildErrorContext,
    useBudgetExceeded: () => mockStreamingStore.activeStream?.budgetExceeded === true || mockStreamingStore.messages[mockStreamingStore.messages.length - 1]?.budgetExceeded === true,
    useSetInputValue: () => mockStreamingStore.setInputValue,
    useSetAiEditContext: () => mockStreamingStore.setAiEditContext,
    useQueuedMessages: () => [],
    useIsQueueStoppedOnError: () => false,
    useQueueLength: () => 0,
    useStreamingConversationStore,
    useRemoveAiEditContext: () => mockStreamingStore.removeAiEditContext,
    useClearAiEditContexts: () => mockStreamingStore.clearAiEditContexts,
    useSetBuildErrorContext: () => mockStreamingStore.setBuildErrorContext,
    useSetCurrentAppId: () => mockStreamingStore.setCurrentAppId,
    useHistoryLoadingComplete: () => mockStreamingStore.historyLoadingComplete,
    useWebSocketState: () => ({ connected: true, status: 'idle' }),
  }
});

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopPageStore),
}));
vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => mockChatTabs,
}));

const mockAppIdFromParams = vi.hoisted(() => ({ value: 'test-app-123' }));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => mockAppIdFromParams.value,
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

// Mock switchboard — default to budget-service OFF (grants path)
const mockSwitchboardValues: Record<string, any> = {};
vi.mock('@/hooks/useSwitchboard', () => {
  const read = (flag: string) => mockSwitchboardValues[flag] ?? false;
  return { useSwitchboard: read, getSwitchboardFlag: read };
});

// Mock auth context — default to non-impersonation session
const mockAuthContextState: { tokenAuthType: string | undefined } = { tokenAuthType: undefined };
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContextState,
}));

vi.mock('@/utils/instrumentation', () => mockInstrumentation());

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => false,
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
    mockStreamingStore.aiEditContext = null;
    mockAppIdFromParams.value = 'test-app-123';

    // Reset grants-related mocks
    mockSubscriptionData.data = undefined;
    mockGrantsData.data = undefined;
    mockGrantsData.isFetching = false;
    mockActiveGrant.result = undefined;

    // Reset auth context mock to non-impersonation session
    mockAuthContextState.tokenAuthType = undefined;

    // Reset switchboard mocks
    Object.keys(mockSwitchboardValues).forEach((k) => delete mockSwitchboardValues[k]);

    // Reset site store agent URL to the default
    mockSiteData.agentUrl = 'http://localhost:4000';

    // Mock fetch for ventureId
    global.fetch = vi.fn(function () { return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ventureId: 'venture-123' }),
      } as Response); }
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

  it('should default isAwaitingStream to false on ChatInput when prop omitted', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-awaiting-stream', 'false');
  });

  it('should forward isAwaitingStream prop to ChatInput', () => {
    renderWithProviders(
      <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} isAwaitingStream={true} />
    );

    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-awaiting-stream', 'true');
  });

  it('should render chat toolbar', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('chat-toolbar')).toBeInTheDocument();
  });

  it('should render message list', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('message-list')).toBeInTheDocument();
  });

  it('should show version history when HISTORY tab is active', async () => {
    mockChatTabs.activeChatTab = ChatTab.HISTORY;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    await waitFor(() => {
      expect(screen.getByTestId('version-history')).toBeInTheDocument();
    });
  });

  it('should show media panel when MEDIAS tab is active', async () => {
    mockChatTabs.activeChatTab = ChatTab.MEDIAS;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    await waitFor(() => {
      expect(screen.getByTestId('media-panel')).toBeInTheDocument();
    });
  });

  it('should show analytics panel when ANALYTICS tab is active', async () => {
    mockChatTabs.activeChatTab = ChatTab.ANALYTICS;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-panel')).toBeInTheDocument();
    });
  });

  it('should show settings view when SETTINGS tab is active', async () => {
    mockChatTabs.activeChatTab = ChatTab.SETTINGS;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-view')).toBeInTheDocument();
    });
  });

  it('should not mount tab panels until their tab is visited', () => {
    mockChatTabs.activeChatTab = ChatTab.CHAT;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.queryByTestId('version-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('media-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-view')).not.toBeInTheDocument();
  });

  it('should keep a visited panel in the DOM with display:none after switching away', async () => {
    mockChatTabs.activeChatTab = ChatTab.HISTORY;

    const { rerender } = renderWithProviders(
      <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('version-history')).toBeInTheDocument();
    });

    const historyWrapper = screen.getByTestId('version-history').parentElement!;
    expect(historyWrapper.style.display).toBe('flex');

    mockChatTabs.activeChatTab = ChatTab.CHAT;
    rerender(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

    expect(screen.getByTestId('version-history')).toBeInTheDocument();
    expect(historyWrapper.style.display).toBe('none');
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

  describe('handleSendMessage empty prompt text', () => {
    it('should not call sendMessage when Send clicked with empty input', async function emptyPromptOnSend() {
      mockStreamingStore.inputValue = '';
      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should not call sendMessage when input is whitespace only', async function whitespaceOnlyPrompt() {
      mockStreamingStore.inputValue = '   \n\t  ';
      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should call sendMessage when referenced files exist but prompt text is empty', async function refsWithoutPrompt() {
      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByTestId('simulate-large-paste'));

      await waitFor(function assertReferencedFile() {
        expect(screen.getAllByTestId('referenced-file')).toHaveLength(1);
      });

      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(mockSendMessage).toHaveBeenCalledOnce();
    });
  });

  describe('full-pane loader during recovery', () => {
    it('should disable input when loadingMessage is set', () => {
      mockStreamingStore.isLoading = false;
      mockStreamingStore.isActivelyStreaming = false;
      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} loadingMessage="Loading..." />);

      expect(screen.getByTestId('chat-input')).toHaveAttribute('data-disabled', 'true');
    });

    it('should enable input when loadingMessage is null and not streaming', () => {
      mockStreamingStore.isLoading = false;
      mockStreamingStore.isActivelyStreaming = false;
      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} loadingMessage={null} />);

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

  describe('proactive budget banner', () => {
    // Input is no longer budget-gated at the ChatPane layer (the request-layer
    // purchase-intent bypass handles 0-credit submissions). The remaining UI
    // signal driven by `budgetExceeded` is the proactive banner — these tests
    // cover when it should and shouldn't appear.

    it('does not render when there is no budget signal and credits are unknown', () => {
      // beforeEach: messages=[], no subscription/grants → budgetExceeded=false
      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('renders proactively when grants are loaded and exhausted with no prior stream signal', async () => {
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      await waitFor(() => {
        expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
      });
    });

    it('does not render when a stream message already signaled budget exceeded (inline banner takes over)', () => {
      // budgetExceededFlag=true → proactive banner is suppressed; the inline
      // banner inside StreamingMessageList shows instead.
      mockStreamingStore.messages = [{ budgetExceeded: true }];
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('does not render when grants show available credits even after a prior stream signal', () => {
      mockStreamingStore.messages = [{ budgetExceeded: true }];
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 50, creditsMax: 100 }];
      mockActiveGrant.result = { id: 'grant-1' };

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('does not render while grants are still loading with no prior stream signal', () => {
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('does not render during provisioning when grants resolve to an empty array', () => {
      // Empty grants means the subscription is still provisioning — not exhausted.
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('does not render during a stale-cache background refetch', () => {
      // isFetching=true means a background refetch is in progress; don't show
      // the proactive banner against possibly-stale exhausted data.
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockGrantsData.isFetching = true;
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('hides after user dismisses it', async function dismissBanner() {
      mockStreamingStore.messages = [];
      mockStreamingStore.activeStream = null;
      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      await waitFor(function assertBannerVisible() {
        expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
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
    it('does not render the proactive banner for e2s session even with exhausted grants', function e2sExhaustedGrants() {
      mockAuthContextState.tokenAuthType = 'e2s';
      mockStreamingStore.messages = [];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });

    it('does not render the proactive banner for e2s2s session even with exhausted grants', function e2s2sExhaustedGrants() {
      mockAuthContextState.tokenAuthType = 'e2s2s';
      mockStreamingStore.messages = [];

      mockSubscriptionData.data = { id: 'sub-123' };
      mockGrantsData.data = [{ id: 'grant-1', creditsSpent: 100, creditsMax: 100 }];
      mockActiveGrant.result = undefined;

      renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      expect(screen.queryByText('builder_usage_limit_title')).not.toBeInTheDocument();
    });
  });

  describe('screenshot capture', function screenshotTests() {
    const FAKE_DATA_URL = 'data:image/jpeg;base64,/9j/fakedata';
    const UPLOAD_URL = 'http://localhost:4000/files/upload';

    function makeFetch({ uploadOk = true, uploadError = '', emptyFiles = false, fileCount = 1 } = {}) {
      return vi.fn(function (url: string) {
        if (url.endsWith('/api/venture')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ventureId: 'v-123' }) } as Response);
        }
        if (url.startsWith('data:')) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' })) } as Response);
        }
        if (uploadOk) {
          // Each file gets a unique signedUrl so the dedup-by-imageUrl filter does not
          // strip them, allowing tests to exercise the cap path with one upload call.
          const files = emptyFiles
            ? []
            : Array.from({ length: fileCount }, (_, i) => ({
                id: `f${i}`,
                originalName: `screenshot-${i}.jpg`,
                filename: `screenshot-${i}.jpg`,
                size: 1024,
                mimeType: 'image/jpeg',
                uploadedAt: '2026-01-01',
                signedUrl: `/files/signed/abc-${i}.jpg`,
              }));
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              uploadId: 'upload-123',
              files,
              failedFiles: [],
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: uploadError || 'Upload failed' }),
        } as Response);
      });
    }

    beforeEach(() => {
      vi.mocked(getFileUploadAgent).mockResolvedValue({ token: 'test-token', uploadUrl: UPLOAD_URL });
    });

    it('should POST a multipart upload carrying a real image/jpeg File (not a data: URL)', async function uploadAsMultipart() {
      // Pins both the request shape (POST + FormData) and the payload contract
      // (real File of image/jpeg, never a serialized data: URL string).
      global.fetch = makeFetch();

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertUpload() {
        const calls = vi.mocked(global.fetch).mock.calls;
        const uploadCall = calls.find(([url]) => String(url) === UPLOAD_URL);
        expect(uploadCall).toBeDefined();
        expect(uploadCall![1]?.method).toBe('POST');
        const body = uploadCall![1]?.body as FormData;
        expect(body).toBeInstanceOf(FormData);
        const uploaded = body.get('files');
        expect(uploaded).toBeInstanceOf(File);
        expect((uploaded as File).type).toBe('image/jpeg');
      });
    });

    it('should send a server URL (not a data: URL) in the sendMessage payload', async function noBase64InPayload() {
      global.fetch = makeFetch();
      mockStreamingStore.inputValue = 'fix this';
      const sendMessage = vi.fn();

      const { user } = renderWithProviders(
        <ChatPane sendMessage={sendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByTestId('simulate-screenshot'));
      await waitFor(function assertAssetAttached() {
        expect(screen.getAllByTestId('selected-asset')).toHaveLength(1);
      });

      await user.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(function assertPayload() {
        expect(sendMessage).toHaveBeenCalled();
      });
      const payload = sendMessage.mock.calls[0][0];
      expect(payload.selectedAssets).toBeDefined();
      expect(payload.selectedAssets).toHaveLength(1);
      expect(payload.selectedAssets[0].imageUrl).not.toMatch(/^data:/);
      expect(payload.selectedAssets[0].imageUrl).toBe('http://localhost:4000/files/signed/abc-0.jpg');
    });

    it('should show an error banner when the upload fails', async function uploadFail() {
      global.fetch = makeFetch({ uploadOk: false, uploadError: 'Server error' });

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertError() {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
      // No partial state must leak into the UI when the upload throws
      expect(screen.queryAllByTestId('selected-asset')).toHaveLength(0);
    });

    it('should show an error and skip the asset when the server returns an empty files array', async function emptyFiles() {
      global.fetch = makeFetch({ emptyFiles: true });

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertError() {
        expect(screen.getByText('builder_chatfiles_error_upload_failed')).toBeInTheDocument();
      });
      expect(screen.queryAllByTestId('selected-asset')).toHaveLength(0);
    });

    it('should fall back to the default error message when the server returns a non-JSON error body', async function nonJsonErrorBody() {
      // Simulates a misbehaving gateway returning HTML for a 500 instead of JSON.
      // The inner json() reject must NOT surface as a SyntaxError to the user;
      // the default `Upload failed (500)` message should be shown.
      global.fetch = vi.fn(function (url: string) {
        if (url.endsWith('/api/venture')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ventureId: 'v-123' }) } as Response);
        }
        if (url.startsWith('data:')) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' })) } as Response);
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
        } as Response);
      });

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertError() {
        expect(screen.getByText('Upload failed (500)')).toBeInTheDocument();
      });
      expect(screen.queryByText(/Unexpected token/i)).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('selected-asset')).toHaveLength(0);
    });

    it('should show the localized error when the server returns a non-JSON success body', async function nonJsonSuccessBody() {
      // Simulates a 200 OK with HTML/garbage body. The raw SyntaxError must be
      // suppressed in favor of the localized upload-failed key.
      global.fetch = vi.fn(function (url: string) {
        if (url.endsWith('/api/venture')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ventureId: 'v-123' }) } as Response);
        }
        if (url.startsWith('data:')) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' })) } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
        } as Response);
      });

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertError() {
        expect(screen.getByText('builder_chatfiles_error_upload_failed')).toBeInTheDocument();
      });
      expect(screen.queryByText(/Unexpected token/i)).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('selected-asset')).toHaveLength(0);
    });

    it('should attach the uploaded file as a selected asset with a server URL', async function attachAsset() {
      global.fetch = makeFetch();

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertAsset() {
        const assets = screen.getAllByTestId('selected-asset');
        expect(assets).toHaveLength(1);
        // imageUrl must be the server-side signed URL, never a data: URL
        expect(assets[0].dataset.url).toBe('http://localhost:4000/files/signed/abc-0.jpg');
        expect(assets[0].dataset.url).not.toMatch(/^data:/);
      });
    });

    it('should show the timeout error message when the upload is aborted', async function uploadTimeout() {
      global.fetch = vi.fn(function (url: string) {
        if (url.endsWith('/api/venture')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ventureId: 'v-123' }) } as Response);
        }
        // Simulate abort for both the blob fetch and the upload fetch
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      });

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertTimeoutMessage() {
        // IntlProvider renders missing keys as the key itself
        expect(screen.getByText('builder_chatfiles_error_timeout_duration')).toBeInTheDocument();
      });
    });

    it('should bail out before uploading when agentUrl is missing', async function noAgentUrl() {
      // Early guard prevents an orphaned multipart upload — site is not yet hydrated
      // so we cannot resolve the resulting signed URL into an asset reference anyway.
      mockSiteData.agentUrl = undefined;
      global.fetch = makeFetch();

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);
      await user.click(screen.getByTestId('simulate-screenshot'));

      await waitFor(function assertError() {
        expect(screen.getByText('builder_chatfiles_error_upload_failed')).toBeInTheDocument();
      });
      expect(screen.queryAllByTestId('selected-asset')).toHaveLength(0);
      // No multipart upload should have been attempted
      const uploadCall = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url) === UPLOAD_URL);
      expect(uploadCall).toBeUndefined();
    });

    it('should cap based on the CURRENT selectedAssets, not the closure snapshot', async function capUsesCurrentState() {
      // Two sequential captures with distinct file sets:
      //   batch 1 fills MAX_TOTAL_ASSETS - 2 slots,
      //   batch 2 returns 5 fresh files but only 2 must fit.
      // If the cap were computed from the useCallback closure (snapshot at memoization
      // time), the second batch would see selectedAssets.length === 0 and add all 5,
      // exceeding the cap. The ref-based read exercises the post-await fresh state.
      let callIdx = 0
      global.fetch = vi.fn(function (url: string) {
        if (url.endsWith('/api/venture')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ventureId: 'v-123' }) } as Response)
        }
        if (url.startsWith('data:')) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' })) } as Response)
        }
        const batch = callIdx++
        const count = batch === 0 ? MAX_TOTAL_ASSETS - 2 : 5
        const prefix = batch === 0 ? 'first' : 'second'
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            uploadId: `upload-${batch}`,
            files: Array.from({ length: count }, (_, i) => ({
              id: `${prefix}-${i}`,
              originalName: `s-${prefix}-${i}.jpg`,
              filename: `s-${prefix}-${i}.jpg`,
              size: 1024,
              mimeType: 'image/jpeg',
              uploadedAt: '2026-01-01',
              signedUrl: `/files/signed/${prefix}-${i}.jpg`,
            })),
            failedFiles: [],
          }),
        } as Response)
      })

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />)

      await user.click(screen.getByTestId('simulate-screenshot'))
      await waitFor(function assertFirstBatch() {
        expect(screen.getAllByTestId('selected-asset')).toHaveLength(MAX_TOTAL_ASSETS - 2)
      })

      await user.click(screen.getByTestId('simulate-screenshot'))
      await waitFor(function assertCapped() {
        expect(screen.getAllByTestId('selected-asset')).toHaveLength(MAX_TOTAL_ASSETS)
      })
      expect(screen.getByTestId('chat-attachment-limit-error')).toHaveTextContent(
        'builder_chatfiles_error_max_attachments'
      )
    })
  });

  describe('queue-while-busy cap rejection', () => {
    it('does not clear input or call sendMessage when enqueueMessage rejects at cap', async () => {
      mockSwitchboardValues['appbuilder-queue'] = true;
      mockStreamingStore.isActivelyStreaming = true;
      mockStreamingStore.inputValue = 'hello';

      const enqueueMessage = useStreamingConversationStore.getState().enqueueMessage;
      vi.mocked(enqueueMessage).mockReturnValueOnce(false);

      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(enqueueMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockStreamingStore.setInputValue).not.toHaveBeenCalled();
    });

    it('clears input when enqueueMessage accepts the message', async () => {
      mockSwitchboardValues['appbuilder-queue'] = true;
      mockStreamingStore.isActivelyStreaming = true;
      mockStreamingStore.inputValue = 'hello';

      const enqueueMessage = useStreamingConversationStore.getState().enqueueMessage;

      const { user } = renderWithProviders(
        <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />
      );

      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(enqueueMessage).toHaveBeenCalledTimes(1);
      expect(mockStreamingStore.setInputValue).toHaveBeenCalledWith('');
    });
  });

  describe('uploadError context reset', function uploadErrorContextReset() {
    it('should clear uploadError when switching apps', async function clearOnAppSwitch() {
      const pane = <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />;
      const { user, rerender } = renderWithProviders(pane);

      await user.click(screen.getByTestId('simulate-attachment-error'));
      expect(screen.getByTestId('chat-attachment-limit-error')).toHaveTextContent(
        'builder_chatfiles_error_max_attachments'
      );

      mockAppIdFromParams.value = 'other-app-456';
      rerender(pane);

      await waitFor(function assertCleared() {
        expect(screen.queryByTestId('chat-attachment-limit-error')).not.toBeInTheDocument();
      });
    });

    it('should clear uploadError when entering image replacement mode', async function clearOnImageReplacement() {
      const pane = <ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />;
      const { user, rerender } = renderWithProviders(pane);

      await user.click(screen.getByTestId('simulate-attachment-error'));
      expect(screen.getByTestId('chat-attachment-limit-error')).toHaveTextContent(
        'builder_chatfiles_error_max_attachments'
      );

      mockStreamingStore.aiEditContext = { isImageReplacement: true };
      rerender(pane);

      await waitFor(function assertCleared() {
        expect(screen.queryByTestId('chat-attachment-limit-error')).not.toBeInTheDocument();
      });
    });

    it('should clear uploadError when the last attachment is removed', async function clearOnRemoveAll() {
      vi.mocked(getFileUploadAgent).mockResolvedValue({ token: 'test-token', uploadUrl: 'http://localhost:4000/files/upload' });
      global.fetch = vi.fn(function (url: string) {
        if (url.endsWith('/api/venture')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ventureId: 'v-123' }) } as Response);
        }
        if (url.startsWith('data:')) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' })) } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            uploadId: 'upload-1',
            files: [{
              id: 'f0',
              originalName: 'screenshot-0.jpg',
              filename: 'screenshot-0.jpg',
              size: 1024,
              mimeType: 'image/jpeg',
              uploadedAt: '2026-01-01',
              signedUrl: '/files/signed/abc-0.jpg',
            }],
            failedFiles: [],
          }),
        } as Response);
      });

      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      await user.click(screen.getByTestId('simulate-screenshot'));
      await waitFor(function assertAsset() {
        expect(screen.getByTestId('selected-asset')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('simulate-attachment-error'));
      expect(screen.getByTestId('chat-attachment-limit-error')).toBeInTheDocument();

      await user.click(screen.getByTestId('clear-asset-0'));

      await waitFor(function assertCleared() {
        expect(screen.queryByTestId('chat-attachment-limit-error')).not.toBeInTheDocument();
      });
    });

    it('should clear a stale uploadError after successfully staging a valid file', async function clearOnSuccessfulStage() {
      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      await user.click(screen.getByTestId('simulate-attachment-error'));
      expect(screen.getByTestId('chat-attachment-limit-error')).toHaveTextContent(
        'builder_chatfiles_error_max_attachments'
      );

      await user.click(screen.getByTestId('simulate-stage-file'));

      await waitFor(function assertCleared() {
        expect(screen.queryByTestId('chat-attachment-limit-error')).not.toBeInTheDocument();
      });
      expect(screen.getByTestId('staged-file')).toHaveTextContent('small.txt');
    });

    it('should replace a stale uploadError with a new validation error', async function replaceWithValidationError() {
      const { user } = renderWithProviders(<ChatPane sendMessage={mockSendMessage} stopGeneration={mockStopGeneration} />);

      await user.click(screen.getByTestId('simulate-attachment-error'));
      expect(screen.getByTestId('chat-attachment-limit-error')).toHaveTextContent(
        'builder_chatfiles_error_max_attachments'
      );

      await user.click(screen.getByTestId('simulate-stage-oversized-file'));

      await waitFor(function assertReplaced() {
        expect(screen.getByTestId('chat-attachment-limit-error')).toHaveTextContent(
          'builder_chatfiles_error_file_too_large'
        );
      });
      expect(screen.queryByTestId('staged-file')).not.toBeInTheDocument();
    });
  });

});

