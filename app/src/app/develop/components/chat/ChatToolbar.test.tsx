/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/develop/components/types';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent } from '@/utils/instrumentation';
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
vi.mock('@/hooks/useSwitchboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSwitchboard')>();
  return {
    ...actual,
    useSwitchboard: (feature: string) => {
      if (feature === 'appbuilder-image-manager') return { data: true };
      if (feature === 'appbuilder-settings') return { data: true };
      if (feature === 'appbuilder-analytics') return { data: false };
      return { data: false };
    },
  };
});
vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({ isLoading: false }),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
  logClickEvent: vi.fn(() => vi.fn()),
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
  const defaultProps = {};

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
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(
      screen.getByRole('radio', { name: 'builder_chat_toolbar_button_chat' }),
    ).toBeInTheDocument();
  });

  it('should render chat button', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(
      screen.getByRole('radio', { name: 'builder_chat_toolbar_button_chat' }),
    ).toBeInTheDocument();
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

    const { container } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    const settingsButton = screen.getByRole('radio', { name: 'Settings' });
    expect(settingsButton).toBeInTheDocument();
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

  it('should have history button enabled', () => {
    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const historyButton = screen.getByLabelText('builder_chat_toolbar_button_history');
    expect(historyButton).not.toBeDisabled();
  });

  it('should have correct button count on desktop', () => {
    mockDevelopStore.isMobile = false;

    const { container } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    const buttons = container.querySelectorAll('button');
    // Chat, History, Settings = 3 buttons on desktop
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('should ignore history navigation while selecting commit', async () => {
    mockGitStore.isSelectingCommit = true;

    const { user } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    const historyButton = screen.getByLabelText('builder_chat_toolbar_button_history');
    expect(historyButton).not.toBeDisabled();
    await user.click(historyButton);
    expect(mockChatTabs.setActiveChatTab).not.toHaveBeenCalled();
  });

  it('should disable history button when publishing', () => {
    mockDevelopStore.publishStates['app-123'].isPublishing = true;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    const historyButton = screen.getByLabelText('builder_chat_toolbar_button_history');
    expect(historyButton).toBeDisabled();
  });

  it('should render settings menu on mobile when settings enabled', () => {
    mockDevelopStore.isMobile = true;

    const { container } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    const settingsButton = screen.getByRole('radio', { name: 'Settings' });
    expect(settingsButton).toBeInTheDocument();
  });

  it('should not render settings button on mobile preview mode', () => {
    mockDevelopStore.isMobile = true;
    mockDevelopStore.mobileMode = MobileMode.PREVIEW;

    renderWithProviders(<ChatToolbar {...defaultProps} />);

    expect(screen.queryByLabelText('builder_settings_title')).not.toBeInTheDocument();
  });

  it('should log toolbar tab clicks via logClickEvent', async () => {
    const { user } = renderWithProviders(<ChatToolbar {...defaultProps} />);

    await user.click(screen.getByLabelText('builder_chat_toolbar_button_chat'));
    expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('develop.chat_toolbar.chat', { appId: 'app-123' });

    vi.mocked(logClickEvent).mockClear();

    await user.click(screen.getByLabelText('builder_chat_toolbar_button_history'));
    expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('develop.chat_toolbar.history', { appId: 'app-123' });
  });

});
