/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { renderWithProviders } from '@/tests/test-utils';
import { DevelopCreditsModal } from './DevelopCreditsModal';

const mockCloseCreditsModal = vi.fn();
const mockShipAnalyticsLog = vi.fn();

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}));

vi.mock('@/hooks/useSubscriptionWithPolling', () => ({
  useSubscriptionWithPolling: vi.fn(() => ({
    subscription: { id: 'sub-123', builderEntitlementId: 'entitlement-123' },
    builderEntitlementId: 'entitlement-123',
    isGrantsEnabled: true,
    isLoading: false,
    isError: false,
    isPurchaseDisabled: false,
    entitlementPollingTimedOut: false,
  })),
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: vi.fn(() => ({
    data: [{ id: 'grant-1' }, { id: 'grant-2' }],
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/hooks/useCreditPurchase', () => ({
  useIsCreditPolling: vi.fn(() => false),
  useCreditPurchase: vi.fn(() => ({
    handlePurchaseSuccess: vi.fn(),
    invalidateQueries: vi.fn(),
  })),
}));

vi.mock('./CreditsUpgradeContainer', () => ({
  default: (props: any) => (
    <div data-testid="credits-upgrade-container">
      <span data-testid="entitlement-id">{props.entitlementId}</span>
      <span data-testid="subscription-id">{props.subscriptionId}</span>
      <span data-testid="initial-grant-count">{props.initialGrantCount}</span>
      <span data-testid="source">{props.source}</span>
      <span data-testid="itc">{props.itc ?? ''}</span>
      <button data-testid="close-button" onClick={props.onClose}>Close</button>
      <button data-testid="success-button" onClick={() => props.onSuccess?.()}>Success</button>
      <button data-testid="error-button" onClick={props.onErrorClick}>Error</button>
    </div>
  ),
}));

vi.mock('./GrantPollingModal', () => ({
  GrantPollingModal: () => <div data-testid="grant-polling-modal">Processing...</div>,
}));

function setCreditsModalState(overrides: Partial<{
  showCreditsModal: boolean;
  creditsModalSource: string | null;
  creditsModalItc: string | null;
}> = {}) {
  useDevelopPageStore.setState({
    showCreditsModal: true,
    creditsModalSource: 'usage_gauge.buy_credits',
    creditsModalItc: null,
    closeCreditsModal: mockCloseCreditsModal,
    ...overrides,
  } as any);
}

describe('DevelopCreditsModal', function developCreditsModalTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    useDevelopPageStore.setState({
      showCreditsModal: false,
      creditsModalSource: null,
      creditsModalItc: null,
      closeCreditsModal: mockCloseCreditsModal,
    } as any);
  });

  describe('renders CreditsUpgradeContainer when conditions are met', function renderTests() {
    it('should render CreditsUpgradeContainer when showCreditsModal is true', async function renderModal() {
      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkModal() {
        expect(screen.getByTestId('credits-upgrade-container')).toBeInTheDocument();
      });
    });

    it('should pass entitlementId from subscription', async function passEntitlementId() {
      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkEntitlementId() {
        expect(screen.getByTestId('entitlement-id').textContent).toBe('entitlement-123');
      });
    });

    it('should pass subscriptionId from subscription', async function passSubscriptionId() {
      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkSubscriptionId() {
        expect(screen.getByTestId('subscription-id').textContent).toBe('sub-123');
      });
    });

    it('should pass initial grant count from grants data', async function passGrantCount() {
      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkGrantCount() {
        expect(screen.getByTestId('initial-grant-count').textContent).toBe('2');
      });
    });

    it('should pass creditsModalSource as source prop', async function passSource() {
      setCreditsModalState({ creditsModalSource: 'usage_gauge.buy_credits' });

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkSource() {
        expect(screen.getByTestId('source').textContent).toBe('usage_gauge.buy_credits');
      });
    });

    it('should pass creditsModalItc as itc prop', async function passItc() {
      setCreditsModalState({ creditsModalItc: 'test-itc-code' });

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkItc() {
        expect(screen.getByTestId('itc').textContent).toBe('test-itc-code');
      });
    });

    it('should pass 0 as initialGrantCount when grants data is empty', async function zeroGrantCount() {
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');
      vi.mocked(useCreditGrants).mockReturnValueOnce({ data: [], isLoading: false, isError: false } as any);

      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkGrantCount() {
        expect(screen.getByTestId('initial-grant-count').textContent).toBe('0');
      });
    });

    it('should pass 0 as initialGrantCount when grants data is undefined', async function undefinedGrantCount() {
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');
      vi.mocked(useCreditGrants).mockReturnValueOnce({ data: undefined, isLoading: false, isError: false } as any);

      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkGrantCount() {
        expect(screen.getByTestId('initial-grant-count').textContent).toBe('0');
      });
    });
  });

  describe('does not render CreditsUpgradeContainer when conditions are not met', function noRenderTests() {
    it('should not render when showCreditsModal is false', async function noModal() {
      useDevelopPageStore.setState({
        showCreditsModal: false,
        creditsModalSource: null,
        creditsModalItc: null,
        closeCreditsModal: mockCloseCreditsModal,
      } as any);

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkNoModal() {
        expect(screen.queryByTestId('credits-upgrade-container')).not.toBeInTheDocument();
      });
    });

    it('should not render when isGrantsEnabled is false', async function noGrantsEnabled() {
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');
      vi.mocked(useSubscriptionWithPolling).mockReturnValueOnce({
        subscription: { id: 'sub-123', builderEntitlementId: 'entitlement-123' } as any,
        builderEntitlementId: 'entitlement-123',
        isGrantsEnabled: false,
        isLoading: false,
        isError: false,
        isPurchaseDisabled: false,
        entitlementPollingTimedOut: false,
        subscriptions: undefined,
      });

      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkNoModal() {
        expect(screen.queryByTestId('credits-upgrade-container')).not.toBeInTheDocument();
      });
    });

    it('should not render when builderEntitlementId is missing', async function noEntitlementId() {
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');
      vi.mocked(useSubscriptionWithPolling).mockReturnValueOnce({
        subscription: { id: 'sub-123' } as any,
        builderEntitlementId: undefined,
        isGrantsEnabled: true,
        isLoading: false,
        isError: false,
        isPurchaseDisabled: true,
        entitlementPollingTimedOut: false,
        subscriptions: undefined,
      });

      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkNoModal() {
        expect(screen.queryByTestId('credits-upgrade-container')).not.toBeInTheDocument();
      });
    });

    it('should not render when subscription id is missing', async function noSubscriptionId() {
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');
      vi.mocked(useSubscriptionWithPolling).mockReturnValueOnce({
        subscription: undefined,
        builderEntitlementId: 'entitlement-123',
        isGrantsEnabled: true,
        isLoading: false,
        isError: false,
        isPurchaseDisabled: false,
        entitlementPollingTimedOut: false,
        subscriptions: undefined,
      });

      setCreditsModalState();

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkNoModal() {
        expect(screen.queryByTestId('credits-upgrade-container')).not.toBeInTheDocument();
      });
    });
  });

  describe('callbacks', function callbackTests() {
    it('should call closeCreditsModal when onClose is triggered', async function closeCallback() {
      setCreditsModalState({ creditsModalSource: 'usage_gauge.buy_credits' });

      const { user } = renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('close-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('close-button'));

      expect(mockCloseCreditsModal).toHaveBeenCalled();
    });

    it('should log dismissed analytics when onClose is triggered', async function closeAnalytics() {
      setCreditsModalState({ creditsModalSource: 'usage_gauge.buy_credits' });

      const { user } = renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('close-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('close-button'));

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('usage_gauge.buy_credits.dismissed', { appId: 'app-123' });
    });

    it('should fall back to "unknown" source in dismissed analytics when source is null', async function fallbackSource() {
      setCreditsModalState({ creditsModalSource: null });

      const { user } = renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('close-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('close-button'));

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('unknown.dismissed', { appId: 'app-123' });
    });

    it('should call closeCreditsModal when onSuccess is triggered', async function successCallback() {
      setCreditsModalState();

      const { user } = renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('success-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('success-button'));

      expect(mockCloseCreditsModal).toHaveBeenCalled();
    });

    it('should call closeCreditsModal when onErrorClick is triggered', async function errorCallback() {
      setCreditsModalState({ creditsModalSource: 'usage_gauge.buy_credits' });

      const { user } = renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('error-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('error-button'));

      expect(mockCloseCreditsModal).toHaveBeenCalled();
    });

    it('should log error analytics when onErrorClick is triggered', async function errorAnalytics() {
      setCreditsModalState({ creditsModalSource: 'budget_exceeded.buy_credits' });

      const { user } = renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function waitForModal() {
        expect(screen.getByTestId('error-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('error-button'));

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('budget_exceeded.buy_credits.error', { appId: 'app-123' });
    });
  });

  describe('GrantPollingModal', function grantPollingModalTests() {
    it('should render GrantPollingModal when credit purchase is polling', async function showPollingModal() {
      const { useIsCreditPolling } = await import('@/hooks/useCreditPurchase');
      vi.mocked(useIsCreditPolling).mockReturnValue(true);

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkPollingModal() {
        expect(screen.getByTestId('grant-polling-modal')).toBeInTheDocument();
      });
    });

    it('should not render GrantPollingModal when not polling', async function noPollingModal() {
      const { useIsCreditPolling } = await import('@/hooks/useCreditPurchase');
      vi.mocked(useIsCreditPolling).mockReturnValue(false);

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkNoPollingModal() {
        expect(screen.queryByTestId('grant-polling-modal')).not.toBeInTheDocument();
      });
    });

    it('should render GrantPollingModal independently of showCreditsModal', async function pollingIndependent() {
      const { useIsCreditPolling } = await import('@/hooks/useCreditPurchase');
      vi.mocked(useIsCreditPolling).mockReturnValue(true);

      // Credits modal is closed but polling is ongoing (post-purchase)
      useDevelopPageStore.setState({
        showCreditsModal: false,
        creditsModalSource: null,
        creditsModalItc: null,
        closeCreditsModal: mockCloseCreditsModal,
      } as any);

      renderWithProviders(<DevelopCreditsModal appId="app-123" />);

      await waitFor(function checkPollingModal() {
        expect(screen.getByTestId('grant-polling-modal')).toBeInTheDocument();
        expect(screen.queryByTestId('credits-upgrade-container')).not.toBeInTheDocument();
      });
    });
  });

  describe('React.memo stability', function memoTests() {
    it('should render correctly with a different appId', async function differentAppId() {
      setCreditsModalState({ creditsModalSource: 'test.source' });

      renderWithProviders(<DevelopCreditsModal appId="different-app-456" />);

      await waitFor(function checkModal() {
        expect(screen.getByTestId('credits-upgrade-container')).toBeInTheDocument();
      });

      await waitFor(function checkSource() {
        expect(screen.getByTestId('source').textContent).toBe('test.source');
      });
    });
  });
});
