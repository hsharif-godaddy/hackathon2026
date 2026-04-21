/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { DomainStatus, DomainType, type SiteInfo } from '@/lib/control-plane/types';
import { createMockSite } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import BudgetExceededBanner from './BudgetExceededBanner';

const mockLogImpressionEvent = vi.fn();
const mockOpenUpgradeModal = vi.fn();
const mockOpenCreditsModal = vi.fn();

let mockSite: SiteInfo | null = null;
const mockSubscriptionData = {
  data: { id: 'sub-1', builderEntitlementId: 'ent-1', plan: SubscriptionPlan.AiroPlus } as any,
  isLoading: false,
};
const mockGrantsData = { data: [] as any[] };

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string, customProperties?: Record<string, boolean | string | number>) => {
    mockLogImpressionEvent(eid, customProperties);
    return () => {};
  },
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockSubscriptionData,
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => mockGrantsData,
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({ data: false, isLoading: false }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openUpgradeModal: mockOpenUpgradeModal, openCreditsModal: mockOpenCreditsModal, site: mockSite }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('react-intl', async () => {
  const actual = await vi.importActual<typeof import('react-intl')>('react-intl');
  return {
    ...actual,
    useIntl: () => ({
      formatDate: (_d: Date, opts?: Record<string, string>) =>
        opts?.month ? 'April 2' : '5:36 PM PDT',
    }),
  };
});

describe('BudgetExceededBanner', function budgetExceededBannerTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockSite = null;
    mockSubscriptionData.data = { id: 'sub-1', builderEntitlementId: 'ent-1', plan: SubscriptionPlan.AiroPlus };
    mockSubscriptionData.isLoading = false;
    mockGrantsData.data = [];
  });

  describe('#render', function renderTests() {
    it('should render the alert title', async function renderTitle() {
      mockSite = createMockSite({ id: 'test-app-123' });
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertTitle() {
        expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
      });
    });

    it('should render buy credits button when grants are enabled', async function renderBuyCredits() {
      mockSite = createMockSite({ id: 'test-app-123' });
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertBuyCredits() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });
    });

  });

  describe('#upgradeButton', function upgradeButtonTests() {
    it('should show Upgrade button for free plan users', async function showUpgradeForFree() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockSubscriptionData.data = { id: 'sub-1', builderEntitlementId: 'ent-1', plan: SubscriptionPlan.Free };
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });
    });

    it('should show Upgrade button for none plan users', async function showUpgradeForNone() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockSubscriptionData.data = { id: 'sub-1', builderEntitlementId: 'ent-1', plan: undefined };
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });
    });

    it('should NOT show Upgrade button for Ultimate users', async function hideUpgradeForUltimate() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockSubscriptionData.data = { id: 'sub-1', builderEntitlementId: 'ent-1', plan: SubscriptionPlan.Ultimate };
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertBuyCreditsVisible() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_usage_gauge_upgrade')).not.toBeInTheDocument();
    });

    it('should show Upgrade button for non-Ultimate paid users (Starter, Professional, AiroPlus)', async function showUpgradeForNonUltimatePaid() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockSubscriptionData.data = { id: 'sub-1', builderEntitlementId: 'ent-1', plan: SubscriptionPlan.Starter };
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });
    });
  });

  describe('#purchaseDisabled', function purchaseDisabledTests() {
    it('should disable buttons when grants enabled but entitlementId is missing', async function disabledWhenNoEntitlement() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockSubscriptionData.data = { id: 'sub-1', builderEntitlementId: undefined, plan: SubscriptionPlan.AiroPlus };
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertDisabledButton() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens').closest('button')).toBeDisabled();
      });
    });

    it('should enable buttons when entitlementId is present', async function enabledWithEntitlement() {
      mockSite = createMockSite({ id: 'test-app-123' });
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertEnabledButton() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens').closest('button')).not.toBeDisabled();
      });
    });
  });

  describe('#resetTime', function resetTimeTests() {
    it('should show reset time when grants have a plan grant with useBefore date', async function showGrantsResetTime() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockGrantsData.data = [
        { id: 'g1', type: GrantType.PlanMonthly, useBefore: '2026-04-02T17:36:00Z', isAvailable: true, finalState: null },
      ];
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertResetTime() {
        expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
      });

      // The reset time message key should be used (not the no_reset_time key)
      expect(screen.queryByText('builder_usage_limit_message_no_reset_time')).not.toBeInTheDocument();
    });

    it('should show no-reset-time message when grants enabled but no plan grant exists', async function noResetTimeWhenNoPlanGrant() {
      mockSite = createMockSite({ id: 'test-app-123' });
      mockGrantsData.data = []; // No plan grant
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertNoResetTime() {
        expect(screen.getByText('builder_usage_limit_message_no_reset_time')).toBeInTheDocument();
      });
    });

  });

  describe('#onClose', function onCloseTests() {
    it('should call onClose when the close button is clicked', async function callsOnClose() {
      const onClose = vi.fn();
      mockSite = createMockSite({ id: 'test-app-123' });
      const { user } = renderWithProviders(<BudgetExceededBanner onClose={onClose} />);

      await waitFor(function assertTitle() {
        expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should NOT render a close button when onClose is not provided', async function noCloseButton() {
      mockSite = createMockSite({ id: 'test-app-123' });
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertTitle() {
        expect(screen.getByText('builder_usage_limit_title')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
  });

  describe('#impressionLogging', function impressionLoggingTests() {
    it('should log impression on mount when site is available', async function logImpressionOnMount() {
      mockSite = createMockSite({ id: 'test-app-123', variants: ['preview'] });
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'chat.budgetExceeded.view',
          expect.objectContaining({
            has_published_app: false,
            has_custom_domain: false,
          })
        );
      });
    });

    it('should NOT log impression when site is null', async function noImpressionWithNullSite() {
      mockSite = null;
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertAlertRendered() {
        expect(document.body).toBeTruthy();
      });

      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });

    it('should log impression only once on re-renders', async function singleImpressionOnRerender() {
      mockSite = createMockSite({ id: 'test-app-123' });
      const { rerender } = renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertFirstImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
      });

      rerender(<BudgetExceededBanner />);

      expect(mockLogImpressionEvent).toHaveBeenCalledTimes(1);
    });

    it('should include has_published_app true when site has publish variant', async function hasPublishedApp() {
      mockSite = createMockSite({ id: 'test-app-123', variants: ['preview', 'publish'] });
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'chat.budgetExceeded.view',
          expect.objectContaining({ has_published_app: true })
        );
      });
    });

    it('should include has_custom_domain true when site has active custom domain', async function hasCustomDomain() {
      mockSite = createMockSite({
        id: 'test-app-123',
        variants: ['preview'],
        domains: [
          {
            fqdn: 'myapp.example.com',
            domainType: DomainType.CUSTOM,
            status: DomainStatus.ACTIVE,
            isPrimary: true,
            prefix: '',
            createdAt: '',
            updatedAt: '',
          },
        ],
      } as Partial<SiteInfo>);
      renderWithProviders(<BudgetExceededBanner />);

      await waitFor(function assertImpression() {
        expect(mockLogImpressionEvent).toHaveBeenCalledWith(
          'chat.budgetExceeded.view',
          expect.objectContaining({ has_custom_domain: true })
        );
      });
    });
  });
});
