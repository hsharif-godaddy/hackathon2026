/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import AppPublish from '@/components/layout/AppPublish';
import { createMockSite, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

const mockRouterInstance = mockRouter();
let mockPathname = '/develop/app-123';

const mockDevelopStore = {
  currentAppId: 'app-123',
  publishStates: {} as Record<string, { isPublishing?: boolean; publishError?: boolean }>,
  setIsPublishing: vi.fn(),
  setPublishError: vi.fn(),
  clearPublishStatus: vi.fn(),
  setDeploymentsRefetch: vi.fn(),
};

const mockSiteStore = {
  getSite: vi.fn(),
};

const mockStreaming = {
  isLoading: false,
  streamingState: 'idle' as string,
};

const mockRefetchGitHistory = vi.fn();
const mockRefetchDeployments = vi.fn();

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
    data: [],
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
  useDevelopPageStore: (selector: (state: typeof mockDevelopStore) => unknown) =>
    selector(mockDevelopStore),
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
    mockPathname = '/develop/app-123';
    mockDevelopStore.currentAppId = 'app-123';
    mockDevelopStore.publishStates = {};
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
});
