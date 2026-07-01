/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishDenialReason, PublishUpgradeRequiredError } from '@airo/shared/publish';
import { screen, waitFor } from '@testing-library/react';
import Growl from '@ux/growl';

vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return {
    ...actual,
    FormattedMessage: ({ id, values }: { id: string; values?: Record<string, unknown> }) => {
      const action = values?.action;
      return typeof action === 'function' ? <>{action([''])}</> : <>{id}</>;
    },
  };
});

// On mobile the publish popover renders via ResponsivePopover → BottomSheet,
// whose `@ux/disrupt` overlay does not render under the React 19 peers in
// jsdom. Mock it as a passthrough so the mobile-viewport tests below can
// exercise the popover content. (Matches the BottomSheet/ResponsiveMenu suites.)
vi.mock('@ux/disrupt', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => <svg data-testid={`icon-${icon}`} />,
}));

import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import AppPublish from '@/components/layout/AppPublish';
import { shipAnalyticsLog } from '@/lib/logging';
import { DeploymentStatus } from '@/lib/mgmt-airo/types';
import { openPostPublishFeatureSelectionInChat } from '@/lib/post-publish-feature-selection';
import { logger } from '@/lib/request-context';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { createMockSite, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';

const mockRouterInstance = mockRouter();
let mockPathname = '/develop/app-123';

type MockPublishSlice = {
  isPublishing?: boolean;
  publishError?: boolean;
  showFirstPublishCongrats?: boolean;
  firstPublishDeployPending?: boolean;
  publishPopoverRequestNonce?: number;
  buildErrorDetails?: { error: string; details: string; exitCode?: number } | null;
  showPostPublishFeatureSelection?: boolean;
  securityAnalysisResult?: 'safe' | 'issues' | null;
  seoRegressionAlert?: {
    scoreDelta: number;
    currentScore: number;
    regressions: Array<{ path: string; newIssues: string[] }>;
  } | null;
};

const mockDismissSeoRegressionAlert = vi.fn();
const mockLogImpressionEvent = vi.fn(() => vi.fn());

const mockDevelopStore = {
  currentAppId: 'app-123',
  isMobile: false,
  publishStates: {} as Record<string, MockPublishSlice>,
  dismissSeoRegressionAlert: (...args: unknown[]) => mockDismissSeoRegressionAlert(...args),
  getPublishState(appId: string) {
    const slice = mockDevelopStore.publishStates[appId];
    return {
      isPublishing: slice?.isPublishing ?? false,
      publishError: slice?.publishError ?? false,
      showFirstPublishCongrats: slice?.showFirstPublishCongrats ?? false,
      firstPublishDeployPending: slice?.firstPublishDeployPending ?? false,
      showPostPublishFeatureSelection: slice?.showPostPublishFeatureSelection ?? false,
    };
  },
  hasUnsavedChanges: false,
  handleViewModeChange: vi.fn(),
  handleMobileModeChange: vi.fn(),
  setIsPublishing: vi.fn(),
  setPublishError: vi.fn(),
  clearPublishStatus: vi.fn(),
  setSecurityAnalysisResult: vi.fn(),
  setDeploymentsRefetch: vi.fn(),
  setFirstPublishDeployPending: vi.fn(),
  openFeedbackModal: vi.fn(),
};

let mockDeploymentsData: Array<{ id: string; status: string }> = [];

const mockSiteStore = {
  getSite: vi.fn(),
  fetchSite: vi.fn().mockResolvedValue(null),
};

const mockStreaming = {
  isLoading: false,
  streamingState: 'idle' as string,
};

const mockRefetchGitHistory = vi.fn();
const mockRefetchDeployments = vi.fn();
const mockLogClickEvent = vi.fn(function () { return vi.fn(); });
const mockRunGate = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
let mockDnsConflictModal: ReactNode = null;

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouterInstance,
  usePathname: () => mockPathname,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () =>
    (key: string, _values?: Record<string, unknown>, defaultMessage?: string) =>
      defaultMessage ?? key,
}));

const mockSetActiveChatTab = vi.fn();
const mockSetActiveSettingsSection = vi.fn();
vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveChatTab: mockSetActiveChatTab,
    setActiveSettingsSection: mockSetActiveSettingsSection,
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
  useIsHistoryDisabled: () => ({ isDisabled: false }),
}));

let capturedOnPurchaseSuccess: (() => Promise<void>) | undefined;
vi.mock('@/hooks/usePaywallModal', () => ({
  usePaywallModal: vi.fn(function (options: { onPurchaseSuccess?: () => Promise<void> }) {
    capturedOnPurchaseSuccess = options.onPurchaseSuccess;
    return {
      checkAndShowPaywall: vi.fn(function (callback: () => void | Promise<void>) {
        void callback();
      }),
      paywallModal: null,
      isPolling: false,
      isPaywallLoading: false,
      isPublishLimitLoading: false,
    };
  }),
}));

vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({
    mutateAsync: mockMutateAsync,
  }),
}));

const mockIsUpgradePolling = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useUpgradePurchase', () => ({
  useIsUpgradePolling: () => mockIsUpgradePolling.value,
}));

const mockShowPaywall = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: () => ({
    showPaywall: mockShowPaywall.value,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useDnsConflictGate', () => ({
  useDnsConflictGate: () => ({
    modal: mockDnsConflictModal,
    runGate: mockRunGate,
  }),
}));

vi.mock('@/hooks/useSecretsDiff', () => ({
  useSecretsDiff: () => ({ refetch: vi.fn() }),
}));

const mockComplianceGateState = vi.hoisted(() => ({
  isBlocked: false,
  blockReason: null as string | null,
}));
vi.mock('@/hooks/usePublishComplianceGate', () => ({
  usePublishComplianceGate: () => ({
    isBlocked: mockComplianceGateState.isBlocked,
    blockReason: mockComplianceGateState.blockReason,
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ data: null }),
}));

const appPublishSwitchboardTestState = vi.hoisted(() => ({
  goLiveFeatureEnabled: true,
}));
const mockSwitchboardOverrides: Record<string, boolean> = {};

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function (feature: string) {
    if (feature in mockSwitchboardOverrides) {
      return mockSwitchboardOverrides[feature];
    }
    if (feature === 'appbuilder-publish-button') {
      return true;
    }
    if (feature === 'appbuilder-post-publish-feature-selection') {
      return true;
    }
    if (feature === 'appbuilder-go-live-feature') {
      return appPublishSwitchboardTestState.goLiveFeatureEnabled;
    }
    if (feature === 'appbuilder-settings-secrets') {
      return false;
    }
    return false;
  }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/post-publish-feature-selection', () => ({
  openPostPublishFeatureSelectionInChat: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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
  generateClickEID: vi.fn(function (id: string) { return id; }),
  logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
  logClickEvent: (...args: unknown[]) => {
    mockLogClickEvent(...args);
    return vi.fn();
  },
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
}));

