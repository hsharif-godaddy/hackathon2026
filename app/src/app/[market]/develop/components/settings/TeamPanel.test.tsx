/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import TeamPanel from './TeamPanel';

const mockOpenUpgradeModal = vi.fn();

// next/navigation params (market + app id)
vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ market: 'en-US', id: 'test-app-123' })),
}));

// The multiusersEsm invite bundle — stub so we can assert it renders (paid) or
// not (free, paywalled) without loading the real CDS component.
vi.mock('@/app/[market]/develop/components/paywall/cdsLoader', () => ({
  ComponentLoader: () => <div data-testid="multiusers-bundle" />,
}));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ getUserInfo: () => ({ customerId: 'cust-1' }) })),
}));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: vi.fn(() => ({ cds: {}, intl: { locale: 'en-US' } })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({ data: { status: 'active', plan: 'professional' }, isLoading: false })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
}));

vi.mock('@/lib/mgmt-airo/trigger-collaborator-reconcile', () => ({
  startReconcilePolling: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: any) => selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector) =>
    selector({ getSite: () => null, loading: {}, fetchSite: vi.fn() }),
  ),
}));

vi.mock('@/utils/getRootDomain', () => ({ getRootDomain: vi.fn(() => 'godaddy.com') }));

vi.mock('@/utils/instrumentation', () => mockInstrumentation());

async function setSite(site: Record<string, unknown> | null, loading = false) {
  const { useSiteStore } = await import('@/stores/useSiteStore');
  vi.mocked(useSiteStore).mockImplementation((selector: any) =>
    selector({ getSite: () => site, loading: { 'test-app-123': loading }, fetchSite: vi.fn() }),
  );
}

async function setSubscription(plan: string | null, isLoading = false) {
  const { useSubscription } = await import('@/hooks/useSubscription');
  vi.mocked(useSubscription).mockReturnValue({
    data: plan ? { status: 'active', plan } : undefined,
    subscriptions: [],
    isLoading,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as any);
}

describe('TeamPanel', function teamPanelTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('shows the skeleton while subscription is loading', async function subscriptionLoading() {
    await setSubscription(null, true);
    renderWithProviders(<TeamPanel />);
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
  });

  it('shows the upgrade paywall for a free-tier owner', async function freeOwner() {
    await setSubscription(null);
    await setSite({ owner_customer_id: 'cust-1' }); // no team_venture_id
    renderWithProviders(<TeamPanel />);

    expect(screen.getByText('builder_upgrade_paid_plan_title')).toBeInTheDocument();
    expect(screen.getByText('builder_common_tooltip_upgrade')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_upgrade_button' })).toBeInTheDocument();
    expect(screen.queryByTestId('multiusers-bundle')).not.toBeInTheDocument();
  });

  it('shows the upgrade paywall for a Starter-tier owner', async function starterOwner() {
    await setSubscription('starter');
    await setSite({ owner_customer_id: 'cust-1' });
    renderWithProviders(<TeamPanel />);

    expect(screen.getByText('builder_upgrade_paid_plan_title')).toBeInTheDocument();
    expect(screen.queryByTestId('multiusers-bundle')).not.toBeInTheDocument();
  });

  it('opens the upgrade modal with the share-access source on click', async function clickUpgrade() {
    await setSubscription(null);
    await setSite({ owner_customer_id: 'cust-1' });
    const { user } = renderWithProviders(<TeamPanel />);

    await user.click(screen.getByRole('button', { name: 'builder_upgrade_button' }));
    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('share-access.upgrade', PAYWALL_ITC.UPGRADE);
  });

  it('renders the invite bundle (not the paywall) for a Professional owner with a venture', async function paidOwner() {
    await setSubscription('professional');
    await setSite({ team_venture_id: 'venture-1', owner_customer_id: 'cust-1' });
    renderWithProviders(<TeamPanel />);

    expect(screen.getByTestId('multiusers-bundle')).toBeInTheDocument();
    expect(screen.queryByText('builder_upgrade_paid_plan_title')).not.toBeInTheDocument();
  });

  it('renders the invite bundle for an Ultimate owner with a venture', async function ultimateOwner() {
    await setSubscription('ultimate');
    await setSite({ team_venture_id: 'venture-1', owner_customer_id: 'cust-1' });
    renderWithProviders(<TeamPanel />);

    expect(screen.getByTestId('multiusers-bundle')).toBeInTheDocument();
    expect(screen.queryByText('builder_upgrade_paid_plan_title')).not.toBeInTheDocument();
  });

  it('renders the invite bundle for an enterprise owner (aab-ent-v1, no plan field)', async function enterpriseOwner() {
    const { useSubscription } = await import('@/hooks/useSubscription');
    vi.mocked(useSubscription).mockReturnValue({
      data: { status: 'active', productId: 'aab-ent-v1', isTrial: false } as any,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    await setSite({ team_venture_id: 'venture-1', owner_customer_id: 'cust-1' });
    renderWithProviders(<TeamPanel />);

    expect(screen.getByTestId('multiusers-bundle')).toBeInTheDocument();
    expect(screen.queryByText('builder_upgrade_paid_plan_title')).not.toBeInTheDocument();
  });
});
