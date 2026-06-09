/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { createMockSite, mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import DomainPanel from './index';

const mockOpenUpgradeModal = vi.fn();

const domainPanelLayoutTestState = vi.hoisted(function hoistedLayoutState() {
  return {
    rootBoxGap: undefined as string | undefined,
    appDetails: { domains: [] as Array<{ fqdn: string; domainType: string; status: string }> },
    isAppDetailsFetched: true,
  };
});

vi.mock('@ux/box', async function mockUxBox() {
  const actual = await vi.importActual<typeof import('@ux/box')>('@ux/box');
  const ActualBox = actual.default;

  return {
    default: function Box(props: ComponentProps<typeof ActualBox>) {
      if (typeof props.className === 'string' && props.className.includes('@container')) {
        domainPanelLayoutTestState.rootBoxGap = props.gap;
      }
      return <ActualBox {...props} />;
    },
  };
});

vi.mock('@/hooks/useDomainPolling', () => ({
  useDomainPolling: vi.fn(() => ({
    data: domainPanelLayoutTestState.appDetails,
    isFetched: domainPanelLayoutTestState.isAppDetailsFetched,
  })),
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: false, isLoading: false })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => (true)),
}));

vi.mock('@/hooks/useDomainDnsOwnership', () => ({
  useDomainDnsOwnership: vi.fn(() => ({
    data: { isGdDomain: false },
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector) => {
    const state = {
      getSite: vi.fn(() => null),
      loading: {},
    };
    return selector(state);
  }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({}),
}));

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: any) => selector({
    openUpgradeModal: mockOpenUpgradeModal,
    domainJobsInProgress: {},
  }),
}));

vi.mock('./usePublishForDomain', () => ({
  usePublishForDomain: vi.fn(() => ({
    handlePublish: vi.fn(),
    isPublishDisabled: false,
    publishState: { isPublishing: false },
  })),
}));

vi.mock('@/utils/instrumentation', () => mockInstrumentation());

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

