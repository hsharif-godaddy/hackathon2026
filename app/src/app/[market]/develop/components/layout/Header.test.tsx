/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent } from '@/utils/instrumentation';
import DevelopHeader from './Header';
import { ViewMode } from '../types';

const mockDevelopStore = {
  chatPaneWidth: 400,
  isMobile: false,
  viewMode: ViewMode.PREVIEW,
  isRestarting: false,
  hasUnsavedChanges: false,
  isChatPaneCollapsed: false,
  isVersionHistoryOpen: false,
  handleViewModeChange: vi.fn(),
  toggleChatPaneCollapse: vi.fn(),
};

const mockAuthContext = {
  isAuthenticated: true,
  isLoading: false,
};

const mockServerState = {
  port: 3000,
  url: 'http://localhost:3000',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/develop/app-123',
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
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

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext,
}));

vi.mock('@/utils/instrumentation', () => mockInstrumentation());

vi.mock('@/components/layout/AppPublish', () => ({
  default: () => <div data-testid="app-publish">AppPublish</div>,
}));

vi.mock('@/app/[market]/develop/components/layout/ShareMenu', () => ({
  default: () => <div data-testid="share-menu">ShareMenu</div>,
}));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({ sendMessage: vi.fn() }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
  useStreamingState: () => 'idle',
}));

vi.mock('@/hooks/useDomainSearch', () => ({
  useDomainSearch: vi.fn(() => ({ data: null, isError: false })),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(() => false),
}));

vi.mock('@/utils/domain', () => ({
  isAiroSubdomain: () => false,
  resolveSiteFqdn: () => null,
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    activeChatTab: 'chat',
    setActiveChatTab: vi.fn(),
  }),
}));

describe('DevelopHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.chatPaneWidth = 400;
    mockDevelopStore.isMobile = false;
    mockDevelopStore.viewMode = ViewMode.PREVIEW;
    mockDevelopStore.isChatPaneCollapsed = false;
    mockDevelopStore.isVersionHistoryOpen = false;
    mockAuthContext.isAuthenticated = true;
    mockAuthContext.isLoading = false;
  });

  it('should render without crashing', () => {
    renderWithProviders(<DevelopHeader />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('should render Airo logo with link to home', () => {
    renderWithProviders(<DevelopHeader />);

    const links = screen.getAllByRole('link');
    const airoLink = links.find(link => link.getAttribute('href') === '/');
    expect(airoLink).toBeInTheDocument();
  });

  it('should render GoDaddy logo link', () => {
    renderWithProviders(<DevelopHeader />);

    const godaddyLink = screen.getByRole('link', { name: 'builder_common_back_godaddy' });
    expect(godaddyLink).toBeInTheDocument();
  });

  it('should render beta tag', () => {
    renderWithProviders(<DevelopHeader />);

    // The beta tag renders with translation key when no messages provided
    expect(screen.getByText('builder_beta')).toBeInTheDocument();
  });

  it('should render collapse button when chat pane is expanded', () => {
    mockDevelopStore.isChatPaneCollapsed = false;

    renderWithProviders(<DevelopHeader />);

    expect(screen.getByLabelText('builder_preview_button_collapse')).toBeInTheDocument();
  });

  it('should render expand button when chat pane is collapsed', () => {
    mockDevelopStore.isChatPaneCollapsed = true;

    renderWithProviders(<DevelopHeader />);

    expect(screen.getByLabelText('builder_preview_button_expand')).toBeInTheDocument();
  });

  it('should render ButtonGroup with preview, edit, and code buttons', () => {
    renderWithProviders(<DevelopHeader />);

    expect(screen.getByLabelText('builder_preview_button_preview')).toBeInTheDocument();
    expect(screen.getByLabelText('builder_preview_button_edit')).toBeInTheDocument();
    expect(screen.getByLabelText('builder_preview_button_code')).toBeInTheDocument();
  });

  it('should render device selector on desktop', () => {
    mockDevelopStore.isMobile = false;

    renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'builder_preview_button_device' })).toBeInTheDocument();
  });

  it('should not render device selector on mobile', () => {
    mockDevelopStore.isMobile = true;

    renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'builder_preview_button_device' })).not.toBeInTheDocument();
  });

  it('should disable code button when version history is open', () => {
    mockDevelopStore.isVersionHistoryOpen = true;

    renderWithProviders(<DevelopHeader />);

    const codeButton = screen.getByLabelText('builder_preview_button_code');
    expect(codeButton).toBeDisabled();
  });

  it('should disable device selector when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'builder_preview_button_device' })).toBeDisabled();
  });


  it('should call toggleChatPaneCollapse when collapse button is clicked', async () => {
    const { user } = renderWithProviders(<DevelopHeader />);

    const collapseButton = screen.getByLabelText('builder_preview_button_collapse');
    await user.click(collapseButton);

    expect(mockDevelopStore.toggleChatPaneCollapse).toHaveBeenCalledOnce();
  });

  it('should call handleViewModeChange when preview button is clicked', async () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    const { user } = renderWithProviders(<DevelopHeader />);

    const previewButton = screen.getByLabelText('builder_preview_button_preview');
    await user.click(previewButton);

    expect(mockDevelopStore.handleViewModeChange).toHaveBeenCalledWith(ViewMode.PREVIEW, false);
  });

  it('should log click event when switching to edit view mode', async function logEditView() {
    const { user } = renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    await user.click(screen.getByLabelText('builder_preview_button_edit'));

    expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('develop.header.edit_mode', { appId: 'app-123' });
  });
});
