/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { createMockSite, mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import DomainPanel from './index';

const mockOpenUpgradeModal = vi.fn();

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: false, isLoading: false })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false })),
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
  useDevelopPageStore: (selector: any) => selector({
    openUpgradeModal: mockOpenUpgradeModal,
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

describe('DomainPanel', function domainPanelTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('loading states', function loadingTests() {
    it('should show skeleton when domain attach feature is loading', async function domainAttachLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation((feature: string) => {
        if (feature === 'appbuilder-domain-attach') {
          return { data: undefined, isLoading: true } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
    });

    it('should show skeleton when project domain feature is loading', async function projectDomainLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation((feature: string) => {
        if (feature === 'appbuilder-project-domain') {
          return { data: undefined, isLoading: true } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      renderWithProviders(<DomainPanel />);

      expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
    });

    it('should show skeleton when site is loading', async function siteLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSiteStore } = await import('@/stores/useSiteStore');

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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
          return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        }
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);
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

  describe('no app id', function noAppIdTests() {
    it('should handle null app id gracefully', async function nullAppId() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSiteStore } = await import('@/stores/useSiteStore');
      const { useAppIdFromParams } = await import('@/app/[market]/develop/components/utils');

      vi.mocked(useAppIdFromParams).mockReturnValue(null);
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
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
