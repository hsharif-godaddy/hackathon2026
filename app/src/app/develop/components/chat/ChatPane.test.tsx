import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import ChatPane from './ChatPane';
import { ChatTab } from '@/app/develop/components/types';

// Mock child components
vi.mock('@/app/develop/components/chat/ChatInput', () => ({
  default: ({ onSendMessage, inputValue, onInputChange }: any) => (
    <div data-testid="chat-input">
      <input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Type a message"
      />
      <button onClick={onSendMessage}>Send</button>
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

vi.mock('@/app/develop/components/settings/SettingsPane', () => ({
  default: () => <div data-testid="settings-pane">Settings Pane</div>,
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

// Mock stores
const mockStreamingStore = {
  inputValue: '',
  isLoading: false,
  currentAppId: 'test-app-123',
  isActivelyStreaming: false,
  messages: [],
  activeStream: null,
  developmentPlan: null,
  aiEditContext: null,
  buildErrorContext: null,
  setInputValue: vi.fn(),
  setAiEditContext: vi.fn(),
  setBuildErrorContext: vi.fn(),
  setCurrentAppId: vi.fn(),
};

const mockDevelopPageStore = {
  expandedPlan: false,
  activeChatTab: ChatTab.CHAT,
  isMobile: false,
  toggleExpandedPlan: vi.fn(),
  setActiveChatTab: vi.fn(),
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
  useSetInputValue: () => mockStreamingStore.setInputValue,
  useSetAiEditContext: () => mockStreamingStore.setAiEditContext,
  useSetBuildErrorContext: () => mockStreamingStore.setBuildErrorContext,
  useSetCurrentAppId: () => mockStreamingStore.setCurrentAppId,
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopPageStore),
}));

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-123',
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  logAiroHQEvent: vi.fn(() => vi.fn()),
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopPageStore.activeChatTab = ChatTab.CHAT;
    mockDevelopPageStore.isMobile = false;
    mockStreamingStore.messages = [];
    mockStreamingStore.inputValue = '';
    mockStreamingStore.isLoading = false;

    // Mock fetch for ventureId
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ventureId: 'venture-123' }),
      } as Response)
    );
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('should render chat input', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('should render chat toolbar', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('chat-toolbar')).toBeInTheDocument();
  });

  it('should render message list', () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('message-list')).toBeInTheDocument();
  });

  it('should show version history when HISTORY tab is active', () => {
    mockDevelopPageStore.activeChatTab = ChatTab.HISTORY;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('version-history')).toBeInTheDocument();
  });

  it('should show preview pane on mobile when PREVIEW tab is active', () => {
    mockDevelopPageStore.activeChatTab = ChatTab.PREVIEW;
    mockDevelopPageStore.isMobile = true;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('preview-pane')).toBeInTheDocument();
  });

  it('should show settings pane when SETTINGS tab is active', () => {
    mockDevelopPageStore.activeChatTab = ChatTab.SETTINGS;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('settings-pane')).toBeInTheDocument();
  });

  it('should fall back to CHAT tab on desktop if PREVIEW is selected', () => {
    mockDevelopPageStore.activeChatTab = ChatTab.PREVIEW;
    mockDevelopPageStore.isMobile = false;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(mockDevelopPageStore.setActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT);
  });

  it('should fetch ventureId on mount', async () => {
    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/venture', {
        credentials: 'include',
      });
    });
  });

  it('should pass onPreviewRefresh to PreviewPane', () => {
    const onPreviewRefresh = vi.fn();
    mockDevelopPageStore.activeChatTab = ChatTab.PREVIEW;
    mockDevelopPageStore.isMobile = true;

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} onPreviewRefresh={onPreviewRefresh} />);

    expect(screen.getByTestId('preview-pane')).toBeInTheDocument();
  });

  it('should handle sendMessage prop', () => {
    const sendMessage = vi.fn();

    renderWithProviders(<ChatPane sendMessage={sendMessage} />);

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('should render plan tracker when development plan exists', () => {
    mockStreamingStore.developmentPlan = { phases: [] };

    renderWithProviders(<ChatPane sendMessage={mockSendMessage} />);

    expect(screen.getByTestId('plan-tracker')).toBeInTheDocument();
  });
});
