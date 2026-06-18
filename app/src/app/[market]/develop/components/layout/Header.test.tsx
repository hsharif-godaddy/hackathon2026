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
import { MobileMode, ViewMode } from '../types';

const { mockUndoAction, mockRedoAction, mockAddGrowlMessage } = vi.hoisted(() => ({
  mockUndoAction: {
    isLocked: false,
    isPending: false,
    error: null as string | null,
    triggerUndo: vi.fn(),
    clearError: vi.fn(),
  },
  mockRedoAction: {
    isLocked: false,
    isPending: false,
    error: null as string | null,
    triggerRedo: vi.fn(),
    clearError: vi.fn(),
  },
  mockAddGrowlMessage: vi.fn(),
}));

vi.mock('@/hooks/useHeadUndoAction', () => ({
  useHeadUndoAction: () => mockUndoAction,
}));

vi.mock('@/hooks/useRedoAction', () => ({
  useRedoAction: () => mockRedoAction,
}));

vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: mockAddGrowlMessage },
}));

const mockDevelopStore = {
  chatPaneWidth: 400,
  isMobile: false,
  viewMode: ViewMode.PREVIEW,
  mobileMode: MobileMode.TOOLS,
  isRestarting: false,
  hasUnsavedChanges: false,
  isChatPaneCollapsed: false,
  isVersionHistoryOpen: false,
  handleViewModeChange: vi.fn(),
  handleMobileModeChange: vi.fn(),
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

const mockSwitchboardResults: Record<string, boolean> = {};
const mockSwitchboardValues: Record<string, string> = {};

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => mockSwitchboardResults[feature] ?? false,
  getSwitchboardFlag: (feature: string) => mockSwitchboardResults[feature] ?? false,
  getSwitchboardValue: (feature: string) => mockSwitchboardValues[feature],
}));

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

vi.mock('@/app/[market]/develop/components/layout/ShareLink', () => ({
  default: () => <div data-testid="share-link-button">ShareLink</div>,
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
  useDomainSearch: vi.fn(function () { return { data: null, isError: false }; }),
}));