vi.mock('@/hooks/useSeoQualityCheck', () => ({
  useSeoQualityCheck: vi.fn(),
}));

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
    removeGrowlMessage: vi.fn(),
  },
}));

vi.mock('@/hooks/usePublishUpsellEligibility', () => ({
  usePublishUpsellEligibility: vi.fn(() => ({ isExperimentEligible: false, isTreatment: false, isOnCohort: false })),
}));

describe('AppPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetActiveChatTab.mockReset();
    localStorage.removeItem('airo-feedback-shown:airo#app-builder');
    mockPathname = '/develop/app-123';
    mockDevelopStore.currentAppId = 'app-123';
    mockDevelopStore.isMobile = false;
    mockDevelopStore.publishStates = {};
    mockDeploymentsData = [];
    mockStreaming.isLoading = false;
    mockStreaming.streamingState = 'idle';
    appPublishSwitchboardTestState.goLiveFeatureEnabled = true;
    mockRunGate.mockReset();
    mockRunGate.mockResolvedValue({ proceed: true });
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);
    mockDnsConflictModal = null;
    mockIsUpgradePolling.value = false;
    mockShowPaywall.value = true;
    usePaywallStore.setState({ publishOpenAfterUpgradeAppId: null, showUpgradeModal: false, paywallLoading: false });
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
      })
    );
    global.ResizeObserver = vi.fn().mockImplementation(function () { return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }; });
    for (const key of Object.keys(mockSwitchboardOverrides)) {
      delete mockSwitchboardOverrides[key];
    }
    mockComplianceGateState.isBlocked = false;
    mockComplianceGateState.blockReason = null;
    mockDismissSeoRegressionAlert.mockReset();
    mockLogImpressionEvent.mockReset();
    mockLogImpressionEvent.mockReturnValue(vi.fn());
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

  it('should keep trigger enabled but disable inner publish when site has no agent_url', async function noAgentUrl() {
    mockSiteStore.getSite.mockReturnValue(createMockSite({ id: 'app-123', agent_url: undefined }));

    const { user } = renderWithProviders(<AppPublish />);

    // The top-level trigger button is always enabled — blocking reasons (missing agent_url,
    // paywall, compliance, etc.) surface as warnings inside the popover instead of fading
    // the header button.
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    expect(trigger).not.toBeDisabled();

    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    // The inner publish button inside the popover remains hard-disabled because
    // `isButtonDisabled` still includes `!site?.agent_url`.
    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    expect(innerPublishButton).toBeDisabled();
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

  it('should open popover when publish popover request nonce increments', async function openPopoverFromStoreRequest() {
    const { rerender } = renderWithProviders(<AppPublish />);

    expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();

    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    expect(mockLogClickEvent).not.toHaveBeenCalledWith(
      'develop.header.app_first_publish',
      { appId: 'app-123' },
    );
  });

  it('should skip nonce opens for chat toolbar instance on desktop', async function desktopSkipsToolbarNonce() {
    const { rerender } = renderWithProviders(<AppPublish location="develop.chat_toolbar" />);

    mockDevelopStore.isMobile = false;
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish location="develop.chat_toolbar" />);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });
  });

  it('should consume nonce opens for chat toolbar instance on mobile', async function mobileUsesToolbarNonce() {
    const { rerender } = renderWithProviders(<AppPublish location="develop.chat_toolbar" />);

    mockDevelopStore.isMobile = true;
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish location="develop.chat_toolbar" />);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
  });

  it('should show publish label on mobile chat toolbar only', async function chatToolbarPublishLabel() {
    mockDevelopStore.isMobile = true;

    const { rerender } = renderWithProviders(<AppPublish location="develop.chat_toolbar" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'builder_publish_button' })).toHaveTextContent('builder_publish_button');
    });

    mockDevelopStore.isMobile = false;
    rerender(<AppPublish location="develop.chat_toolbar" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'builder_publish_button' })).not.toHaveTextContent('builder_publish_button');
    });
  });

  it('should render the publish popover inside a bottom sheet on mobile', async function mobileRendersBottomSheet() {
    const { rerender } = renderWithProviders(<AppPublish location="develop.chat_toolbar" />);

    mockDevelopStore.isMobile = true;
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish location="develop.chat_toolbar" />);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
    expect(document.body.querySelector('.airo-surfaces-bottom-sheet__sheet')).not.toBeNull();
    expect(document.body.querySelector('.airo-surfaces-responsive-popover__flyout')).toBeNull();
    // E2E regression specs scope the publish popover by this test id; keep it
    // present on the mobile sheet (the shadcn data-slot is gone post-flyout).
    expect(document.body.querySelector('[data-testid="publish-popover"]')).not.toBeNull();
  });

  it('should render the publish popover as an anchored flyout (not a sheet) on desktop', async function desktopRendersFlyout() {
    const { rerender } = renderWithProviders(<AppPublish location="develop" />);

    mockDevelopStore.isMobile = false;
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish location="develop" />);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
    expect(document.body.querySelector('.airo-surfaces-responsive-popover__flyout')).not.toBeNull();
    expect(document.body.querySelector('.airo-surfaces-bottom-sheet__sheet')).toBeNull();
    // E2E regression specs scope the publish popover by this test id; keep it
    // present on the desktop flyout (replaces the removed shadcn data-slot).
    expect(document.body.querySelector('[data-testid="publish-popover"]')).not.toBeNull();
  });

  it('should skip nonce opens for header instance on mobile', async function mobileSkipsHeaderNonce() {
    const { rerender } = renderWithProviders(<AppPublish location="develop" />);

    mockDevelopStore.isMobile = true;
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish location="develop" />);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });
  });

  it('should reopen on successive nonce increments after close', async function reopenOnNonceRetrigger() {
    const { rerender, user } = renderWithProviders(<AppPublish />);

    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish />);
    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const trigger = document.getElementById('tour-publish-button');
    expect(trigger).toBeTruthy();
    await user.click(trigger!);
    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 2 };
    rerender(<AppPublish />);
    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
  });

  it('should not open popover when switching to another app with existing nonce', async function appSwitchDoesNotOpenForHistoricalNonce() {
    const { rerender } = renderWithProviders(<AppPublish />);

    expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();

    mockDevelopStore.publishStates['app-456'] = { publishPopoverRequestNonce: 3 };
    mockDevelopStore.currentAppId = 'app-456';
    mockSiteStore.getSite.mockReturnValueOnce(
      createMockSite({
        id: 'app-456',
        agent_url: 'https://app-456.agent.test',
      }),
    );
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });
  });

  it('should open popover after app switch when nonce increments past historical value', async function appSwitchNonceIncrementOpens() {
    const { rerender } = renderWithProviders(<AppPublish />);

    mockDevelopStore.publishStates['app-456'] = { publishPopoverRequestNonce: 3 };
    mockDevelopStore.currentAppId = 'app-456';
    mockSiteStore.getSite.mockReturnValueOnce(
      createMockSite({
        id: 'app-456',
        agent_url: 'https://app-456.agent.test',
      }),
    );
    rerender(<AppPublish />);
    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    mockDevelopStore.publishStates['app-456'] = { publishPopoverRequestNonce: 4 };
    rerender(<AppPublish />);
    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
  });

  it('should log already-open skip and still reopen on later nonce increment', async function alreadyOpenSkipThenReopen() {
    const { rerender, user } = renderWithProviders(<AppPublish />);

    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };
    rerender(<AppPublish />);
    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 2 };
    rerender(<AppPublish />);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('app-publish.popover.open-skipped.already-open', {
      appId: 'app-123',
      location: 'develop',
    });

    const trigger = document.getElementById('tour-publish-button');
    expect(trigger).toBeTruthy();
    await user.click(trigger!);
    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 3 };
    rerender(<AppPublish />);
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

  it('should not show conversation warning when popover is opened by agent via nonce', async function agentInitiatedNoWarning() {
    mockStreaming.streamingState = 'streaming';
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };

    renderWithProviders(<AppPublish />);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_conversation_warning')).not.toBeInTheDocument();
    });
  });

  it('should suppress conversation warning on manual reopen while agent publish is still in progress', async function agentPublishReopenNoWarning() {
    mockStreaming.streamingState = 'streaming';
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };

    const { user } = renderWithProviders(<AppPublish />);

    // Close popover manually.
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    // Re-open manually while streaming is still active
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_conversation_warning')).not.toBeInTheDocument();
    });
  });

  it('should show conversation warning again after agent publish conversation ends and a new streaming session begins', async function resetAfterConversationEnd() {
    mockStreaming.streamingState = 'streaming';
    mockDevelopStore.publishStates['app-123'] = { publishPopoverRequestNonce: 1 };

    const { rerender, user } = renderWithProviders(<AppPublish />);

    // Agent-initiated publish suppresses the warning
    await waitFor(() => {
      expect(screen.queryByText('builder_publish_conversation_warning')).not.toBeInTheDocument();
    });

    // Conversation ends → flag resets
    mockStreaming.streamingState = 'idle';
    rerender(<AppPublish />);

    // New streaming session starts (unrelated to publish)
    mockStreaming.streamingState = 'streaming';
    rerender(<AppPublish />);

    // User opens the popover manually — warning should appear now
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
        published_url: 'https://app-123.c4.test-airoapp.ai',
        variants: [],
      })
    );

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_unpublished_domain_info')).toBeInTheDocument();
      expect(screen.getByText('app-123.c4.test-airoapp.ai')).toBeInTheDocument();
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

  it('should open feedback modal directly to NPS on successful publish when feedback not given', async function postPublishFeedbackModal() {
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(mockDevelopStore.openFeedbackModal).toHaveBeenCalledWith('airo#app-builder', 'First publish', 'feedback');
    });
  });

  // Re-show protection is delegated to openFeedbackModal's localStorage guard in the store
  // (tested in useDevelopPageStore.test.ts #openFeedbackModal). AppPublish always calls
  // openFeedbackModal and lets the store decide whether to open the modal.
  it('should always call openFeedbackModal on publish and delegate re-show guard to store', async function delegatesGuardToStore() {
    localStorage.setItem('airo-feedback-shown:airo#app-builder', 'true');
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false };
    rerender(<AppPublish />);

    await waitFor(() => {
      // AppPublish always calls openFeedbackModal; the store no-ops it when already shown
      expect(mockDevelopStore.openFeedbackModal).toHaveBeenCalledWith('airo#app-builder', 'First publish', 'feedback');
    });
  });

  it('should not open feedback modal on successful publish when first publish congrats is shown', async function noFeedbackWhenFirstPublishCongrats() {
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true, showFirstPublishCongrats: true };

    const { rerender } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false, showFirstPublishCongrats: true };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(mockDevelopStore.openFeedbackModal).not.toHaveBeenCalledWith('airo#app-builder', 'First publish', 'feedback');
    });
  });

  it('should not show chat pre-launch CTA when appbuilder-go-live-feature is off', async function noChatPrelaunchWhenGoLiveFeatureOff() {
    appPublishSwitchboardTestState.goLiveFeatureEnabled = false;
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      }),
    );

    const { user } = renderWithProviders(<AppPublish />);
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Check SEO and Health' })).not.toBeInTheDocument();
  });

  it('should show Go Live button when app was published and post-publish flag is on', async function goLiveButton() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      })
    );

    const { user } = renderWithProviders(<AppPublish />);
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check SEO and Health' })).toBeInTheDocument();
    });
  });

  it('should open go live in chat when Go Live is clicked', async function goLiveClick() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      })
    );

    const { user } = renderWithProviders(<AppPublish />);
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    const goLive = await screen.findByRole('button', { name: 'Check SEO and Health' });
    await user.click(goLive);

    expect(vi.mocked(openPostPublishFeatureSelectionInChat)).toHaveBeenCalledWith('app-123');
    expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith('go_live.chat.opened_from_publish_popover', {
      appId: 'app-123',
    });
  });

  it('should disable Pre-Launch Check while publish or deploy is in progress', async function preLaunchDisabledPublishing() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      }),
    );
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { user } = renderWithProviders(<AppPublish />);
    const trigger = await screen.findByRole('button', { name: /builder_publish_button/ });
    await user.click(trigger);

    const goLive = await screen.findByRole('button', { name: 'Check SEO and Health' });
    expect(goLive).toBeDisabled();
    await user.click(goLive);
    expect(vi.mocked(openPostPublishFeatureSelectionInChat)).not.toHaveBeenCalled();
  });

  it('should disable Pre-Launch Check while the chat pre-launch prompt is open', async function preLaunchDisabledPromptOpen() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      }),
    );
    mockDevelopStore.publishStates['app-123'] = { showPostPublishFeatureSelection: true };

    const { user } = renderWithProviders(<AppPublish />);
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    const goLive = await screen.findByRole('button', { name: 'Check SEO and Health' });
    expect(goLive).toBeDisabled();
    await user.click(goLive);
    expect(vi.mocked(openPostPublishFeatureSelectionInChat)).not.toHaveBeenCalled();
  });

  it('should disable Pre-Launch Check while a chat response is in progress', async function preLaunchDisabledStreaming() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      }),
    );
    mockStreaming.isLoading = true;

    const { user } = renderWithProviders(<AppPublish />);
    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    const goLive = await screen.findByRole('button', { name: 'Check SEO and Health' });
    expect(goLive).toBeDisabled();
    await user.click(goLive);
    expect(vi.mocked(openPostPublishFeatureSelectionInChat)).not.toHaveBeenCalled();
  });

  it('should not show Go Live button for first-time publish', async function noGoLiveFirstTime() {
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

    expect(screen.queryByRole('button', { name: 'Check SEO and Health' })).not.toBeInTheDocument();
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
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(function () { return null; });

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

  it('should dispatch build-error-fix-request when fix action is clicked in popover', async function fixBuildErrorPopover() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };
    rerender(<AppPublish />);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'build-error-fix-request',
          appId: 'app-123',
          errorMessage: 'Build failed',
        }),
        window.location.origin
      );
    });

    expect(mockSetActiveChatTab).toHaveBeenCalledWith('chat');

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    postMessageSpy.mockRestore();
  });

  it('should dispatch build-error-fix-request when fix action is clicked in failed growl', async function fixBuildErrorGrowl() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };

    const { rerender, unmount } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'app-publish-failed' })
      );
    });

    const failedPayload = vi.mocked(Growl.addGrowlMessage).mock.calls
      .map((c) => c[0])
      .find(
        (a): a is { id: string; children: ReactNode } =>
          Boolean(a && typeof a === 'object' && 'id' in a && (a as { id: string }).id === 'app-publish-failed')
      );
    expect(failedPayload).toBeDefined();

    unmount();
    const { user } = renderWithProviders(<div>{failedPayload!.children}</div>);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    await waitFor(() => {
      expect(Growl.removeGrowlMessage).toHaveBeenCalledWith('app-publish-failed');
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'build-error-fix-request',
          appId: 'app-123',
          errorMessage: 'Build failed',
        }),
        window.location.origin
      );
    });

    expect(mockSetActiveChatTab).toHaveBeenCalledWith('chat');

    postMessageSpy.mockRestore();
  });

  it('should update failure growl with isFix=true when buildErrorDetails arrives after publishError', async function buildErrorDetailsLateArrival() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender, unmount } = renderWithProviders(<AppPublish />);

    // First update: failure lands but buildErrorDetails not yet arrived
    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: null,
    };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'app-publish-failed' })
      );
    });

    const firstCall = vi.mocked(Growl.addGrowlMessage).mock.calls.length;

    // Extract the first growl payload and verify it shows retry (isFix=false)
    const firstPayload = vi.mocked(Growl.addGrowlMessage).mock.calls
      .map((c) => c[0])
      .find(
        (a): a is { id: string; children: ReactNode } =>
          Boolean(a && typeof a === 'object' && 'id' in a && (a as { id: string }).id === 'app-publish-failed')
      );
    expect(firstPayload).toBeDefined();
    unmount();
    const { user: retryUser, unmount: unmountRetry } = renderWithProviders(<div>{firstPayload!.children}</div>);
    const retryButton = await screen.findByTestId('publish-failed-action');
    await retryUser.click(retryButton);
    expect(postMessageSpy).not.toHaveBeenCalled();
    unmountRetry();

    // Second update: buildErrorDetails arrives in a separate state update
    const { rerender: rerender2, unmount: unmount2 } = renderWithProviders(<AppPublish />);
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };
    rerender2(<AppPublish />);

    await waitFor(() => {
      expect(vi.mocked(Growl.addGrowlMessage).mock.calls.length).toBeGreaterThan(firstCall);
    });

    expect(Growl.removeGrowlMessage).toHaveBeenCalledWith('app-publish-failed');

    const updatedPayload = [...vi.mocked(Growl.addGrowlMessage).mock.calls]
      .reverse()
      .map((c) => c[0])
      .find(
        (a): a is { id: string; children: ReactNode } =>
          Boolean(a && typeof a === 'object' && 'id' in a && (a as { id: string }).id === 'app-publish-failed')
      );
    expect(updatedPayload).toBeDefined();
    unmount2();
    const { user: fixUser } = renderWithProviders(<div>{updatedPayload!.children}</div>);
    const fixButton = await screen.findByTestId('publish-failed-action');
    await fixUser.click(fixButton);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'build-error-fix-request',
          appId: 'app-123',
          errorMessage: 'Build failed',
        }),
        window.location.origin
      );
    });

    postMessageSpy.mockRestore();
  });

  it('should show disabled publish button instead of failed state while chat is actively fixing build error', async function publishButtonWhileFixing() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };
    mockStreaming.isLoading = true;
    rerender(<AppPublish />);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    const reopenTrigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(reopenTrigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('publish-failed-action')).not.toBeInTheDocument();

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    expect(innerPublishButton).toBeDisabled();

    postMessageSpy.mockRestore();
  });

  it('should clear publishResult when chat finishes fixing build error', async function clearPublishResultOnFixComplete() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Build failed', details: 'Detailed error', exitCode: 1 },
    };
    mockStreaming.isLoading = true;
    rerender(<AppPublish />);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    mockStreaming.isLoading = false;
    rerender(<AppPublish />);

    const reopenTrigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(reopenTrigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('publish-failed-action')).not.toBeInTheDocument();

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    expect(innerPublishButton).not.toBeDisabled();

    postMessageSpy.mockRestore();
  });

  it('should not dispatch build-error-fix-request when buildErrorDetails is absent', async function noFixWithoutBuildErrorDetails() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { rerender, unmount } = renderWithProviders(<AppPublish />);

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false, publishError: true };
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'app-publish-failed' })
      );
    });

    const failedPayload = vi.mocked(Growl.addGrowlMessage).mock.calls
      .map((c) => c[0])
      .find(
        (a): a is { id: string; children: ReactNode } =>
          Boolean(a && typeof a === 'object' && 'id' in a && (a as { id: string }).id === 'app-publish-failed')
      );

    unmount();
    const { user } = renderWithProviders(<div>{failedPayload!.children}</div>);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(Growl.removeGrowlMessage).toHaveBeenCalledWith('app-publish-failed');
    expect(mockDevelopStore.clearPublishStatus).toHaveBeenCalledWith('app-123');

    postMessageSpy.mockRestore();
  });

  it('should keep popover open when retry is clicked without buildErrorDetails', async function retryKeepsPopoverOpen() {
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false, publishError: true };
    rerender(<AppPublish />);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    expect(postMessageSpy).not.toHaveBeenCalled();

    postMessageSpy.mockRestore();
  });

  it('should clear publish status and set isPublishing when deploy starts', async function deployInitiatesPublish() {
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false, publishError: true };
    rerender(<AppPublish />);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    await waitFor(() => {
      expect(mockDevelopStore.clearPublishStatus).toHaveBeenCalledWith('app-123');
    });
    expect(mockDevelopStore.setIsPublishing).toHaveBeenCalledWith('app-123', true);
  });

  it('should clear isFixingBuildError when switching apps', async function clearFixingOnAppSwitch() {
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: true,
      buildErrorDetails: { error: 'Build failed', details: 'details', exitCode: 1 },
    };

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    // Transition app-123 publishing -> failed so the in-popover failure UI renders
    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Build failed', details: 'details', exitCode: 1 },
    };
    rerender(<AppPublish />);

    const actionButton = await screen.findByTestId('publish-failed-action');
    await user.click(actionButton);

    // Fix-in-progress hides the failure UI in the popover
    expect(screen.queryByTestId('publish-failed-action')).not.toBeInTheDocument();

    // Switch to a different app that is mid-publish
    mockDevelopStore.currentAppId = 'app-456';
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({ id: 'app-456', agent_url: 'https://app-456.agent.test' })
    );
    mockDeploymentsData = [{ id: 'dep-2', status: 'IN_PROGRESS' }];
    mockDevelopStore.publishStates['app-456'] = { isPublishing: true };
    rerender(<AppPublish />);

    const newTrigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(newTrigger);

    // Drive app-456 publishing -> failed; if isFixingBuildError leaked across apps,
    // the failure UI would be hidden by `publishResult === 'failed' && !isFixingBuildError`
    mockDeploymentsData = [{ id: 'dep-2', status: DeploymentStatus.FAILED }];
    mockDevelopStore.publishStates['app-456'] = {
      isPublishing: false,
      publishError: true,
      buildErrorDetails: { error: 'Other error', details: 'details', exitCode: 1 },
    };
    rerender(<AppPublish />);

    expect(await screen.findByTestId('publish-failed-action')).toBeInTheDocument();
  });

  it('should not set publish error when DNS gate blocks publish', async function gateBlockedDoesNotSetError() {
    mockRunGate.mockResolvedValueOnce({ proceed: false });

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockRunGate).toHaveBeenCalledTimes(1);
    });
    expect(mockDevelopStore.setPublishError).not.toHaveBeenCalled();
    expect(screen.queryByTestId('publish-failed-action')).not.toBeInTheDocument();
  });

  it('should not set publish error when DNS gate is dismissed', async function gateDismissedDoesNotSetError() {
    mockRunGate.mockResolvedValueOnce({ proceed: false, reason: 'dismissed' });

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockRunGate).toHaveBeenCalledTimes(1);
    });
    expect(mockDevelopStore.setPublishError).not.toHaveBeenCalled();
    expect(screen.queryByTestId('publish-failed-action')).not.toBeInTheDocument();
  });

  it('should forward dnsUpdateConsent=true from gate result to publish mutation', async function consentTrueForwarded() {
    mockRunGate.mockResolvedValueOnce({ proceed: true, consent: true });

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'app-123',
        dnsUpdateConsent: true,
      });
    });
  });

  it('should forward dnsUpdateConsent=false from gate result to publish mutation', async function consentFalseForwarded() {
    mockRunGate.mockResolvedValueOnce({ proceed: true, consent: false });

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'app-123',
        dnsUpdateConsent: false,
      });
    });
  });

  it('should set publish error when DNS gate throws unexpectedly', async function gateThrowSetsPublishError() {
    mockRunGate.mockRejectedValueOnce(new Error('gate failed'));

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockDevelopStore.setPublishError).toHaveBeenCalledWith('app-123', true);
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('should not set publish error when upgrade modal is showing after publish failure', async function upgradeModalSuppressesError() {
    mockRunGate.mockResolvedValueOnce({ proceed: true });
    mockMutateAsync.mockRejectedValueOnce(
      new PublishUpgradeRequiredError(PublishDenialReason.NoSubscription, 'Publish not allowed'),
    );
    usePaywallStore.setState({ showUpgradeModal: true });

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ appId: 'app-123' });
    });
    expect(mockDevelopStore.setPublishError).not.toHaveBeenCalled();
  });

  it('should set publish error when upgrade modal is not showing after publish failure', async function publishFailureSetsError() {
    mockRunGate.mockResolvedValueOnce({ proceed: true });
    mockMutateAsync.mockRejectedValueOnce(new Error('Server error'));
    usePaywallStore.setState({ showUpgradeModal: false });

    const { user } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
    const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
    expect(innerPublishButton).toBeDefined();
    await user.click(innerPublishButton!);

    await waitFor(() => {
      expect(mockDevelopStore.setPublishError).toHaveBeenCalledWith('app-123', true);
    });
  });

  it('should call handleViewModeChange with DOMAIN on desktop when domain edit is clicked and top-level flag is on', async function domainEditDesktop() {
    mockSwitchboardOverrides['appbuilder-domain-top-level'] = true;
    mockSiteStore.getSite.mockReturnValue(createMockSite({
      id: 'app-123',
      agent_url: 'https://app-123.agent.test',
      published_url: 'https://test.airoapp.ai',
      variants: ['publish'],
    }));

    const { user } = renderWithProviders(<AppPublish />);

    await user.click(document.getElementById('tour-publish-button')!);

    await waitFor(() => {
      expect(screen.getByText('builder_domain_title')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'builder_common_edit' }));

    expect(mockDevelopStore.handleViewModeChange).toHaveBeenCalledWith(ViewMode.DOMAIN, false);
    expect(mockDevelopStore.handleMobileModeChange).not.toHaveBeenCalled();
    expect(mockSetActiveSettingsSection).not.toHaveBeenCalled();
    expect(mockSetActiveChatTab).not.toHaveBeenCalled();
  });

  it('should call handleMobileModeChange with PREVIEW on mobile when domain edit is clicked and top-level flag is on', async function domainEditMobile() {
    mockSwitchboardOverrides['appbuilder-domain-top-level'] = true;
    mockDevelopStore.isMobile = true;
    mockSiteStore.getSite.mockReturnValue(createMockSite({
      id: 'app-123',
      agent_url: 'https://app-123.agent.test',
      published_url: 'https://test.airoapp.ai',
      variants: ['publish'],
    }));

    const { user } = renderWithProviders(<AppPublish />);

    await user.click(document.getElementById('tour-publish-button')!);

    await waitFor(() => {
      expect(screen.getByText('builder_domain_title')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'builder_common_edit' }));

    expect(mockDevelopStore.handleViewModeChange).toHaveBeenCalledWith(ViewMode.DOMAIN, false);
    expect(mockDevelopStore.handleMobileModeChange).toHaveBeenCalledWith(MobileMode.PREVIEW);
  });

  it('should navigate to settings DOMAIN section when domain edit is clicked and top-level flag is off', async function domainEditFlagOff() {
    mockSwitchboardOverrides['appbuilder-domain-top-level'] = false;
    mockSiteStore.getSite.mockReturnValue(createMockSite({
      id: 'app-123',
      agent_url: 'https://app-123.agent.test',
      published_url: 'https://test.airoapp.ai',
      variants: ['publish'],
    }));

    const { user } = renderWithProviders(<AppPublish />);

    await user.click(document.getElementById('tour-publish-button')!);

    await waitFor(() => {
      expect(screen.getByText('builder_domain_title')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'builder_common_edit' }));

    expect(mockSetActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DOMAIN);
    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.SETTINGS);
    expect(mockDevelopStore.handleViewModeChange).not.toHaveBeenCalled();
    expect(mockDevelopStore.handleMobileModeChange).not.toHaveBeenCalled();
  });

  describe('upgrade polling and publish popover', () => {
    it('should not open popover while upgrade polling is in progress', async function popoverWaitsDuringPolling() {
      mockIsUpgradePolling.value = true;

      renderWithProviders(<AppPublish />);

      // Simulate onPurchaseSuccess being called after user upgrades
      await capturedOnPurchaseSuccess?.();

      // Popover should NOT be open while polling is in progress
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    it('should open popover after upgrade polling completes', async function popoverOpensAfterPolling() {
      mockIsUpgradePolling.value = true;

      const { rerender } = renderWithProviders(<AppPublish />);

      // Simulate onPurchaseSuccess being called after user upgrades
      await capturedOnPurchaseSuccess?.();

      // Popover should NOT be open while polling is in progress
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();

      // Simulate polling completing
      mockIsUpgradePolling.value = false;
      rerender(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
      });

      // Site data must be force-refreshed (silent) before opening so domain is current
      expect(mockSiteStore.fetchSite).toHaveBeenCalledWith('app-123', true, true);
    });

    it('should open popover immediately when no upgrade polling is active', async function popoverOpensImmediately() {
      mockIsUpgradePolling.value = false;

      renderWithProviders(<AppPublish />);

      // Simulate onPurchaseSuccess being called (e.g. renewal, no polling needed)
      await capturedOnPurchaseSuccess?.();

      await waitFor(() => {
        expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
      });

      // Site data must be force-refreshed (silent) before opening so domain is current
      expect(mockSiteStore.fetchSite).toHaveBeenCalledWith('app-123', true, true);
    });
  });

  describe('combine-publish auto-open after upgrade', () => {
    it('opens the publish popover once the armed app flips to paid', async function opensWhenPaid() {
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = true;

      const { rerender } = renderWithProviders(<AppPublish />);

      // Still free → popover stays closed
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();

      // Account becomes paid → auto-open
      mockShowPaywall.value = false;
      rerender(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
      });
      expect(mockSiteStore.fetchSite).toHaveBeenCalledWith('app-123', true, true);
      // Arm is consumed exactly once
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe(null);
    });

    it('does not open while the account is still free', async function staysClosedWhenFree() {
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = true;

      renderWithProviders(<AppPublish />);

      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
      expect(mockSiteStore.fetchSite).not.toHaveBeenCalled();
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-123');
    });

    it('does not open when the armed app is a different app', async function ignoresOtherApp() {
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'other-app' });
      mockShowPaywall.value = false;

      renderWithProviders(<AppPublish />);

      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
      expect(mockSiteStore.fetchSite).not.toHaveBeenCalled();
    });

    it('waits for upgrade polling to settle and keeps the arm until it actually opens', async function waitsForPolling() {
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = false; // paid
      mockIsUpgradePolling.value = true; // ...but grant-polling still running

      const { rerender } = renderWithProviders(<AppPublish />);

      // Must NOT open yet, and the arm must survive (so a remount during polling can still open)
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
      expect(mockSiteStore.fetchSite).not.toHaveBeenCalled();
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-123');

      // Polling settles → open now, arm consumed
      mockIsUpgradePolling.value = false;
      rerender(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
      });
      expect(mockSiteStore.fetchSite).toHaveBeenCalledWith('app-123', true, true);
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe(null);
    });

    it('does not consume the arm off the develop page', async function ignoresOffDevelop() {
      mockPathname = '/apps';
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = false;

      renderWithProviders(<AppPublish />);

      expect(mockSiteStore.fetchSite).not.toHaveBeenCalled();
      // Arm preserved so it can still fire when the user returns to the develop page
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-123');
    });

    it('does not consume on the non-matching viewport instance (mobile header)', async function viewportDedupSkips() {
      mockDevelopStore.isMobile = true;
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = false;

      // location 'develop' (isChatToolbar=false) on mobile → guarded out
      renderWithProviders(<AppPublish location="develop" />);

      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-123');
    });

    it('consumes on the matching viewport instance (mobile chat toolbar)', async function viewportDedupActs() {
      mockDevelopStore.isMobile = true;
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = false;

      renderWithProviders(<AppPublish location="develop.chat_toolbar" />);

      await waitFor(() => {
        expect(mockSiteStore.fetchSite).toHaveBeenCalledWith('app-123', true, true);
      });
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe(null);
    });

    it('clears a stale arm when navigating to a different app', async function safeguardClearsOnAppChange() {
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
      mockShowPaywall.value = true; // still free → arm not consumed

      const { rerender } = renderWithProviders(<AppPublish />);
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-123');

      mockDevelopStore.currentAppId = 'app-456';
      rerender(<AppPublish />);

      await waitFor(() => {
        expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe(null);
      });
    });

    it('keeps the rehydrated arm while currentAppId is null, then consumes it once it hydrates', async () => {
      // arm restored from sessionStorage by persist; develop store not yet hydrated.
      // Preconditions for the auto-open path: paid (showPaywall false), not polling, active instance.
      usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-1' });
      mockShowPaywall.value = false;
      mockDevelopStore.currentAppId = null;
      const { rerender } = renderWithProviders(<AppPublish location="develop" />);
      expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-1'); // safeguard did NOT clear it

      mockDevelopStore.currentAppId = 'app-1';
      rerender(<AppPublish location="develop" />);
      await waitFor(() =>
        expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBeNull(), // auto-open consumed it
      );
    });
  });

  describe('publish.attempted analytics', () => {
    async function openPopoverAndClickPublish(user: ReturnType<typeof renderWithProviders>['user']) {
      const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
      await user.click(trigger);
      await waitFor(() => {
        expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
      });
      const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
      const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
      expect(innerPublishButton).toBeDefined();
      await user.click(innerPublishButton!);
    }

    it('disables the inner publish button when compliance is blocked (analytics at line 346 is a race-condition guard)', async function complianceBlocked() {
      // When isPublishComplianceBlocked is true, isButtonDisabled is also true,
      // so the inner publish button cannot be clicked from the UI. The
      // publish.attempted at AppPublish.tsx:346 fires only in a race condition
      // where the compliance state changes after the user initiates the flow;
      // the key verifiable property is that the button is disabled and a
      // compliance alert is shown.
      mockComplianceGateState.isBlocked = true;
      mockComplianceGateState.blockReason = 'site_suspended';

      const { user } = renderWithProviders(<AppPublish />);

      const trigger = await screen.findByRole('button', { name: 'builder_publish_button' });
      await user.click(trigger);

      await waitFor(() => {
        expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
      });

      const publishButtons = screen.getAllByRole('button', { name: 'builder_publish_button' });
      const innerPublishButton = publishButtons.find((btn) => btn.id !== 'tour-publish-button');
      expect(innerPublishButton).toBeDefined();
      // Button must be disabled when compliance is blocked
      expect(innerPublishButton).toBeDisabled();
      // Gate must never run (blocked earlier in handleDeploy)
      expect(mockRunGate).not.toHaveBeenCalled();
    });

    it('fires publish.attempted with blockedReason=gate_blocked when gate returns proceed:false', async function gateBlocked() {
      mockRunGate.mockResolvedValueOnce({ proceed: false });

      const { user } = renderWithProviders(<AppPublish />);
      await openPopoverAndClickPublish(user);

      await waitFor(() => {
        expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith(
          'publish.attempted',
          expect.objectContaining({
            appId: 'app-123',
            blockedReason: 'gate_blocked',
            trigger: 'ui',
          }),
        );
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('fires publish.attempted without blockedReason when all gates pass', async function gatesPassed() {
      mockRunGate.mockResolvedValueOnce({ proceed: true });

      const { user } = renderWithProviders(<AppPublish />);
      await openPopoverAndClickPublish(user);

      await waitFor(() => {
        expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith(
          'publish.attempted',
          expect.objectContaining({ appId: 'app-123', trigger: 'ui' }),
        );
      });
      // Confirm the gates-passed call does NOT carry a blockedReason
      const gatesPassedCall = vi.mocked(shipAnalyticsLog).mock.calls.find(
        ([event, data]) => event === 'publish.attempted' && !data.blockedReason,
      );
      expect(gatesPassedCall).toBeDefined();
    });
  });

  describe('SEO regression alert', function seoAlertTests() {
    const seoAlert = {
      scoreDelta: -30,
      currentScore: 50,
      regressions: [{ path: '/about', newIssues: ['missing-h1'] }],
    };

    it('should render the alert when seoRegressionAlert is set', async function rendersAlert() {
      mockDevelopStore.publishStates['app-123'] = { seoRegressionAlert: seoAlert };

      renderWithProviders(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByTestId('seo-quality-regression-alert')).toBeInTheDocument();
      });
    });

    it('should not render the alert when seoRegressionAlert is null', async function noAlertWhenNull() {
      mockDevelopStore.publishStates['app-123'] = { seoRegressionAlert: null };

      renderWithProviders(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_publish_button' })).toBeInTheDocument();
      });
      expect(screen.queryByTestId('seo-quality-regression-alert')).not.toBeInTheDocument();
    });

    it('should call dismissSeoRegressionAlert when close button is clicked', async function dismissOnClose() {
      mockDevelopStore.publishStates['app-123'] = { seoRegressionAlert: seoAlert };

      const { user } = renderWithProviders(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByTestId('seo-quality-regression-alert')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_common_close' }));

      expect(mockDismissSeoRegressionAlert).toHaveBeenCalledWith('app-123');
    });

    it('should fire seo.alert.shown impression when alert appears', async function impressionOnShow() {
      mockDevelopStore.publishStates['app-123'] = { seoRegressionAlert: seoAlert };

      renderWithProviders(<AppPublish />);

      await waitFor(() => {
        expect(screen.getByTestId('seo-quality-regression-alert')).toBeInTheDocument();
      });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('seo.alert.shown', {
        scoreDelta: -30,
        currentScore: 50,
        affectedPages: 1,
      });
    });
  });
});

