/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import ChatToolbar from './ChatToolbar';

const mockRouter = { push: vi.fn() };
const mockParams = { id: 'app-123' };
const mockDevelopStore = {
  isMobile: false,
  mobileMode: MobileMode.TOOLS, // MobileMode.TOOLS
  viewMode: ViewMode.PREVIEW, // ViewMode.PREVIEW
  isSelectMode: false,
  isVersionHistoryOpen: false,
  isAssetManagerOpen: false,
  hasUnsavedChanges: false,
  site: null,
  app: null,
  deploymentInProgressId: null,
  setIsAssetManagerOpen: vi.fn(),
  toggleSelectMode: vi.fn(),
  handleViewModeChange: vi.fn(),
  handleMobileModeChange: vi.fn(),
  getPublishState: vi.fn(() => ({
    deploymentInProgressId: null,
    isPollingActive: false,
  })),
  publishStates: { 'app-123': { isPublishing: false } } as Record<string, { isPublishing: boolean }>,
};
const mockChatTabs = {
  activeChatTab: ChatTab.CHAT,
  setActiveChatTab: vi.fn(),
  activeSettingsSection: SettingsSection.DOMAIN,
  setActiveSettingsSection: vi.fn(),
};
const mockGitStore = {
  isSelectingCommit: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => mockParams,
  usePathname: () => '/develop/app-123',
}));
vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => mockChatTabs,
}));
vi.mock('@/stores/useGitStore', () => ({
  useGitStore: (selector: any) => selector(mockGitStore),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  SwitchboardAuthError: class SwitchboardAuthError extends Error {
    constructor(featureName: string) {
      super(`Authentication required to fetch feature flag: ${featureName}`);
      this.name = 'SwitchboardAuthError';
    }
  },
  useSwitchboard: (feature: string) => {
    if (feature === 'appbuilder-image-manager') return { data: true, error: null };
    if (feature === 'appbuilder-settings') return { data: true, error: null };
    return { data: false, error: null };
  },
}));
vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({ isFetching: false }),
}));

let mockHistoryDisabled = false;
vi.mock('@/hooks/useIsHistoryDisabled', () => ({
  useIsHistoryDisabled: () => mockHistoryDisabled,
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));
vi.mock('@/app/develop/components/chat/AssetManagerModal', () => ({
  default: () => <div data-testid="asset-manager-modal">AssetManagerModal</div>,
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: true,
    isAuthDisabled: false,
    isLoading: false,
  }),
}));

describe('ChatToolbar', () => {
  const defaultProps = {
    onAssetSelect: vi.fn(),
    ventureId: 'venture-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.isMobile = false;
    mockDevelopStore.mobileMode = MobileMode.TOOLS;
    mockDevelopStore.viewMode = ViewMode.PREVIEW;
    mockDevelopStore.isSelectMode = false;
    mockDevelopStore.isVersionHistoryOpen = false;
    mockDevelopStore.isAssetManagerOpen = false;
    mockDevelopStore.hasUnsavedChanges = false;
    mockDevelopStore.publishStates = { 'app-123': { isPublishing: false } };
    mockDevelopStore.viewMode = ViewMode.PREVIEW;
    mockDevelopStore.isSelectMode = false;
    mockChatTabs.activeChatTab = ChatTab.CHAT;
    mockChatTabs.activeSettingsSection = SettingsSection.DOMAIN;
    mockGitStore.isSelectingCommit = false;
    mockHistoryDisabled = false;
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByText('builder_chat_toolbar_button_chat')).toBeInTheDocument();
  });

  it('should render chat button', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByText('builder_chat_toolbar_button_chat')).toBeInTheDocument();
  });

  it('should render history button', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByLabelText('builder_chat_toolbar_button_history')).toBeInTheDocument();
  });

  it('should render media button', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByLabelText('builder_chat_toolbar_button_media')).toBeInTheDocument();
  });

  it('should render settings button on desktop', () => {
    mockDevelopStore.isMobile = false;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByLabelText('builder_settings_title')).toBeInTheDocument();
  });

  it('should render view button on mobile preview mode', () => {
    mockDevelopStore.isMobile = true;
    mockDevelopStore.mobileMode = MobileMode.PREVIEW;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByLabelText('builder_chat_toolbar_button_view')).toBeInTheDocument();
  });

  it('should not render preview button on desktop', () => {
    mockDevelopStore.isMobile = false;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.queryByText('builder_chat_toolbar_button_preview')).not.toBeInTheDocument();
  });

  it('should mark chat button as active when chat tab selected', () => {
    mockChatTabs.activeChatTab = ChatTab.CHAT;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const chatButton = screen.getByLabelText('builder_chat_toolbar_button_chat');
    expect(chatButton).toHaveAttribute('aria-checked', 'true');
  });

  it('should mark history button as active when history tab selected', () => {
    mockChatTabs.activeChatTab = ChatTab.HISTORY;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const historyButton = screen.getByLabelText('builder_chat_toolbar_button_history');
    expect(historyButton).toHaveAttribute('aria-checked', 'true');
  });

  it('should mark media button as active when media tab selected', () => {
    mockChatTabs.activeChatTab = ChatTab.MEDIAS;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const mediaButton = screen.getByLabelText('builder_chat_toolbar_button_media');
    expect(mediaButton).toHaveAttribute('aria-checked', 'true');
  });

  it('should disable history button when useIsHistoryDisabled returns true', () => {
    mockHistoryDisabled = true;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const historyButton = screen.getByLabelText('builder_chat_toolbar_button_history');
    expect(historyButton).toBeDisabled();
  });

  it('should have correct button count on desktop', () => {
    mockDevelopStore.isMobile = false;

    const { container } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    const buttons = container.querySelectorAll('button');
    // Chat, History, Settings = 3 buttons on desktop
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('should enable history button when useIsHistoryDisabled returns false', () => {
    mockHistoryDisabled = false;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const historyButton = screen.getByLabelText('builder_chat_toolbar_button_history');
    expect(historyButton).not.toBeDisabled();
  });

  it('should render settings menu on mobile when settings enabled', () => {
    mockDevelopStore.isMobile = true;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.getByLabelText('builder_settings_title')).toBeInTheDocument();
  });

  it('should not render settings button on mobile preview mode', () => {
    mockDevelopStore.isMobile = true;
    mockDevelopStore.mobileMode = MobileMode.PREVIEW;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.queryByLabelText('builder_settings_title')).not.toBeInTheDocument();
  });

  it('should have correct data-eid attributes', () => {
    const { container } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    const chatButton = container.querySelector('[data-eid="develop.chat_toolbar.chat"]');
    expect(chatButton).toBeInTheDocument();

    const historyButton = container.querySelector('[data-eid="develop.chat_toolbar.history"]');
    expect(historyButton).toBeInTheDocument();

    const mediaButton = container.querySelector('[data-eid="develop.chat_toolbar.media"]');
    expect(mediaButton).toBeInTheDocument();

    const settingsButton = container.querySelector('[data-eid="develop.chat_toolbar.settings"]');
    expect(settingsButton).toBeInTheDocument();
  });

});