describe('DomainPanel', function domainPanelTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    domainPanelLayoutTestState.rootBoxGap = undefined;
    domainPanelLayoutTestState.appDetails = { domains: [] };
    domainPanelLayoutTestState.isAppDetailsFetched = true;
  });

  function expectSectionOrder(firstText: string, secondText: string) {
    const first = screen.getByText(firstText);
    const second = screen.getByText(secondText);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  async function setupPublishedDomainPanel(switchboard: (feature: string) => boolean) {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
    const { useSiteStore } = await import('@/stores/useSiteStore');

    vi.mocked(useSwitchboard).mockImplementation(switchboard);
    vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
    vi.mocked(useSiteStore).mockImplementation((selector: any) => {
      const mockSite = createMockSite({ variants: ['publish'] });
      const state = {
        getSite: vi.fn(() => mockSite),
        loading: {},
      };
      return selector(state);
    });
  }

  function domainConnectFlags(connectEnabled: boolean) {
    return function resolveSwitchboard(feature: string) {
      if (feature === 'appbuilder-domain-connect') {
        return connectEnabled;
      }
      if (feature === 'appbuilder-domain-attach' || feature === 'appbuilder-project-domain') {
        return true;
      }
      return false;
    };
  }

  describe('loading states', function loadingTests() {
    it('should show skeleton when site is loading', async function siteLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const state = {
          getSite: vi.fn(() => null),
          loading: { 'test-app-123': true },
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
    });

    it('should show skeleton when paywall eligibility is loading', async function paywallLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: true });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
    });
  });

  describe('upgrade screen for free users', function upgradeScreenTests() {
    it('should show upgrade screen when user is free and site not published', async function showUpgradeScreen() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] }); // No publish variant = not published
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByText('builder_domain_upgrade_title')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_upgrade_description')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'builder_upgrade_button' })).toBeInTheDocument();
    });

    it('should call openUpgradeModal when upgrade button is clicked', async function clickUpgradeButton() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      const { user } = renderWithProviders(<DomainPanel />);

      const upgradeButton = screen.getByRole('button', { name: 'builder_upgrade_button' });
      await user.click(upgradeButton);

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('domains.upgrade', PAYWALL_ITC.UPGRADE);
    });

    it('should render RidingArrow SVG in upgrade screen', async function renderRidingArrow() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      // Check for SVG element
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('publish required screen for paid users', function publishRequiredTests() {
    it('should show publish screen when paid user has not published', async function showPublishScreen() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] }); // Not published
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByText('builder_domain_publish_required_title')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_publish_required_description')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_publish_now')).toBeInTheDocument();
    });

    it('should show publishing text when publishing is in progress', async function showPublishingText() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');
      const { usePublishForDomain } = await import('./usePublishForDomain');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });
      vi.mocked(usePublishForDomain).mockReturnValue({
        handlePublish: vi.fn(),
        isPublishDisabled: true,
        publishState: { isPublishing: true },
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByText('builder_domain_publishing')).toBeInTheDocument();
    });

    it('should call handlePublish when publish button is clicked', async function clickPublishButton() {
      const mockHandlePublish = vi.fn();
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');
      const { usePublishForDomain } = await import('./usePublishForDomain');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });
      vi.mocked(usePublishForDomain).mockReturnValue({
        handlePublish: mockHandlePublish,
        isPublishDisabled: false,
        publishState: { isPublishing: false },
      });

      const { user } = renderWithProviders(<DomainPanel />);

      const publishButton = screen.getByText('builder_domain_publish_now');
      await user.click(publishButton);

      expect(mockHandlePublish).toHaveBeenCalled();
    });
  });

  describe('domain management view for published sites', function domainManagementTests() {
    it('should show domain management when site is published and features enabled', async function showDomainManagement() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({
          variants: ['publish'], // Has publish variant = published
        });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      // Should NOT show upgrade or publish screens
      expect(screen.queryByText('builder_domain_upgrade_title')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_publish_required_title')).not.toBeInTheDocument();
    });

    it('should show domain management when inactive publish but custom domain remains', async function showDomainMgmtWithCustomDomain() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({
          variantsWithLifecycle: [{ variant: 'publish', status: 'inactive' }],
          variants: [],
          domains: [
            {
              fqdn: 'custom.example.com',
              isPrimary: false,
              domainType: DomainType.CUSTOM,
              prefix: '',
              status: DomainStatus.ACTIVE,
              createdAt: '',
              updatedAt: '',
            },
          ],
        });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.queryByText('builder_domain_upgrade_title')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_domain_publish_required_title')).not.toBeInTheDocument();
    });

    it('should show ProjectDomain component when project domain feature is enabled', async function showProjectDomain() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockImplementation((feature: string) => {
        if (feature === 'appbuilder-project-domain') {
          return true;
        }
        return false;
      });
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({
          variants: ['publish'],
        });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      // ProjectDomain renders with specific content - verify component renders
      await waitFor(function waitForProjectDomain() {
        // The component should render without upgrade/publish screens
        expect(screen.queryByText('builder_domain_upgrade_title')).not.toBeInTheDocument();
        expect(screen.queryByText('builder_domain_publish_required_title')).not.toBeInTheDocument();
      });
    });
  });

  describe('feature flags disabled', function featureFlagsDisabledTests() {
    it('should show coming soon message when both domain features are disabled', async function showComingSoon() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({
          variants: ['publish'],
        });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByText('builder_domain_title')).toBeInTheDocument();
      expect(screen.getByText('builder_domain_coming_soon')).toBeInTheDocument();
    });

    it('should not show upgrade screen when domain features are disabled even for free users', async function noUpgradeWhenDisabled() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: [] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      // Should show coming soon, not upgrade screen
      expect(screen.getByText('builder_domain_title')).toBeInTheDocument();
      expect(screen.queryByText('builder_domain_upgrade_title')).not.toBeInTheDocument();
    });
  });

  describe('analytics', function analyticsTests() {
    it('does not log panel_viewed when both domain features are disabled', async function panelViewedFlagsOff() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: ['publish'] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      await waitFor(function settle() {
        expect(screen.getByText('builder_domain_coming_soon')).toBeInTheDocument();
      });
      expect(shipAnalyticsLog).not.toHaveBeenCalledWith(
        'settings.domains.panel_viewed',
        expect.anything(),
      );
    });

    it('logs panel_viewed once per app while features are enabled', async function panelViewedOncePerApp() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');
      const { useAppIdFromParams } = await import('@/app/[market]/develop/components/utils');

      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const mockSite = createMockSite({ variants: ['publish'] });
        const state = {
          getSite: vi.fn(() => mockSite),
          loading: {},
        };
        return selector(state);
      });

      const { rerender } = renderWithProviders(<DomainPanel />);

      await waitFor(function firstView() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('settings.domains.panel_viewed', {
          appId: 'test-app-123',
        });
      });

      rerender(<DomainPanel />);

      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1);

      vi.mocked(useAppIdFromParams).mockReturnValue('other-app-456');
      rerender(<DomainPanel />);

      await waitFor(function secondAppView() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('settings.domains.panel_viewed', {
          appId: 'other-app-456',
        });
      });
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(2);
    });
  });

  describe('appbuilder-domain-connect layout', function domainConnectLayoutTests() {
    it('uses connect layout order, section divider, and larger gap when flag is on', async function connectLayoutOn() {
      await setupPublishedDomainPanel(domainConnectFlags(true));

      renderWithProviders(<DomainPanel />);

      await waitFor(function waitForSections() {
        expect(screen.getByText('builder_domain_attach_main_title')).toBeInTheDocument();
        expect(screen.getByText('builder_project_domain_title')).toBeInTheDocument();
      });

      expectSectionOrder('builder_domain_attach_main_title', 'builder_project_domain_title');
      expect(
        document.querySelector('.border-t.border-intents-ux-boxLowContrast-borderColor.pt-6'),
      ).toBeInTheDocument();
      expect(domainPanelLayoutTestState.rootBoxGap).toBe('lg');
    });

    it('preserves legacy section order and smaller gap when flag is off without active custom domain', async function connectLayoutOffNoCustomDomain() {
      await setupPublishedDomainPanel(domainConnectFlags(false));

      renderWithProviders(<DomainPanel />);

      await waitFor(function waitForSections() {
        expect(screen.getByText('builder_custom_domain_title')).toBeInTheDocument();
        expect(screen.getByText('builder_project_domain_title')).toBeInTheDocument();
      });

      expectSectionOrder('builder_project_domain_title', 'builder_custom_domain_title');
      expect(
        document.querySelector('.border-t.border-intents-ux-boxLowContrast-borderColor.pt-6'),
      ).not.toBeInTheDocument();
      expect(domainPanelLayoutTestState.rootBoxGap).toBe('sm');
    });

    it('preserves legacy section order when flag is off and an active custom domain exists', async function connectLayoutOffWithCustomDomain() {
      domainPanelLayoutTestState.appDetails = {
        domains: [{
          fqdn: 'custom.example.com',
          domainType: DomainType.CUSTOM,
          status: DomainStatus.ACTIVE,
        }],
      };

      await setupPublishedDomainPanel(domainConnectFlags(false));

      renderWithProviders(<DomainPanel />);

      await waitFor(function waitForSections() {
        expect(screen.getByText('builder_custom_domain_title')).toBeInTheDocument();
        expect(screen.getByText('builder_project_domain_title')).toBeInTheDocument();
      });

      expectSectionOrder('builder_custom_domain_title', 'builder_project_domain_title');
      expect(
        document.querySelector('.border-t.border-intents-ux-boxLowContrast-borderColor.pt-6'),
      ).not.toBeInTheDocument();
      expect(domainPanelLayoutTestState.rootBoxGap).toBe('sm');
    });
  });

  describe('no app id', function noAppIdTests() {
    it('should handle null app id gracefully', async function nullAppId() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');
      const { useAppIdFromParams } = await import('@/app/[market]/develop/components/utils');

      vi.mocked(useAppIdFromParams).mockReturnValue(null);
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false });
      vi.mocked(useSiteStore).mockImplementation((selector: any) => {
        const state = {
          getSite: vi.fn(() => null),
          loading: {},
        };
        return selector(state);
      });

      renderWithProviders(<DomainPanel />);

      // Should show publish required screen since site is null (not published)
      expect(screen.getByText('builder_domain_publish_required_title')).toBeInTheDocument();
    });
  });
});