describe('AppPublish — combine-publish treatment', () => {
  beforeEach(async () => {
    mockPathname = '/develop/app-123';
    const { usePublishUpsellEligibility } = await import('@/hooks/usePublishUpsellEligibility');
    vi.mocked(usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible: true, isTreatment: true, isOnCohort: false });
  });

  it('renders the upsell popover and not the normal publish flow when isTreatment', async () => {
    const { user } = renderWithProviders(<AppPublish location="develop" />);
    const trigger = await screen.findByTestId('publish-upsell-trigger');
    await user.click(trigger);
    expect(await screen.findByTestId('publish-upsell-see-plans')).toBeInTheDocument();
    // Negative check: the normal publish popover (title key) is never rendered in treatment.
    expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
  });

  // End-to-end through the REAL upsell component + REAL paywall store: the only thing a real
  // purchase does to the client is flip the account to paid, so we drive everything else for real.
  it('arms via a real See Plans click and auto-opens the popover once the account flips to paid', async () => {
    const { usePublishUpsellEligibility } = await import('@/hooks/usePublishUpsellEligibility');
    const { user, rerender } = renderWithProviders(<AppPublish location="develop" />);

    // Free treatment user: open the upsell and click "See Plans" (arms the real store via the real component)
    await user.click(await screen.findByTestId('publish-upsell-trigger'));
    await user.click(await screen.findByTestId('publish-upsell-see-plans'));
    expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe('app-123');
    expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();

    // Simulate the purchase landing: account becomes paid → treatment turns off.
    mockShowPaywall.value = false;
    vi.mocked(usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible: false, isTreatment: false, isOnCohort: false });
    rerender(<AppPublish location="develop" />);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
    expect(mockSiteStore.fetchSite).toHaveBeenCalledWith('app-123', true, true);
    expect(usePaywallStore.getState().publishOpenAfterUpgradeAppId).toBe(null);
  });

  it('emits app_first_publish at the treatment upsell publish-button click (control-equivalent)', async () => {
    const { usePublishUpsellEligibility } = await import('@/hooks/usePublishUpsellEligibility');
    vi.mocked(usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible: true, isTreatment: true, isOnCohort: true });
    mockShowPaywall.value = true;
    const { user } = renderWithProviders(<AppPublish location="develop" />);
    await user.click(await screen.findByTestId('publish-upsell-trigger'));
    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.header.app_first_publish', { appId: 'app-123' });
  });

  it('does NOT emit app_*publish at the post-upgrade auto-open', async () => {
    // Paid (showPaywall false) => isTreatment is false => normal branch; arm set + currentAppId already
    // the armed app so the popover auto-opens. The click EID must NOT fire here (it fired at the click).
    const { usePublishUpsellEligibility } = await import('@/hooks/usePublishUpsellEligibility');
    vi.mocked(usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible: false, isTreatment: false, isOnCohort: true });
    usePaywallStore.setState({ publishOpenAfterUpgradeAppId: 'app-123' });
    mockShowPaywall.value = false;
    mockDevelopStore.currentAppId = 'app-123';
    renderWithProviders(<AppPublish location="develop" />);
    expect(mockLogClickEvent).not.toHaveBeenCalledWith('develop.header.app_first_publish', { appId: 'app-123' });
  });
});

