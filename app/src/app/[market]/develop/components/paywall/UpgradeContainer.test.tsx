/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { useSubscription } from '@/hooks/useSubscription';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return false; }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(function () { return {
    data: { id: 'sub-123', builderEntitlementId: 'ent-123' },
    subscriptions: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }; }),
}));

vi.mock('./HigherPlansUpgradeContainer', () => ({
  default: (props: { source?: string; onSuccessClick?: () => void }) => (
    <div data-testid="higher-plans-upgrade">
      <span data-testid="higher-plans-source">{props.source ?? ''}</span>
      <button data-testid="success-click-btn" onClick={props.onSuccessClick}>Success</button>
    </div>
  ),
}));

vi.mock('./DirectToPaidContainer', () => ({
  default: (props: { source?: string }) => (
    <div data-testid="direct-to-paid">
      <span data-testid="d2p-source">{props.source ?? ''}</span>
    </div>
  ),
}));

vi.mock('./PaywallLoadingModal', () => ({
  PaywallLoadingModal: ({ onClose, component }: any) => (
    <div data-testid="paywall-loading-modal">
      <span data-testid="loading-component">{component}</span>
      <button data-testid="loading-close" onClick={onClose}>Close</button>
    </div>
  ),
  PaywallLoadingModalVariant: {
    HigherPlans: 'higher-plans',
    Credits: 'credits',
  },
}));

vi.mock('./PaywallErrorModal', () => ({
  PaywallErrorModal: ({ onClose }: any) => (
    <div data-testid="paywall-error-modal">
      <button data-testid="error-close" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('./PaywallSuspendedModal', () => ({
  PaywallSuspendedModal: ({ onClose, builderEntitlementId }: any) => (
    <div data-testid="paywall-suspended-modal" data-entitlement={builderEntitlementId}>
      <button data-testid="suspended-close" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('@/utils/focus', () => ({
  resetFocusOnModalClose: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(function () { return vi.fn(); }),
}));

import { shipAnalyticsLog } from '@/lib/logging';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { logImpressionEvent } from '@/utils/instrumentation';
import UpgradeContainer from './UpgradeContainer';

describe('UpgradeContainer', function upgradeContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    usePaywallStore.setState({ paywallLoading: false });
  });

  it('should render HigherPlansUpgradeContainer', function renderHigherPlans() {
    const { container } = renderWithProviders(
      <UpgradeContainer
        source="test"
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).toBeInTheDocument();
  });

  it('should pass source prop through to HigherPlansUpgradeContainer', function passProps() {
    renderWithProviders(
      <UpgradeContainer
        source="my-source"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('higher-plans-source')).toHaveTextContent('my-source');
  });

  it('logs paywall.upgrade.view on mount via logImpressionEvent and shipAnalyticsLog', function paywallViewOnMount() {
    renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} />
    );

    expect(logImpressionEvent).toHaveBeenCalledWith('paywall.upgrade.view');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.upgrade.view', {});
  });

  describe('DirectToPaid flow', function directToPaidTests() {
    it('should render DirectToPaidContainer when user has no subscription', async function renderD2PNoSubscription() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(
        <UpgradeContainer source="test" onClose={vi.fn()} />
      );

      expect(container.querySelector('[data-testid="direct-to-paid"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="single-plan-upgrade"]')).not.toBeInTheDocument();
    });

    it('should render DirectToPaidContainer when user has subscription but no builderEntitlementId', async function renderD2PNoEntitlement() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123', builderEntitlementId: undefined } as any,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(
        <UpgradeContainer source="test" onClose={vi.fn()} />
      );

      expect(container.querySelector('[data-testid="direct-to-paid"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
    });

    it('should render HigherPlansUpgradeContainer when user has subscription with builderEntitlementId', async function renderUpgradeWithEntitlement() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123', builderEntitlementId: 'ent-123' } as any,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(
        <UpgradeContainer source="test" onClose={vi.fn()} />
      );

      expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="direct-to-paid"]')).not.toBeInTheDocument();
    });

    it('should render loading modal while subscription is loading', async function loadingWhileSubscriptionLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      usePaywallStore.setState({ paywallLoading: true });
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(
        <UpgradeContainer source="test" onClose={vi.fn()} />
      );

      // While loading, should render loading modal to prevent incorrect routing
      expect(container.querySelector('[data-testid="paywall-loading-modal"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="direct-to-paid"]')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
    });

  });

  it('calls onSuccessClick when HigherPlansUpgradeContainer fires success', function callsOnSuccessClick() {
    vi.mocked(useSubscription).mockReturnValue({
      data: { id: 'sub-123', builderEntitlementId: 'ent-123' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSubscription>);

    const onSuccessClick = vi.fn();
    renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} onSuccessClick={onSuccessClick} />
    );

    screen.getByTestId('success-click-btn').click();
    expect(onSuccessClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClose and resetFocusOnModalClose from loading modal close', async function loadingModalClose() {
    const { resetFocusOnModalClose } = await import('@/utils/focus');
    usePaywallStore.setState({ paywallLoading: true });
    vi.mocked(useSubscription).mockReturnValue({
      data: undefined,
      subscriptions: [],
      isLoading: true,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    const onClose = vi.fn();
    renderWithProviders(
      <UpgradeContainer source="test" onClose={onClose} />
    );

    screen.getByTestId('loading-close').click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(resetFocusOnModalClose).toHaveBeenCalled();
  });

  it('clears timeout on unmount when paywallLoading is true', function clearsTimeoutOnUnmount() {
    usePaywallStore.setState({ paywallLoading: true });

    const { unmount } = renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} />
    );

    expect(() => unmount()).not.toThrow();
  });

  it('shows error modal and unmounts CDS containers after 20s timeout', function showsErrorOnTimeout() {
    vi.useFakeTimers();
    usePaywallStore.setState({ paywallLoading: true });

    const { container } = renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} />
    );

    expect(container.querySelector('[data-testid="paywall-loading-modal"]')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(20000); });

    expect(container.querySelector('[data-testid="paywall-error-modal"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="paywall-loading-modal"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="direct-to-paid"]')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  describe('Suspension guard', function suspensionGuardTests() {
    it('renders PaywallSuspendedModal when subscription is suspended and flag is on', async function renderSuspendedModal() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123', builderEntitlementId: 'ent-123', plan: 'free', status: 'suspended', reason: 'NON_PAYMENT' } as any,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(
        <UpgradeContainer source="test" onClose={vi.fn()} />
      );

      const modal = container.querySelector('[data-testid="paywall-suspended-modal"]');
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('data-entitlement', 'ent-123');
      expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="direct-to-paid"]')).not.toBeInTheDocument();
    });

    it('falls through to normal flow when subscription is suspended but flag is off', async function fallThroughWhenFlagOff() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123', builderEntitlementId: 'ent-123', status: 'suspended', reason: 'NON_PAYMENT' } as any,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(
        <UpgradeContainer source="test" onClose={vi.fn()} />
      );

      expect(container.querySelector('[data-testid="paywall-error-modal"]')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).toBeInTheDocument();
    });
  });
});
