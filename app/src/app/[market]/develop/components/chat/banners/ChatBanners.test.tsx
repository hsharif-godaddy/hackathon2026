/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { WarningLevel } from '@/types/usage';
import ChatBanners from './ChatBanners';

const mockIsEmployeeAuthType = vi.fn(() => false);
vi.mock('@airo/shared/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/shared/auth')>();
  return {
    ...actual,
    isEmployeeAuthType: (...args: unknown[]) => mockIsEmployeeAuthType(...args),
  };
});

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(() => ({ tokenAuthType: 'shopper' })),
}));

// Mock hooks that child components use
vi.mock('@/hooks/useUsage', () => ({
  useUsage: vi.fn(function () { return {
    isWarningBannerActive: false,
    percentage: 0,
    creditsRemaining: 100,
    warningLevel: 'none',
    isLoading: false,
  }; }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(function () { return { showPaywall: true, isLoading: false, isError: false, error: null }; }),
}));

// Create a mocked store state that can be updated in tests
const mockStoreState = {
  openFeedbackModal: vi.fn(),
  showFeedbackBanner: false,
  showAppGenerationFeedbackBanner: false,
  showAgentWorkFeedbackBanner: false,
  appGenerationFeedbackTraceIds: { traceId: 'trace-1', observationId: 'obs-1' },
  currentAppId: 'test-app',
  agentWorkFeedbackAgentId: 'airo-app-builder-InitialAgent',
  agentWorkFeedbackTraceIds: { traceId: 'trace-1', observationId: 'obs-1' },
  agentWorkFeedbackRevealMilestone: 'firstFileEdit',
  markAppGenerationFeedbackSubmitted: vi.fn(),
  setShowAppGenerationFeedbackBanner: vi.fn(),
  markAgentWorkFeedbackSubmitted: vi.fn(),
  setShowAgentWorkFeedbackBanner: vi.fn(),
  showResponseFeedbackThanksBannerTemporarily: vi.fn(),
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(function (selector: (state: typeof mockStoreState) => unknown) { return selector(mockStoreState); }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      availableAgents: [{ id: 'InitialAgent', name: 'Initial Agent' }],
      currentAgentName: 'InitialAgent',
    }),
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}));

vi.mock('@/hooks/chat/useChatHelpers', () => ({
  getConversationIdFromCookie: () => 'conv-1',
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'http://agents.test' }),
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  generateClickEID: (id: string) => id,
}));