vi.mock('@/utils/site', () => ({
  hasBeenPublished: vi.fn(function () { return false; }),
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

const mockCheckAndShowPaywall = vi.fn(async (action: () => Promise<void>) => {
  await action();
});

vi.mock('@/hooks/usePaywallModal', () => ({
  usePaywallModal: () => ({
    checkAndShowPaywall: mockCheckAndShowPaywall,
    paywallModal: null,
    isPaywallLoading: false,
    isPublishLimitLoading: false,
  }),
}));

describe('DevelopHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key];
    }
    for (const key of Object.keys(mockSwitchboardValues)) {
      delete mockSwitchboardValues[key];
    }
    mockDevelopStore.chatPaneWidth = 400;
    mockDevelopStore.isMobile = false;
    mockDevelopStore.viewMode = ViewMode.PREVIEW;
    mockDevelopStore.mobileMode = MobileMode.TOOLS;
    mockDevelopStore.isChatPaneCollapsed = false;
    mockDevelopStore.isVersionHistoryOpen = false;
    mockAuthContext.isAuthenticated = true;
    mockAuthContext.isLoading = false;
    mockUndoAction.isLocked = false;
    mockUndoAction.isPending = false;
    mockUndoAction.error = null;
    mockUndoAction.triggerUndo.mockReset();
    mockUndoAction.clearError.mockReset();
    mockRedoAction.isLocked = false;
    mockRedoAction.isPending = false;
    mockRedoAction.error = null;
    mockRedoAction.triggerRedo.mockReset();
    mockRedoAction.clearError.mockReset();
    mockAddGrowlMessage.mockReset();
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

  it('should not render GoDaddy logo link', () => {
    renderWithProviders(<DevelopHeader />);

    expect(screen.queryByRole('link', { name: 'builder_common_back_godaddy' })).not.toBeInTheDocument();
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

  it('should disable edit button when version history is open', () => {
    mockDevelopStore.isVersionHistoryOpen = true;

    renderWithProviders(<DevelopHeader />);

    const editButton = screen.getByLabelText('builder_preview_button_edit');
    expect(editButton).toBeDisabled();
  });

  it('should not render device selector or refresh button when in code mode', () => {
    mockDevelopStore.viewMode = ViewMode.CODE;

    renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'builder_preview_button_device' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-refresh-button')).not.toBeInTheDocument();
  });

  it('should not render device selector or refresh button when in brand mode', () => {
    mockDevelopStore.viewMode = ViewMode.BRAND;

    renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'builder_preview_button_device' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-refresh-button')).not.toBeInTheDocument();
  });

  it('should render device selector and refresh button in edit mode', () => {
    mockDevelopStore.viewMode = ViewMode.EDIT;

    renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'builder_preview_button_device' })).toBeInTheDocument();
    expect(screen.getByTestId('header-refresh-button')).toBeInTheDocument();
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

  describe('Code button paywall', () => {
    it('should call checkAndShowPaywall when code button is clicked', async () => {
      const { user } = renderWithProviders(<DevelopHeader />);

      await user.click(screen.getByLabelText('builder_preview_button_code'));

      expect(mockCheckAndShowPaywall).toHaveBeenCalledTimes(1);
      expect(mockCheckAndShowPaywall).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should switch to code view when paywall allows through', async () => {
      mockCheckAndShowPaywall.mockImplementation(async (action: () => Promise<void>) => {
        await action();
      });

      const { user } = renderWithProviders(<DevelopHeader />);

      await user.click(screen.getByLabelText('builder_preview_button_code'));

      expect(mockDevelopStore.handleViewModeChange).toHaveBeenCalledWith(ViewMode.CODE, false);
    });

    it('should NOT switch to code view when paywall blocks', async () => {
      mockCheckAndShowPaywall.mockImplementation(async () => {
        // Paywall intercepts — does not call the action
      });

      const { user } = renderWithProviders(<DevelopHeader />);

      await user.click(screen.getByLabelText('builder_preview_button_code'));

      expect(mockDevelopStore.handleViewModeChange).not.toHaveBeenCalled();
    });

    it('should NOT call checkAndShowPaywall for preview button', async () => {
      mockDevelopStore.viewMode = ViewMode.CODE;

      const { user } = renderWithProviders(<DevelopHeader />);

      await user.click(screen.getByLabelText('builder_preview_button_preview'));

      expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();
      expect(mockDevelopStore.handleViewModeChange).toHaveBeenCalledWith(ViewMode.PREVIEW, false);
    });

    it('should NOT call checkAndShowPaywall for edit button', async () => {
      const { user } = renderWithProviders(<DevelopHeader />);

      await user.click(screen.getByLabelText('builder_preview_button_edit'));

      expect(mockCheckAndShowPaywall).not.toHaveBeenCalled();
      expect(mockDevelopStore.handleViewModeChange).toHaveBeenCalledWith(ViewMode.EDIT, false);
    });
  });

  describe('inline-edit Undo / Redo buttons', () => {
    it('does not render the buttons in PREVIEW mode', () => {
      mockDevelopStore.viewMode = ViewMode.PREVIEW;
      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(screen.queryByTestId('header-undo-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-redo-button')).not.toBeInTheDocument();
    });

    it('does not render the buttons in CODE mode', () => {
      mockDevelopStore.viewMode = ViewMode.CODE;
      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(screen.queryByTestId('header-undo-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-redo-button')).not.toBeInTheDocument();
    });

    it('renders both buttons in EDIT mode', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(screen.getByTestId('header-undo-button')).toBeInTheDocument();
      expect(screen.getByTestId('header-redo-button')).toBeInTheDocument();
    });

    it('disables Undo when the hook reports locked', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      mockUndoAction.isLocked = true;

      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(screen.getByTestId('header-undo-button')).toBeDisabled();
    });

    it('disables Undo while the mutation is pending', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      mockUndoAction.isPending = true;

      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(screen.getByTestId('header-undo-button')).toBeDisabled();
    });

    it('disables both buttons while version history is open', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      mockDevelopStore.isVersionHistoryOpen = true;

      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(screen.getByTestId('header-undo-button')).toBeDisabled();
      expect(screen.getByTestId('header-redo-button')).toBeDisabled();
    });

    it('disables Redo when the redo stack is empty (locked) and enables it when populated', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      mockRedoAction.isLocked = true;

      const { rerender } = renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);
      expect(screen.getByTestId('header-redo-button')).toBeDisabled();

      mockRedoAction.isLocked = false;
      rerender(<DevelopHeader onPreviewRefresh={vi.fn()} />);
      expect(screen.getByTestId('header-redo-button')).not.toBeDisabled();
    });

    it('triggers Undo when clicked', async () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;

      const { user } = renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);
      await user.click(screen.getByTestId('header-undo-button'));

      expect(mockUndoAction.triggerUndo).toHaveBeenCalledOnce();
      // The 'develop.header.undo' click EID is fired inside `triggerUndo`
      // itself (with cursor/target payload). The Header onClick must not
      // emit it again — see useHeadUndoAction.test.tsx for that assertion.
      expect(vi.mocked(logClickEvent)).not.toHaveBeenCalledWith('develop.header.undo', expect.anything());
    });

    it('triggers Redo when clicked', async () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;

      const { user } = renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);
      await user.click(screen.getByTestId('header-redo-button'));

      expect(mockRedoAction.triggerRedo).toHaveBeenCalledOnce();
      expect(vi.mocked(logClickEvent)).not.toHaveBeenCalledWith('develop.header.redo', expect.anything());
    });

    it('surfaces Undo errors via Growl and clears the error', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      mockUndoAction.error = 'Could not undo. Please try again or send a new message.';

      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(mockAddGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'header-undo-failed', emphasis: 'critical' }),
      );
      expect(mockUndoAction.clearError).toHaveBeenCalledOnce();
    });

    it('surfaces Redo errors via Growl and clears the error', () => {
      mockDevelopStore.viewMode = ViewMode.EDIT;
      mockRedoAction.error = 'Could not redo. Please try again or send a new message.';

      renderWithProviders(<DevelopHeader onPreviewRefresh={vi.fn()} />);

      expect(mockAddGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'header-redo-failed', emphasis: 'critical' }),
      );
      expect(mockRedoAction.clearError).toHaveBeenCalledOnce();
    });
  });
});