// Regression tests for closePopover state clearing — must live outside the
// combine-publish describe so the upsell treatment is not active.
describe('AppPublish — closePopover state clearing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.removeItem('airo-feedback-shown:airo#app-builder');
    mockPathname = '/develop/app-123';
    mockDevelopStore.currentAppId = 'app-123';
    mockDevelopStore.isMobile = false;
    mockDevelopStore.publishStates = {};
    mockDeploymentsData = [];
    mockStreaming.isLoading = false;
    mockStreaming.streamingState = 'idle';
    appPublishSwitchboardTestState.goLiveFeatureEnabled = true;
    mockRunGate.mockReset();
    mockRunGate.mockResolvedValue({ proceed: true });
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);
    mockDnsConflictModal = null;
    mockIsUpgradePolling.value = false;
    // Ensure paywall/upsell treatment is off so the normal publish trigger renders
    mockShowPaywall.value = false;
    const { usePublishUpsellEligibility } = await import('@/hooks/usePublishUpsellEligibility');
    vi.mocked(usePublishUpsellEligibility).mockReturnValue({ isExperimentEligible: false, isTreatment: false, isOnCohort: false });
    usePaywallStore.setState({ publishOpenAfterUpgradeAppId: null, showUpgradeModal: false, paywallLoading: false });
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({ id: 'app-123', agent_url: 'https://app-123.agent.test' })
    );
    global.ResizeObserver = vi.fn().mockImplementation(function () { return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }; });
    mockComplianceGateState.isBlocked = false;
    mockComplianceGateState.blockReason = null;
    mockLogImpressionEvent.mockReset();
    mockLogImpressionEvent.mockReturnValue(vi.fn());
  });

  it('should clear success state when View Fixes is clicked so popover shows Publish on reopen', async function clearSuccessOnViewFixes() {
    mockSwitchboardOverrides['appbuilder-security-scan-ui'] = true;
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    // Publish completes; security scan finds issues simultaneously — the exact race the bug describes
    mockDevelopStore.publishStates['app-123'] = {
      isPublishing: false,
      publishError: false,
      securityAnalysisResult: 'issues',
    };
    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(screen.getByTestId('publish-success-alert')).toBeInTheDocument();
    });
    const viewFixes = await screen.findByText('builder_security_scan_view_fixes');
    await user.click(viewFixes);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    // Reopen — stale success state must be cleared
    const reopenTrigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(reopenTrigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('publish-success-alert')).not.toBeInTheDocument();
  });

  it('should clear success state when Go Live in Chat is clicked so popover shows Publish on reopen', async function clearSuccessOnGoLive() {
    mockSiteStore.getSite.mockReturnValue(
      createMockSite({
        id: 'app-123',
        agent_url: 'https://app-123.agent.test',
        variants: ['publish'],
      })
    );
    mockDevelopStore.publishStates['app-123'] = { isPublishing: true };
    mockDeploymentsData = [{ id: 'dep-1', status: 'IN_PROGRESS' }];

    const { user, rerender } = renderWithProviders(<AppPublish />);

    const trigger = await screen.findByRole('button', { name: 'builder_publish_button_publishing' });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });

    // Publish completes
    mockDevelopStore.publishStates['app-123'] = { isPublishing: false, publishError: false };
    mockDeploymentsData = [{ id: 'dep-1', status: DeploymentStatus.DEPLOYED }];
    rerender(<AppPublish />);

    await waitFor(() => {
      expect(screen.getByTestId('publish-success-alert')).toBeInTheDocument();
    });

    const goLive = await screen.findByRole('button', { name: 'Check SEO and Health' });
    await user.click(goLive);

    await waitFor(() => {
      expect(screen.queryByText('builder_publish_popover_title')).not.toBeInTheDocument();
    });

    // Reopen — stale success state must be cleared
    const reopenTrigger = await screen.findByRole('button', { name: 'builder_publish_button' });
    await user.click(reopenTrigger);

    await waitFor(() => {
      expect(screen.getByText('builder_publish_popover_title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('publish-success-alert')).not.toBeInTheDocument();
  });
});
