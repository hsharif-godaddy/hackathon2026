/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import HigherPlansUpgradeContainer from './HigherPlansUpgradeContainer';

const mockOnClose = vi.fn();
const mockOnSuccessClick = vi.fn();
const mockOnErrorClick = vi.fn();
const mockOnError = vi.fn();
const mockGetQueryData = vi.fn();
const mockHandlePurchaseSuccess = vi.fn();

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({
    cds: 'mock-cds-url',
    intl: { locale: 'en-US' },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    getUserInfo: () => ({ shopperId: 'test-shopper-123' }),
  }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      getQueryData: mockGetQueryData,
    }),
  };
});

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    data: {
      id: 'test-subscription-123',
      builderEntitlementId: 'test-entitlement-123',
      plan: SubscriptionPlan.Professional,
    },
    isLoading: false,
    isError: false,
  })),
}));


vi.mock('@/hooks/useUpgradePurchase', () => ({
  useUpgradePurchase: () => ({
    handlePurchaseSuccess: mockHandlePurchaseSuccess,
    isPolling: false,
  }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/paywall/shared', () => ({
  isPlanUpgrade: vi.fn((oldPlan, newPlan) => {
    const priority: Record<string, number> = { free: 0, starter: 1, professional: 2, ultimate: 3 };
    return (priority[newPlan as string] ?? 0) > (priority[oldPlan as string] ?? 0);
  }),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('./cdsLoader', () => ({
  ComponentLoader: (props: {
    subType: string;
    productNamespace: string;
    allowPaidToPaidModal: boolean;
    accountId?: string;
    locale: string;
    source: string;
    currentPlan?: string;
    overrideItc?: string;
    /** Mirrors UPP `requestedPlanType` — Hivemind recommended tier shown in the paywall */
    requestedPlanType?: SubscriptionPlan.Professional | SubscriptionPlan.Ultimate;
    onClose: () => void;
    upgradeCallback: (params: { planType?: SubscriptionPlan }) => void;
    upgradeDowngradeCallback: (params: { planType?: SubscriptionPlan }) => void;
    onPostUpgradeSuccessClick?: () => void;
    errorCallback?: () => void;
    onError?: (error: Error) => void;
  }) => {
    return (
      <div data-testid="higher-plans-modal">
        <span data-testid="sub-type">{props.subType}</span>
        <span data-testid="product-namespace">{props.productNamespace}</span>
        <span data-testid="allow-paid-to-paid">{props.allowPaidToPaidModal?.toString()}</span>
        <span data-testid="account-id">{props.accountId ?? ''}</span>
        <span data-testid="locale">{props.locale}</span>
        <span data-testid="source">{props.source}</span>
        <span data-testid="current-plan">{props.currentPlan ?? ''}</span>
        <span data-testid="override-itc">{props.overrideItc ?? ''}</span>
        <span data-testid="requested-plan-type">{props.requestedPlanType ?? ''}</span>
        <button data-testid="close-button" onClick={props.onClose}>Close</button>
        <button
          data-testid="upgrade-button"
          onClick={() => props.upgradeCallback({ planType: SubscriptionPlan.Ultimate })}
        >
          Upgrade
        </button>
        <button
          data-testid="downgrade-button"
          onClick={() => props.upgradeDowngradeCallback({ planType: SubscriptionPlan.Starter })}
        >
          Downgrade
        </button>
        <button
          data-testid="success-click-button"
          onClick={props.onPostUpgradeSuccessClick}
        >
          Success Click
        </button>
        <button
          data-testid="error-button"
          onClick={props.errorCallback}
        >
          Error
        </button>
        <button
          data-testid="on-error-button"
          onClick={() => props.onError?.(new Error('Test error'))}
        >
          On Error
        </button>
        <button
          data-testid="renew-professional-button"
          onClick={() => props.upgradeCallback({ planType: SubscriptionPlan.Professional })}
        >
          Renew Professional
        </button>
        <button
          data-testid="renew-starter-button"
          onClick={() => props.upgradeDowngradeCallback({ planType: SubscriptionPlan.Starter })}
        >
          Renew Starter
        </button>
      </div>
    );
  },
}));

vi.mock('./PaywallLoadingModal', () => ({
  PaywallLoadingModal: () => <div data-testid="loading-modal">Loading...</div>,
  PaywallLoadingModalVariant: {
    HigherPlans: 'higher-plans',
  },
}));

import { useSubscription } from '@/hooks/useSubscription';
import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';

describe('HigherPlansUpgradeContainer', function higherPlansUpgradeContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.mocked(useSubscription).mockReturnValue({
      data: { id: 'test-subscription-123', builderEntitlementId: 'test-entitlement-123', plan: SubscriptionPlan.Professional },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSubscription>);
    mockHandlePurchaseSuccess.mockResolvedValue({ planAfterPurchase: 'ultimate', updated: true, grantUpdated: true });
    // Mock getQueryData to return different data based on query key
    mockGetQueryData.mockImplementation((queryKey: unknown[]) => {
      if (queryKey[0] === 'subscriptions') {
        return {
          active: {
            plan: 'professional',
            downgradedPlan: undefined,
          },
        };
      }
      if (queryKey[0] === 'credit-grants') {
        return [
          {
            id: 'initial-plan-monthly-grant-id',
            type: 'plan-monthly',
            isAvailable: true,
            subscriptionId: 'test-subscription-123',
          },
        ];
      }
      return undefined;
    });
  });

  it('renders the ComponentLoader with correct props', function rendersCorrectly() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    expect(screen.getByTestId('higher-plans-modal')).toBeInTheDocument();
    expect(screen.getByTestId('sub-type')).toHaveTextContent('UniversalUpgrade');
    expect(screen.getByTestId('product-namespace')).toHaveTextContent('airobuildr');
    expect(screen.getByTestId('allow-paid-to-paid')).toHaveTextContent('true');
    expect(screen.getByTestId('locale')).toHaveTextContent('en-US');
    expect(screen.getByTestId('source')).toHaveTextContent('app-builder-NES');
  });

  describe('recommendedPlan → requestedPlanType (UPP recommended tier)', function recommendedPlanTests() {
    it('passes professional when recommendedPlan is Professional (treatment off / default path)', function professionalRecommended() {
      renderWithProviders(
        <HigherPlansUpgradeContainer
          onClose={mockOnClose}
          recommendedPlan={SubscriptionPlan.Professional}
        />
      );

      expect(screen.getByTestId('requested-plan-type')).toHaveTextContent(SubscriptionPlan.Professional);
    });

    it('passes ultimate when recommendedPlan is Ultimate (treatment cohort)', function ultimateRecommended() {
      renderWithProviders(
        <HigherPlansUpgradeContainer
          onClose={mockOnClose}
          recommendedPlan={SubscriptionPlan.Ultimate}
        />
      );

      expect(screen.getByTestId('requested-plan-type')).toHaveTextContent(SubscriptionPlan.Ultimate);
    });

    it('passes empty requestedPlanType when recommendedPlan is omitted', function noRecommendedPlan() {
      renderWithProviders(
        <HigherPlansUpgradeContainer onClose={mockOnClose} />
      );

      expect(screen.getByTestId('requested-plan-type')).toBeEmptyDOMElement();
    });
  });

  it('passes entitlementId when grants are enabled', async function passesEntitlementId() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    expect(screen.getByTestId('account-id')).toHaveTextContent('test-entitlement-123');
  });

  it('calls onClose when close button is clicked', function callsOnClose() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('close-button'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles upgrade success and triggers polling', async function handlesUpgradeSuccess() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        onSuccessClick={mockOnSuccessClick}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('upgrade-button'));

    expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase.success');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', expect.objectContaining({
      source: 'test-source',
      fromPlan: 'professional',
      toPlan: SubscriptionPlan.Ultimate,
    }));
    expect(mockHandlePurchaseSuccess).toHaveBeenCalledWith(
      'professional',
      SubscriptionPlan.Ultimate,
      undefined,
      true, // isUpgrade
      'test-source',
      expect.any(String),
      'test-subscription-123', // subscriptionId for grant polling
      'initial-plan-monthly-grant-id' // initialPlanMonthlyGrantId for grant polling
    );
    expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase_ultimate.success');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('plan.purchase_ultimate.in-app', expect.objectContaining({
      source: 'test-source',
      productId: expect.any(String),
      fromPlan: 'professional',
      toPlan: SubscriptionPlan.Ultimate,
    }));
  });

  it('handles downgrade and triggers polling', async function handlesDowngrade() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('downgrade-button'));

    expect(mockHandlePurchaseSuccess).toHaveBeenCalledWith(
      'professional',
      SubscriptionPlan.Starter,
      undefined,
      false, // isUpgrade = false for downgrade
      'test-source',
      expect.any(String),
      undefined, // no subscriptionId for downgrades (no grant polling)
      undefined // no initialPlanMonthlyGrantId for downgrades
    );
  });

  it('calls onSuccessClick when success click button is triggered', function callsOnSuccessClick() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        onSuccessClick={mockOnSuccessClick}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('success-click-button'));
    expect(mockOnSuccessClick).toHaveBeenCalled();
  });

  it('calls onErrorClick when error button is triggered', function callsOnErrorClick() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        onErrorClick={mockOnErrorClick}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('error-button'));
    expect(mockOnErrorClick).toHaveBeenCalled();
  });

  it('logs error and calls onError when error occurs', function logsError() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        onError={mockOnError}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('on-error-button'));

    expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.cds.load.error', expect.objectContaining({
      source: 'test-source',
      error: 'Test error',
      component: 'HigherPlansUpgradeContainer',
    }));
    expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('passes current plan to ComponentLoader when no downgradedPlan exists', function passesCurrentPlan() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    expect(screen.getByTestId('current-plan')).toHaveTextContent('professional');
  });

  it('passes downgradedPlan as currentPlan when it exists', async function passesDowngradedPlanAsCurrentPlan() {
    const { useSubscription } = await import('@/hooks/useSubscription');
    vi.mocked(useSubscription).mockReturnValue({
      data: {
        builderEntitlementId: 'test-entitlement-123',
        plan: SubscriptionPlan.Professional,
        downgradedPlan: SubscriptionPlan.Starter,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSubscription>);

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    expect(screen.getByTestId('current-plan')).toHaveTextContent('starter');
  });

  it('prefers downgradedPlan over plan for currentPlan prop', async function prefersDowngradedPlan() {
    const { useSubscription } = await import('@/hooks/useSubscription');
    vi.mocked(useSubscription).mockReturnValue({
      data: {
        builderEntitlementId: 'test-entitlement-123',
        plan: SubscriptionPlan.Ultimate,
        downgradedPlan: SubscriptionPlan.Starter,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSubscription>);

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    // Should use downgradedPlan (starter) not plan (ultimate)
    expect(screen.getByTestId('current-plan')).toHaveTextContent('starter');
  });

  it('handles undefined subscription gracefully', async function handlesUndefinedSubscription() {
    const { useSubscription } = await import('@/hooks/useSubscription');
    vi.mocked(useSubscription).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useSubscription>);

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    // Should not crash and currentPlan should be empty when subscription is undefined
    expect(screen.getByTestId('current-plan')).toHaveTextContent('');
  });

  it('passes ITC override when provided', function passesItc() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
        itc="test-itc-code"
      />
    );

    expect(screen.getByTestId('override-itc')).toHaveTextContent('test-itc-code');
  });

  it('passes empty ITC when not provided', function passesEmptyItc() {
    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    expect(screen.getByTestId('override-itc')).toHaveTextContent('');
  });

  it('passes undefined for initialPlanMonthlyGrantId when grants cache is empty', async function coldCachePassesUndefined() {
    mockGetQueryData.mockImplementation((queryKey: unknown[]) => {
      if (queryKey[0] === 'subscriptions') {
        return {
          active: {
            plan: 'professional',
            downgradedPlan: undefined,
          },
        };
      }
      // credit-grants cache is empty/undefined
      return undefined;
    });

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('upgrade-button'));

    expect(mockHandlePurchaseSuccess).toHaveBeenCalledWith(
      'professional',
      SubscriptionPlan.Ultimate,
      undefined,
      true,
      'test-source',
      expect.any(String),
      'test-subscription-123',
      undefined // initialPlanMonthlyGrantId should be undefined when cache is cold
    );
  });

  it('includes downgradedPlan from cached data when re-upgrading', async function includesDowngradedPlan() {
    mockGetQueryData.mockImplementation((queryKey: unknown[]) => {
      if (queryKey[0] === 'subscriptions') {
        return {
          active: {
            plan: 'professional',
            downgradedPlan: 'starter', // user had previously scheduled downgrade to starter
          },
        };
      }
      if (queryKey[0] === 'credit-grants') {
        return [
          {
            id: 'initial-plan-monthly-grant-id',
            type: 'plan-monthly',
            isAvailable: true,
            subscriptionId: 'test-subscription-123',
          },
        ];
      }
      return undefined;
    });

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('upgrade-button'));

    expect(mockHandlePurchaseSuccess).toHaveBeenCalledWith(
      'professional',
      SubscriptionPlan.Ultimate,
      'starter', // downgradedPlan passed
      true,
      'test-source',
      expect.any(String),
      'test-subscription-123', // subscriptionId for grant polling
      'initial-plan-monthly-grant-id' // initialPlanMonthlyGrantId for grant polling
    );
  });

  it('skips polling for renewal when plan before and after are the same', function skipsPollingForRenewal() {
    mockGetQueryData.mockReturnValue({
      active: {
        plan: 'professional',
        downgradedPlan: undefined,
      },
    });

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    fireEvent.click(screen.getByTestId('renew-professional-button'));

    expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase.success');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', expect.objectContaining({
      source: 'test-source',
      fromPlan: 'professional',
      toPlan: SubscriptionPlan.Professional,
    }));
    expect(shipAnalyticsLog).toHaveBeenCalledWith('paid_plan.renewal.success', {
      source: 'test-source',
      productId: expect.any(String),
      plan: SubscriptionPlan.Professional,
    });

    expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase_professional.success');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('plan.purchase_professional.in-app', expect.objectContaining({
      source: 'test-source',
      productId: expect.any(String),
      fromPlan: 'professional',
      toPlan: SubscriptionPlan.Professional,
    }));
    // Should NOT call handlePurchaseSuccess for renewals - no polling needed
    expect(mockHandlePurchaseSuccess).not.toHaveBeenCalled();
  });

  it('skips polling for renewal of scheduled downgrade plan', function skipsPollingForDowngradeRenewal() {
    mockGetQueryData.mockReturnValue({
      active: {
        plan: 'professional',
        downgradedPlan: 'starter', // user had previously scheduled downgrade to starter
      },
    });

    renderWithProviders(
      <HigherPlansUpgradeContainer
        onClose={mockOnClose}
        source="test-source"
      />
    );

    // User purchases the plan they were already scheduled to downgrade to
    fireEvent.click(screen.getByTestId('renew-starter-button'));

    expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase.success');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('airoplus.purchase.in-app', expect.objectContaining({
      source: 'test-source',
      fromPlan: 'professional',
      toPlan: SubscriptionPlan.Starter,
    }));
    expect(shipAnalyticsLog).toHaveBeenCalledWith('paid_plan.renewal_downgrade.success', {
      source: 'test-source',
      productId: expect.any(String),
      plan: SubscriptionPlan.Starter,
    });

    expect(logImpressionEvent).toHaveBeenCalledWith('plan.purchase_starter.success');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('plan.purchase_starter.in-app', expect.objectContaining({
      source: 'test-source',
      productId: expect.any(String),
      fromPlan: 'professional',
      toPlan: SubscriptionPlan.Starter,
    }));
    // Should NOT call handlePurchaseSuccess for renewal of downgrade - no polling needed
    expect(mockHandlePurchaseSuccess).not.toHaveBeenCalled();
  });
});
