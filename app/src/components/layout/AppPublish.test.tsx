/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import Growl from '@ux/growl';

import AppPublish from '@/components/layout/AppPublish';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { createMockSite, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

const mockRouterInstance = mockRouter();
let mockPathname = '/develop/app-123';

type MockPublishSlice = {
  isPublishing?: boolean;
  publishError?: boolean;
  showFirstPublishCongrats?: boolean;
  firstPublishDeployPending?: boolean;
};

const mockDevelopStore = {
  currentAppId: 'app-123',
  publishStates: {} as Record<string, MockPublishSlice>,
  getPublishState(appId: string) {
    const slice = mockDevelopStore.publishStates[appId];
    return {
      isPublishing: slice?.isPublishing ?? false,
      publishError: slice?.publishError ?? false,
      showFirstPublishCongrats: slice?.showFirstPublishCongrats ?? false,
      firstPublishDeployPending: slice?.firstPublishDeployPending ?? false,
    };
  },
  setIsPublishing: vi.fn(),
  setPublishError: vi.fn(),
  clearPublishStatus: vi.fn(),
  setDeploymentsRefetch: vi.fn(),
  setFirstPublishDeployPending: vi.fn(),
  openFeedbackModal: vi.fn(),
  setShowFeedbackBanner: vi.fn(),
};

let mockDeploymentsData: Array<{ id: string; status: string }> = [];

const mockSiteStore = {
  getSite: vi.fn(),
};

const mockStreaming = {
  isLoading: false,
  streamingState: 'idle' as string,
};

const mockRefetchGitHistory = vi.fn();
const mockRefetchDeployments = vi.fn();
const mockLogClickEvent = vi.fn(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouterInstance,
  usePathname: () => mockPathname,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveChatTab: vi.fn(),
    setActiveSettingsSection: vi.fn(),
  }),
}));

vi.mock('@/hooks/useDeploymentsQuery', () => ({
  useDeploymentsQuery: () => ({
    data: mockDeploymentsData,
    isLoading: false,
    refetch: mockRefetchDeployments,
  }),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({
    isLoading: false,
    refetch: mockRefetchGitHistory,
  }),
}));

vi.mock('@/hooks/useIsHistoryDisabled', () => ({
  useIsHistoryDisabled: () => false,
}));

vi.mock('@/hooks/usePaywallModal', () => ({
  usePaywallModal: vi.fn(() => ({
    checkAndShowPaywall: vi.fn((callback: () => void | Promise<void>) => {
      void callback();
    }),
    PaywallModal: () => null,
    isPolling: false,
    isPaywallLoading: false,
    isPublishLimitLoading: false,
  })),
}));

vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/hooks/useSecretsDiff', () => ({
  useSecretsDiff: () => ({ refetch: vi.fn() }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ data: null }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((feature: string) => {
    if (feature === 'appbuilder-publish-button') {
      return { data: true, isLoading: false };
    }
    if (feature === 'appbuilder-airoplus-paywall') {
      return { data: true, isLoading: false };
    }
    if (feature === 'appbuilder-settings-secrets') {
      return { data: false, isLoading: false };
    }
    return { data: false, isLoading: false };
  }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: typeof mockDevelopStore) => unknown) => selector(mockDevelopStore),
    { getState: () => mockDevelopStore },
  ),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: (selector: (state: typeof mockSiteStore) => unknown) =>
    selector(mockSiteStore),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsLoading: () => mockStreaming.isLoading,
  useStreamingState: () => mockStreaming.streamingState,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => id),
  logAiroHQEvent: vi.fn(() => vi.fn()),
  logClickEvent: (...args: unknown[]) => {
    mockLogClickEvent(...args);
    return vi.fn();
  },
}));

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
    removeGrowlMessage: vi.fn(),
  },
}));