describe('ChatBanners', function chatBannersTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockIsEmployeeAuthType.mockReturnValue(false);
    // Reset store state
    mockStoreState.showFeedbackBanner = false;
    mockStoreState.showAppGenerationFeedbackBanner = false;
    mockStoreState.showAgentWorkFeedbackBanner = false;
  });

  describe('impersonation banner', function impersonationTests() {
    it('should show ImpersonationBanner when user is impersonating (e2s)', async function showImpersonationBanner() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      vi.mocked(useAuthContext).mockReturnValue({ tokenAuthType: 'e2s' } as any);
      mockIsEmployeeAuthType.mockReturnValue(true);

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(screen.getByText('builder_chat_impersonation_banner_message')).toBeInTheDocument();
      });
    });

    it('should show ImpersonationBanner when user is impersonating (e2s2s)', async function showImpersonationBannerE2s2s() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      vi.mocked(useAuthContext).mockReturnValue({ tokenAuthType: 'e2s2s' } as any);
      mockIsEmployeeAuthType.mockReturnValue(true);

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(screen.getByText('builder_chat_impersonation_banner_message')).toBeInTheDocument();
      });
    });

    it('should take priority over all other banners when impersonating', async function impersonationHighestPriority() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      const { useUsage } = await import('@/hooks/useUsage');

      vi.mocked(useAuthContext).mockReturnValue({ tokenAuthType: 'e2s' } as any);
      mockIsEmployeeAuthType.mockReturnValue(true);

      // Also activate usage warning (priority 3)
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: true,
        percentage: 95,
        creditsRemaining: 5,
        warningLevel: WarningLevel.WARNING,
        isLoading: false,
      });

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(screen.getByText('builder_chat_impersonation_banner_message')).toBeInTheDocument();
      });

      // Usage warning should NOT be visible
      expect(screen.queryByText('builder_usage_warning_message_no_purchase_v2')).not.toBeInTheDocument();
    });

    it('should be dismissible via close button', async function dismissImpersonationBanner() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      vi.mocked(useAuthContext).mockReturnValue({ tokenAuthType: 'e2s' } as any);
      mockIsEmployeeAuthType.mockReturnValue(true);

      const { user } = renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(screen.getByText('builder_chat_impersonation_banner_message')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: 'builder_common_close' });
      await user.click(closeButton);

      expect(screen.queryByText('builder_chat_impersonation_banner_message')).not.toBeInTheDocument();
    });

    it('should not show ImpersonationBanner for regular shopper auth', async function noImpersonationForShopper() {
      const { useAuthContext } = await import('@/components/providers/AuthProvider');
      vi.mocked(useAuthContext).mockReturnValue({ tokenAuthType: 'shopper' } as any);
      mockIsEmployeeAuthType.mockReturnValue(false);

      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });

      renderWithProviders(<ChatBanners appId="test-app" />);

      expect(screen.queryByText('builder_chat_impersonation_banner_message')).not.toBeInTheDocument();
    });
  });

  describe('banner priority', function priorityTests() {
    it('should show UsageWarningBanner when usage warning is active', async function showWarningBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: true,
        percentage: 92,
        creditsRemaining: 8,
        warningLevel: WarningLevel.WARNING,
        isLoading: false,
      });
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        // UsageWarningBanner renders its message ID when no translations provided
        expect(screen.getByText('builder_usage_warning_message_no_purchase_v2')).toBeInTheDocument();
      });
    });

    it('should show UpgradeBanner when usage warning is not active and user should see paywall', async function showUpgradeBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        creditsRemaining: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,
      });
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        // UpgradeBanner renders its message ID when no translations provided
        expect(screen.getByText('builder_airoplus_upgrade_message')).toBeInTheDocument();
      });
    });

    it('should show FeedbackBanner when no higher priority banners are active', async function showFeedbackBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        creditsRemaining: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,
      });

      // Mock switchboard to return false for upgrade banner and true for feedback banner
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-airoplus-upgrade-banner') {
          return false;
        }
        if (flag === 'appbuilder-feedback-banner') {
          return true;
        }
        return false;
      });

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });

      // Set store state to show feedback banner
      mockStoreState.showFeedbackBanner = true;

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        // FeedbackBanner renders its message ID when no translations provided
        expect(screen.getByText('builder_feedback_banner_message')).toBeInTheDocument();
      });
    });

    it('should pass appId to useUsage hook', async function passAppId() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 0,
        creditsRemaining: 100,
        warningLevel: WarningLevel.NONE,
        isLoading: false,
      });

      renderWithProviders(<ChatBanners appId="my-app-id" />);

      expect(useUsage).toHaveBeenCalledWith({ appId: 'my-app-id', enabled: true });
    });

    it('should show AppGenerationFeedbackBanner when store flag is set', async function showAppGenerationBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        creditsRemaining: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,
      });
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({
        showPaywall: false,
        isLoading: false,
        isError: false,
        error: null,
      });

      mockStoreState.showAppGenerationFeedbackBanner = true;

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(screen.getByTestId('app-generation-feedback-banner')).toBeInTheDocument();
      });
    });

    it('should show AgentWorkFeedbackBanner when store flag is set', async function showAgentWorkBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        creditsRemaining: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,
      });
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({
        showPaywall: false,
        isLoading: false,
        isError: false,
        error: null,
      });

      mockStoreState.showAgentWorkFeedbackBanner = true;

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(screen.getByTestId('agent-work-feedback-banner')).toBeInTheDocument();
      });
    });

    it('should disable useUsage when appId is null', async function disableWithNullAppId() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 0,
        creditsRemaining: 100,
        warningLevel: WarningLevel.NONE,
        isLoading: false,
      });

      renderWithProviders(<ChatBanners appId={null} />);

      expect(useUsage).toHaveBeenCalledWith({ appId: null, enabled: false });
    });
  });
});
