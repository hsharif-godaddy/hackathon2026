import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { useChatTabs } from '@/hooks/useChatTabs';
import { renderWithProviders } from '@/tests/test-utils';
import PreviewHeader from './PreviewHeader';
import { ChatTab, PreviewViewMode, SettingsSection, ViewMode } from '../types';

const mockDevelopStore = {
  viewMode: ViewMode.PREVIEW,
  isRestarting: false,
  previewViewMode: PreviewViewMode.DESKTOP,
  selectedDeviceId: 'full',
  hasUnsavedChanges: false,
  isSelectMode: false,
  isChatPaneCollapsed: false,
  isVersionHistoryOpen: false,
  site: { name: 'Test App', domains: [{ fqdn: 'testapp.com', domainType: 'custom' }] },
  app: { name: 'Test App' },
  setActiveChatTab: vi.fn(),
  handleViewModeChange: vi.fn(),
  setPreviewViewMode: vi.fn(),
  setSelectedDeviceId: vi.fn(),
  toggleSelectMode: vi.fn(),
  toggleChatPaneCollapse: vi.fn(),
  openFeedbackModal: vi.fn(),
};
const mockServerState = {
  port: 3000,
  url: 'http://localhost:3000',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/develop/app-123',
}));
vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => {
    const state = {
      getServerState: () => mockServerState,
    };
    return selector(state);
  },
}));
vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: vi.fn(() => ({
    activeChatTab: ChatTab.CHAT,
    setActiveChatTab: vi.fn(),
    activeSettingsSection: SettingsSection.DOMAIN,
    setActiveSettingsSection: vi.fn(),
  })),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({ data: true }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({ sendMessage: vi.fn() }),
}));
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}));
vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: () => ({ data: null, isError: false }),
}));
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));
vi.mock('@/utils/site', () => ({
  hasBeenPublished: () => false,
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}));

describe('PreviewHeader', () => {
  const defaultProps = {
    onPreviewRefresh: vi.fn(),
    isMobile: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.viewMode = ViewMode.PREVIEW;
    mockDevelopStore.previewViewMode = PreviewViewMode.DESKTOP;
    mockDevelopStore.isChatPaneCollapsed = false;
    mockDevelopStore.isSelectMode = false;
  });

  it('should render without crashing', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_preview')).toBeInTheDocument();
  });

  it('should render preview button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_preview')).toBeInTheDocument();
  });

  it('should render code editor button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_code')).toBeInTheDocument();
  });

  it('should render refresh button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_preview_button_refresh')).toBeInTheDocument();
  });

  it('should render collapse/expand chat pane button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('builder_preview_button_collapse')).toBeInTheDocument();
  });

  it('should not render collapse/expand button on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('builder_preview_button_collapse')).not.toBeInTheDocument();
  });

  it('should render select mode button on desktop', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    expect(screen.getByLabelText('builder_preview_button_select')).toBeInTheDocument();
  });

  it('should not render builder_preview_button_select button on mobile', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    expect(screen.queryByLabelText('Select Mode')).not.toBeInTheDocument();
  });

  it('should render device selector on desktop', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} isMobile={false} />);

    // DeviceSelector shows "Full size" by default (uses defaultMessage fallback)
    const button = container.querySelector('[data-eid="develop.preview.device_selector"]');
    expect(button).toBeInTheDocument();
  });

  it('should not render device selector on mobile', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} isMobile={true} />);

    const button = container.querySelector('[data-eid="develop.preview.device_selector"]');
    expect(button).not.toBeInTheDocument();
  });

  it('should render open in new tab button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByLabelText('builder_common_open_new_tab')).toBeInTheDocument();
  });

  it('should display fqdn in domain button', () => {
    renderWithProviders(<PreviewHeader {...defaultProps} />);

    expect(screen.getByText('https://testapp.com')).toBeInTheDocument();
  });

  it('should disable refresh button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const refreshButton = screen.getByLabelText('builder_preview_button_refresh');
    expect(refreshButton).toBeDisabled();
  });

  it('should disable select mode button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const selectButton = screen.getByLabelText('builder_preview_button_select');
    expect(selectButton).toBeDisabled();
  });

  it('should disable device selector when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} />);

    // DeviceSelector button should be disabled
    const deviceSelectorButton = container.querySelector('[data-eid="develop.preview.device_selector"]');
    expect(deviceSelectorButton).toBeInTheDocument();
    expect(deviceSelectorButton).toBeDisabled();
  });

  it('should disable open in new tab when app is restarting', () => {
    mockDevelopStore.isRestarting = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const newTabButton = screen.getByLabelText('builder_common_open_new_tab');
    expect(newTabButton).toBeDisabled();
  });

  it('should have correct button count on desktop', () => {
    const { container } = renderWithProviders(<PreviewHeader {...defaultProps} />);

    const buttons = container.querySelectorAll('button');
    // Collapse, Preview, Code, Select, Refresh, DeviceSelector, New Tab = 7 buttons
    expect(buttons.length).toBe(7);
  });

  it('should disable code button when version history is open', () => {
    mockDevelopStore.isVersionHistoryOpen = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const codeButton = screen.getByLabelText('builder_preview_button_code');
    expect(codeButton).toBeDisabled();
  });

  it('should disable select mode button when version history is open', () => {
    mockDevelopStore.isVersionHistoryOpen = true;

    renderWithProviders(<PreviewHeader {...defaultProps} />);

    const selectButton = screen.getByLabelText('builder_preview_button_select');
    expect(selectButton).toBeDisabled();
  });

  it('should show custom domain button for airoapp.ai subdomain', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }]
    };
    renderWithProviders(<PreviewHeader {...defaultProps} />);
    expect(screen.getByText('builder_custom_domain_button_add')).toBeInTheDocument();
  });

  it('should hide custom domain button when custom domain is attached', () => {
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'custom.example.com', domainType: 'custom' }]
    };
    renderWithProviders(<PreviewHeader {...defaultProps} />);
    expect(screen.queryByText('builder_custom_domain_button_add')).not.toBeInTheDocument();
  });

  it('should call setActiveSettingsSection when custom domain button is clicked', async () => {
    const mockSetActiveSettingsSection = vi.fn();
    vi.mocked(useChatTabs).mockReturnValue({
      activeChatTab: ChatTab.CHAT,
      setActiveChatTab: vi.fn(),
      activeSettingsSection: SettingsSection.DOMAIN,
      setActiveSettingsSection: mockSetActiveSettingsSection,
    });
    mockDevelopStore.site = {
      name: 'Test App',
      domains: [{ fqdn: 'test.airoapp.ai', domainType: 'prefix' }]
    };
    const { user } = renderWithProviders(<PreviewHeader {...defaultProps} />);
    await user.click(screen.getByText('builder_custom_domain_button_add'));
    expect(mockSetActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DOMAIN);
  });
});