describe('AppPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('airo-feedback-shown:airo#app-builder');
    mockPathname = '/develop/app-123';
    mockDevelopStore.currentAppId = 'app-123';
    mockDevelopStore.publishStates = {};
    mockDeploymentsData = [];
    mockStreaming.isLoading = false;
    mockStreaming.streamingState = 'idle';
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
      })
    );
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  it('should render nothing when pathname is not the develop page', function notDevelopPage() {
    mockPathname = '/apps';

    const { container } = renderWithProviders(<AppPublish />);

    expect(container.firstChild).toBeNull();
  });

  it('should render publish control on develop page', async function developPublishControl() {
    renderWithProviders(<AppPublish />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'builder_publish_button' })).toBeInTheDocument();
    });
    expect(document.getElementById('tour-publish-button')).toBeInTheDocument();
  });

  it('should disable publish when site has no agent_url', async function noAgentUrl() {
    mockSiteStore.getSite.mockReturnValue(createMockSite({ id: 'app-123', agent_url: undefined }));

    renderWithProviders(<AppPublish />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'builder_publish_button' })).toBeDisabled();
    });
  });

  it('should open popover and show title after paywall check', async function openPopover() {
    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.header.app_first_publish', { appId: 'app-123' });

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
  });

  it('should show conversation warning in popover when streaming is active', async function conversationWarning() {
    mockStreaming.streamingState = 'streaming';

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_conversation_warning')).toBeInTheDocument();
    });
  });

  it('should show unpublished domain helper for first-time publish', async function firstTimeCopy() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: [],
      })
    );

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_unpublished_domain_info')).toBeInTheDocument();
    });
  });

  it('should close publish popover when showFirstPublishCongrats becomes true', async function closePopoverOnCongrats() {
    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDevelopStore.publishStates['app-123'] = { showFirstPublishCongrats: true };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });
  });

  it('should not show success growl when showFirstPublishCongrats is true', async function noGrowlWhenCongrats() {
    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: true,
      publishError: false,
      showFirstPublishCongrats: true,
    };

    const { rerender } = renderWithProviders(<AppPublish />);

    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: false,
      showFirstPublishCongrats: true,
    };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
    });
  });

  it('should show feedback link during publishing', async function feedbackLinkDuringPublish() {
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_settings_nav_feedback')).toBeInTheDocument();
    });
  });

  it('should not show feedback link when not publishing', async function noFeedbackLinkWhenIdle() {
    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    expect(screen.queryByText('builder_settings_nav_feedback')).not.toBeInTheDocument();
  });

  it('should open feedback modal when feedback link is clicked', async function feedbackLinkClick() {
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    const feedbackLink = await screen.findByText('builder_settings_nav_feedback');
    await user.click(feedbackLink);

    expect(mockDevelopStore.openFeedbackModal).toHaveBeenCalledWith('airo#app-builder', 'Publish Popover');
  });

  it('should trigger feedback banner on successful publish when feedback not given', async function postPublishFeedbackBanner() {
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(mockDevelopStore.setShowFeedbackBanner).toHaveBeenCalledWith(true);
    });
  });

  it('should not trigger feedback banner on successful publish when feedback already given', async function noPostPublishBannerWhenFeedbackGiven() {
    localStorage.setItem('airo-feedback-shown:airo#app-builder', 'true');
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(mockDevelopStore.setShowFeedbackBanner).not.toHaveBeenCalled();
    });
  });

  it('should add success growl with feedback CTA when publish completes while popover closed', async function successGrowlIncludesFeedback() {
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender, unmount } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'app-publish-success',
          title: 'builder_publish_success_title',
          emphasis: 'success',
        })
      );
    });

    const successPayload = vi.mocked(Growl.addGrowlMessage).mock.calls
      .map((c) => c[0])
      .find(
        (a): a is { id: string; children: ReactNode } =>
          Boolean(a && typeof a === 'object' && 'id' in a && (a as { id: string }).id === 'app-publish-success')
      );
    expect(successPayload?.children).toBeDefined();

    unmount();
    const { user } = renderWithProviders(<div>{successPayload!.children}</div>);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_message_live')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'builder_settings_nav_feedback' }));

    expect(Growl.removeGrowlMessage).toHaveBeenCalledWith('app-publish-success');
    expect(mockDevelopStore.openFeedbackModal).toHaveBeenCalledWith('airo#app-builder', 'Publish Growl');
  });

  it('should open published URL from success growl visit when fqdn resolves', async function successGrowlVisitWhenFqdn() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        published_url: 'https://published.example.com',
      })
    );
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    try {
      mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
      mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

      const { rerender, unmount } = renderWithProviders(<AppPublish />);

      mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
      mockDevelopStore.publishStates['app-123'] = { isPublishing: false };
      rerender(<AppPublish />);

      await waitFor(() => {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'app-publish-success',
            title: 'builder_publish_success_title',
            emphasis: 'success',
          })
        );
      });

      const successPayload = vi.mocked(Growl.addGrowlMessage).mock.calls
        .map((c) => c[0])
        .find(
          (a): a is { id: string; children: ReactNode } =>
            Boolean(a && typeof a === 'object' && 'id' in a && (a as { id: string }).id === 'app-publish-success')
        );
      expect(successPayload).toBeDefined();

      unmount();
      const { user } = renderWithProviders(<div>{successPayload!.children}</div>);

      const visitButton = await screen.findByRole('button', { name: 'builder_publish_button_visit' });
      await user.click(visitButton);

      expect(windowOpen).toHaveBeenCalledWith('https://published.example.com', '_blank', 'noopener,noreferrer');
    } finally {
      windowOpen.mockRestore();
    }
  });
});
