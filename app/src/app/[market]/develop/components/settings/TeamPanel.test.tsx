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

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: false, isLoading: false })),
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

async function setPaywall(showPaywall: boolean, isLoading = false) {
  const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
  vi.mocked(usePaywallEligibility).mockReturnValue({
    showPaywall,
    isLoading,
    isError: false,
    error: null,
  });
}

describe('TeamPanel', function teamPanelTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('shows the skeleton while paywall eligibility is loading', async function paywallLoading() {
    await setPaywall(false, true);
    renderWithProviders(<TeamPanel />);
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
  });

  it('shows the upgrade paywall (not the invite bundle) for a free-tier owner', async function freeOwner() {
    await setPaywall(true);
    await setSite({ owner_customer_id: 'cust-1' }); // no team_venture_id
    renderWithProviders(<TeamPanel />);

    expect(screen.getByText('builder_upgrade_paid_plan_title')).toBeInTheDocument();
    expect(screen.getByText('builder_common_tooltip_upgrade')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_upgrade_button' })).toBeInTheDocument();
    // The invite UI must NOT render for a paywalled owner.
    expect(screen.queryByTestId('multiusers-bundle')).not.toBeInTheDocument();
  });

  it('opens the upgrade modal with the share-access source on click', async function clickUpgrade() {
    await setPaywall(true);
    await setSite({ owner_customer_id: 'cust-1' });
    const { user } = renderWithProviders(<TeamPanel />);

    await user.click(screen.getByRole('button', { name: 'builder_upgrade_button' }));
    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('share-access.upgrade', PAYWALL_ITC.UPGRADE);
  });

  it('renders the invite bundle (not the paywall) for a paid owner with a venture', async function paidOwner() {
    await setPaywall(false);
    await setSite({ team_venture_id: 'venture-1', owner_customer_id: 'cust-1' });
    renderWithProviders(<TeamPanel />);

    expect(screen.getByTestId('multiusers-bundle')).toBeInTheDocument();
    expect(screen.queryByText('builder_upgrade_paid_plan_title')).not.toBeInTheDocument();
  });
});
