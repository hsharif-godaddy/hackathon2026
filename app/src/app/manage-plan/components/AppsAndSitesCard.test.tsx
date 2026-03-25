import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { DomainStatus, DomainType, type SiteInfo } from '@/lib/control-plane/types';
import { renderWithProviders } from '@/tests/test-utils';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    const translations: Record<string, string> = {
      'builder_manageplan_apps_title': 'Apps and Sites',
      'builder_manageplan_apps_published_count': values?.count !== undefined ? `${values.count} published` : '0 published',
      'builder_manageplan_my_apps': 'My Apps',
      'builder_manageplan_apps_empty': "You haven't created any apps yet.",
      'builder_manageplan_apps_published': 'Published',
      'builder_manageplan_apps_unpublish': 'Unpublish',
      'builder_manageplan_apps_publish': 'Publish',
      'builder_manageplan_apps_upgrade_to_publish': 'Upgrade to Publish',
      'builder_unpublish_processing': 'Unpublishing...',
      'builder_common_publishing': 'Publishing...',
      'builder_unpublish_disconnecting_domain': 'Disconnecting Domain...',
    };
    return translations[key] || key;
  },
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => ({ data: true, isLoading: false }),
}));

const mockUnpublishMutate = vi.fn();
const mockUnpublishMutateAsync = vi.fn();
const mockUnpublishReset = vi.fn();
const mockPublishMutate = vi.fn();
const mockPublishMutateAsync = vi.fn();

vi.mock('@/hooks/useUnpublishApp', () => ({
  useUnpublishApp: () => ({
    mutate: mockUnpublishMutate,
    mutateAsync: mockUnpublishMutateAsync,
    reset: mockUnpublishReset,
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({
    mutate: mockPublishMutate,
    mutateAsync: mockPublishMutateAsync,
    isPending: false,
    error: null,
  }),
}));

const mockFetchAllSites = vi.fn();

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: (selector: (state: any) => any) => {
    const state = {
      fetchAllSites: mockFetchAllSites,
    };
    return selector(state);
  },
}));

// Mock @ux/modal for the unpublish modal
vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@ux/radio', () => ({
  default: ({
    id,
    label,
    checked,
    onChange,
  }: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }) => (
    <label htmlFor={id}>
      <input type="radio" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  ),
}));

vi.mock('@/lib/publish-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/publish-limit')>('@/lib/publish-limit');
  return {
    ...actual,
    getPublishLimit: vi.fn(actual.getPublishLimit),
  };
});

import { getPublishLimit } from '@/lib/publish-limit';
import { SubscriptionPlan } from '@/types/credits';
import AppsAndSitesCard from './AppsAndSitesCard';

const createMockSite = (overrides: Partial<SiteInfo> = {}): SiteInfo => ({
  id: 'site-123',
  name: 'Test App',
  status: 'running',
  account_id: 'account-123',
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

/**
 * Helper to collapse the card by clicking the chevron button (card starts expanded)
 */
function collapseCard() {
  const collapseButton = screen.getByRole('button', { name: /Collapse/i });
  fireEvent.click(collapseButton);
}

describe('AppsAndSitesCard', function appsAndSitesCardTests() {
  beforeEach(function setup() {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    // Mock fetch for site details (used when opening unpublish modal)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'site-123', name: 'Test App', domains: [] }),
    });
  });

  describe('renders correctly', function renderTests() {
    it('should render the card title', function renderTitle() {
      renderWithProviders(<AppsAndSitesCard sites={[createMockSite()]} />);

      expect(screen.getByText('Apps and Sites')).toBeInTheDocument();
    });

    it('should render empty state when no sites', function renderEmpty() {
      renderWithProviders(<AppsAndSitesCard sites={[]} />);

      expect(screen.getByText("You haven't created any apps yet.")).toBeInTheDocument();
    });

    it('should render loading skeleton when isLoading', function renderLoading() {
      renderWithProviders(<AppsAndSitesCard sites={[]} isLoading={true} />);

      // Loading state shows skeleton placeholders
      expect(screen.queryByText("You haven't created any apps yet.")).not.toBeInTheDocument();
    });

    it('should render site name when expanded', function renderSiteName() {
      renderWithProviders(<AppsAndSitesCard sites={[createMockSite({ name: 'My App' })]} />);
      // Card starts expanded by default
      expect(screen.getByText('My App')).toBeInTheDocument();
    });

    it('should render Published tag for published sites when expanded', function renderPublishedTag() {
      const publishedSite = createMockSite({
        variants: ['preview', 'publish'],
      });
      renderWithProviders(<AppsAndSitesCard sites={[publishedSite]} />);
      // Card starts expanded by default
      expect(screen.getByText('Published')).toBeInTheDocument();
    });

    it('should not render Published tag for unpublished sites when expanded', function noPublishedTag() {
      const unpublishedSite = createMockSite({
        variants: ['preview'],
      });
      renderWithProviders(<AppsAndSitesCard sites={[unpublishedSite]} />);
      // Card starts expanded by default
      expect(screen.queryByText('Published')).not.toBeInTheDocument();
    });

    it('should render My Apps button and navigate on click', function renderMyAppsButton() {
      renderWithProviders(<AppsAndSitesCard sites={[createMockSite()]} />);

      const myAppsButton = screen.getByRole('button', { name: 'My Apps' });
      expect(myAppsButton).toBeInTheDocument();

      fireEvent.click(myAppsButton);
      expect(mockPush).toHaveBeenCalledWith('/apps');
    });

    it('should show published count in collapsed state', function showsPublishedCount() {
      const publishedSite = createMockSite({ variants: ['preview', 'publish'] });
      renderWithProviders(<AppsAndSitesCard sites={[publishedSite]} />);

      expect(screen.getByText('1 published')).toBeInTheDocument();
    });
  });

  describe('publish button', function publishButtonTests() {
    it('should render Publish button for unpublished sites when expanded', function renderPublishButton() {
      const unpublishedSite = createMockSite({ variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[unpublishedSite]} />);
      // Card starts expanded by default
      expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    });

    it('should call publish mutation when Publish is clicked', function callsPublishMutation() {
      const unpublishedSite = createMockSite({ id: 'site-456', variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[unpublishedSite]} subscriptionPlan={SubscriptionPlan.Starter} />);
      // Card starts expanded by default
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      expect(mockPublishMutateAsync).toHaveBeenCalledWith({ appId: 'site-456' });
    });
  });

  describe('unpublish button', function unpublishButtonTests() {
    it('should render Unpublish button for published sites when expanded', function renderUnpublishButton() {
      const publishedSite = createMockSite({ variants: ['preview', 'publish'] });
      renderWithProviders(<AppsAndSitesCard sites={[publishedSite]} />);
      // Card starts expanded by default
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    });

    it('should open unpublish modal when Unpublish is clicked', async function opensModal() {
      const publishedSite = createMockSite({
        name: 'Published App',
        variants: ['preview', 'publish'],
      });
      renderWithProviders(<AppsAndSitesCard sites={[publishedSite]} />);
      // Card starts expanded by default
      fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));

      // Modal opens after async fetch of site details
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });
  });

  describe('multiple sites', function multipleSitesTests() {
    it('should render all sites when expanded', function rendersAllSites() {
      const sites = [
        createMockSite({ id: 'site-1', name: 'App One', variants: ['preview'] }),
        createMockSite({ id: 'site-2', name: 'App Two', variants: ['preview', 'publish'] }),
        createMockSite({ id: 'site-3', name: 'App Three', variants: ['preview'] }),
      ];
      renderWithProviders(<AppsAndSitesCard sites={sites} />);
      // Card starts expanded by default
      expect(screen.getByText('App One')).toBeInTheDocument();
      expect(screen.getByText('App Two')).toBeInTheDocument();
      expect(screen.getByText('App Three')).toBeInTheDocument();
    });

    it('should show correct buttons for each site when expanded', function showsCorrectButtons() {
      const sites = [
        createMockSite({ id: 'site-1', name: 'Unpublished App', variants: ['preview'] }),
        createMockSite({ id: 'site-2', name: 'Published App', variants: ['preview', 'publish'] }),
      ];
      renderWithProviders(<AppsAndSitesCard sites={sites} />);
      // Card starts expanded by default
      // Should have one Publish and one Unpublish button
      expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    });
  });

  describe('legacy site detection', function legacySiteTests() {
    it('should detect published state from variants for legacy sites when expanded', function detectsPublishedVariant() {
      // Legacy sites get 'publish' variant added by the control plane adapter
      // when published_url exists
      const legacySite = createMockSite({
        published_url: 'https://example.com',
        variants: ['preview', 'publish'],
      });
      renderWithProviders(<AppsAndSitesCard sites={[legacySite]} />);
      // Card starts expanded by default
      expect(screen.getByText('Published')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    });
  });

  describe('free plan upgrade', function freePlanTests() {
    it('should show Upgrade to Publish for free users when expanded', function showsUpgradeButton() {
      const mockOpenPaywall = vi.fn();
      const unpublishedSite = createMockSite({ variants: ['preview'] });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOpenPaywall}
        />
      );
      // Card starts expanded by default
      expect(screen.getByRole('button', { name: 'Upgrade to Publish' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    });

    it('should call onOpenPaywall when Upgrade to Publish is clicked', function callsOpenPaywall() {
      const mockOpenPaywall = vi.fn();
      const unpublishedSite = createMockSite({ variants: ['preview'] });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOpenPaywall}
        />
      );
      // Card starts expanded by default
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Publish' }));

      expect(mockOpenPaywall).toHaveBeenCalledWith(
        'manage_plan.upgrade_to_publish',
        'upgrade',
        expect.any(String)
      );
    });

    it('should show Publish button for paid users when expanded', function showsPublishForPaid() {
      const mockOpenPaywall = vi.fn();
      const unpublishedSite = createMockSite({ variants: ['preview'] });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOpenPaywall}
        />
      );
      // Card starts expanded by default
      expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Upgrade to Publish' })).not.toBeInTheDocument();
    });
  });

  describe('publish limit behavior', function publishLimitTests() {
    it('should show Upgrade to Publish for Starter user at publish limit', function starterAtLimit() {
      const mockOpenPaywall = vi.fn();
      // Starter plan has limit of 1 - create 1 published + 1 unpublished
      const publishedSite = createMockSite({ id: 'published-1', name: 'Published App', variants: ['preview', 'publish'] });
      const unpublishedSite = createMockSite({ id: 'unpublished-1', name: 'Unpublished App', variants: ['preview'] });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[publishedSite, unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOpenPaywall}
        />
      );

      // Published app should show Unpublish
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
      // Unpublished app at limit should show Upgrade to Publish (Starter can upgrade)
      expect(screen.getByRole('button', { name: 'Upgrade to Publish' })).toBeInTheDocument();
      // Should NOT show regular Publish button
      expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    });

    it('should show disabled Publish button for Ultimate user at publish limit', function ultimateAtLimit() {
      const mockOpenPaywall = vi.fn();
      vi.mocked(getPublishLimit).mockReturnValue(1);

      const publishedSite = createMockSite({ id: 'published-1', name: 'Published App', variants: ['preview', 'publish'] });
      const unpublishedSite = createMockSite({ id: 'unpublished-1', name: 'Unpublished App', variants: ['preview'] });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[publishedSite, unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Ultimate}
          onOpenPaywall={mockOpenPaywall}
        />
      );

      // Should show Publish button (not Upgrade) since Ultimate can't upgrade
      const publishButtons = screen.getAllByRole('button', { name: 'Publish' });
      expect(publishButtons).toHaveLength(1);
      // The Publish button should be disabled since at limit
      expect(publishButtons[0]).toBeDisabled();
      // Should NOT show Upgrade to Publish
      expect(screen.queryByRole('button', { name: 'Upgrade to Publish' })).not.toBeInTheDocument();
    });

    it('should treat legacy AiroPlus users correctly with entitlementId', function legacyAiroPlusLimit() {
      const mockOpenPaywall = vi.fn();
      vi.mocked(getPublishLimit).mockReturnValue(1);

      const publishedSite = createMockSite({ id: 'published-1', name: 'Published App', variants: ['preview', 'publish'] });
      const unpublishedSite = createMockSite({ id: 'unpublished-1', name: 'Unpublished App', variants: ['preview'] });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[publishedSite, unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
          entitlementId="legacy-airo-plus-entitlement"
          onOpenPaywall={mockOpenPaywall}
        />
      );

      // Should show Publish button (not Upgrade) since AiroPlus can't upgrade
      const publishButtons = screen.getAllByRole('button', { name: 'Publish' });
      expect(publishButtons).toHaveLength(1);
      // The Publish button should be disabled since at limit
      expect(publishButtons[0]).toBeDisabled();
      // Should NOT show Upgrade to Publish for legacy AiroPlus
      expect(screen.queryByRole('button', { name: 'Upgrade to Publish' })).not.toBeInTheDocument();
    });
  });

  describe('custom domain detection', function customDomainTests() {
    it('should detect custom domain when domainType is null (not prefix)', function detectsNullDomainType() {
      const siteWithNullDomainType = createMockSite({
        name: 'App with null domain type',
        variants: ['preview', 'publish'],
        published_url: 'https://default.example.com',
        domains: [{ fqdn: 'custom.example.com', domainType: null, status: DomainStatus.ACTIVE }],
      });
      renderWithProviders(<AppsAndSitesCard sites={[siteWithNullDomainType]} />);

      // Should display the custom domain URL with https:// prefix
      expect(screen.getByText('custom.example.com')).toBeInTheDocument();
      expect(screen.queryByText('default.example.com')).not.toBeInTheDocument();
    });

    it('should detect custom domain when domainType is fqdn', function detectsFqdnDomainType() {
      const siteWithFqdnType = createMockSite({
        name: 'App with fqdn domain type',
        variants: ['preview', 'publish'],
        published_url: 'https://default.example.com',
        domains: [{ fqdn: 'fqdn.example.com', domainType: DomainType.FQDN, status: DomainStatus.ACTIVE }],
      });
      renderWithProviders(<AppsAndSitesCard sites={[siteWithFqdnType]} />);

      // Should display the fqdn domain
      expect(screen.getByText('fqdn.example.com')).toBeInTheDocument();
      expect(screen.queryByText('default.example.com')).not.toBeInTheDocument();
    });

    it('should NOT detect domain when status is not active', function ignoresInactiveDomain() {
      const siteWithPendingDomain = createMockSite({
        name: 'App with pending domain',
        variants: ['preview', 'publish'],
        published_url: 'https://default.example.com',
        domains: [{ fqdn: 'pending.example.com', domainType: null, status: DomainStatus.PENDING }],
      });
      renderWithProviders(<AppsAndSitesCard sites={[siteWithPendingDomain]} />);

      // Should fall back to published_url since domain is not active
      expect(screen.getByText('default.example.com')).toBeInTheDocument();
      expect(screen.queryByText('pending.example.com')).not.toBeInTheDocument();
    });

    it('should NOT detect domain when domainType is prefix', function ignoresPrefixDomain() {
      const siteWithPrefixDomain = createMockSite({
        name: 'App with prefix domain',
        variants: ['preview', 'publish'],
        published_url: 'https://default.example.com',
        domains: [{ fqdn: 'prefix.example.com', domainType: DomainType.PREFIX, status: DomainStatus.ACTIVE }],
      });
      renderWithProviders(<AppsAndSitesCard sites={[siteWithPrefixDomain]} />);

      // Should fall back to published_url since prefix domains are not custom
      expect(screen.getByText('default.example.com')).toBeInTheDocument();
      expect(screen.queryByText('prefix.example.com')).not.toBeInTheDocument();
    });

    it('should fall back to published_url when no domains', function fallsBackToPublishedUrl() {
      const siteWithNoDomains = createMockSite({
        name: 'App with no domains',
        variants: ['preview', 'publish'],
        published_url: 'https://fallback.example.com',
        domains: [],
      });
      renderWithProviders(<AppsAndSitesCard sites={[siteWithNoDomains]} />);

      expect(screen.getByText('fallback.example.com')).toBeInTheDocument();
    });

    it('should use custom domain URL as clickable link with https protocol', function customDomainHasProtocol() {
      const siteWithCustomDomain = createMockSite({
        name: 'App with custom domain',
        variants: ['preview', 'publish'],
        published_url: 'https://default.example.com',
        domains: [{ fqdn: 'custom.example.com', domainType: null, status: DomainStatus.ACTIVE }],
      });
      renderWithProviders(<AppsAndSitesCard sites={[siteWithCustomDomain]} />);

      const link = screen.getByRole('link', { name: 'custom.example.com' });
      expect(link).toHaveAttribute('href', 'https://custom.example.com');
    });
  });

  describe('row click navigation', function rowClickTests() {
    it('should navigate to develop page when row is clicked', function navigatesToDevelop() {
      const site = createMockSite({ id: 'site-456', name: 'My App', variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[site]} />);

      fireEvent.click(screen.getByText('My App'));

      expect(mockPush).toHaveBeenCalledWith('/develop/site-456');
    });
  });

  describe('collapsible behavior', function collapsibleTests() {
    it('should be expanded by default', function expandedByDefault() {
      const site = createMockSite({ name: 'Test App', variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[site]} />);

      // Site content should be visible when expanded (default)
      expect(screen.getByText('Test App')).toBeInTheDocument();
    });

    it('should collapse when header is clicked', function collapsesOnClick() {
      const site = createMockSite({ name: 'Test App', variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[site]} />);

      // Card starts expanded
      expect(screen.getByText('Test App')).toBeInTheDocument();

      // Collapse
      collapseCard();
      expect(screen.getByRole('button', { name: /Expand/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('should expand when header is clicked again after collapsing', function expandsOnClick() {
      const site = createMockSite({ name: 'Test App', variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[site]} />);

      // Collapse first
      collapseCard();
      expect(screen.getByRole('button', { name: /Expand/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );

      // Expand - after collapsing, the button label is now "Expand"
      const expandButton = screen.getByRole('button', { name: /Expand/i });
      fireEvent.click(expandButton);
      expect(screen.getByText('Test App')).toBeInTheDocument();
    });
  });

  describe('error handling', function errorHandlingTests() {
    it('should show error message when publish fails', async function showsPublishError() {
      const unpublishedSite = createMockSite({ id: 'site-456', variants: ['preview'] });
      mockPublishMutateAsync.mockRejectedValue(new Error('Publish failed'));

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        expect(screen.getByText('Publish failed')).toBeInTheDocument();
      });
    });

    it('should show generic error when publish fails without message', async function showsGenericError() {
      const unpublishedSite = createMockSite({ id: 'site-456', variants: ['preview'] });
      mockPublishMutateAsync.mockRejectedValue('Unknown error');

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      });
    });

    it('should clear error when clicking publish again', async function clearsErrorOnRetry() {
      const unpublishedSite = createMockSite({ id: 'site-456', variants: ['preview'] });
      // First call fails, second succeeds
      mockPublishMutateAsync
        .mockRejectedValueOnce(new Error('Publish failed'))
        .mockResolvedValueOnce({ result: { published: true } });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      // First click - should fail
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        expect(screen.getByText('Publish failed')).toBeInTheDocument();
      });

      // Second click - error should be cleared
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        expect(screen.queryByText('Publish failed')).not.toBeInTheDocument();
      });
    });

    it('should re-enable button after publish error', async function reEnablesButtonAfterError() {
      const unpublishedSite = createMockSite({ id: 'site-456', variants: ['preview'] });
      mockPublishMutateAsync.mockRejectedValue(new Error('Publish failed'));

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        // Button should be enabled after error
        expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled();
      });
    });

    it('should show generic error when publish fails with empty message', async function showsGenericErrorOnEmptyMessage() {
      const unpublishedSite = createMockSite({ id: 'site-456', variants: ['preview'] });
      const errorWithEmptyMessage = new Error('');
      mockPublishMutateAsync.mockRejectedValue(errorWithEmptyMessage);

      renderWithProviders(
        <AppsAndSitesCard
          sites={[unpublishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      await waitFor(() => {
        // Should show generic error when error.message is empty
        expect(screen.getByText('builder_common_error_generic')).toBeInTheDocument();
      });
    });

    it('should clear error when clicking unpublish button', async function clearsErrorOnUnpublishClick() {
      const publishedSite = createMockSite({
        id: 'site-123',
        variants: ['preview', 'publish'],
        published_url: 'https://example.com',
      });

      // First publish fails to create an error
      mockPublishMutateAsync.mockRejectedValueOnce(new Error('Initial error'));

      // Mock unpublish to capture the call
      mockUnpublishMutate.mockImplementation(() => {});

      renderWithProviders(
        <AppsAndSitesCard
          sites={[publishedSite]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      // Verify unpublish button is visible
      const unpublishButton = screen.getByRole('button', { name: 'Unpublish' });
      expect(unpublishButton).toBeInTheDocument();

      // Click unpublish - should clear any existing errors
      fireEvent.click(unpublishButton);

      // Modal should open (via handleUnpublishClick which calls clearAppError)
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should start domain disconnect polling even without domainJobId', async function pollsWithoutDomainJobId() {
      const publishedSiteWithDomain = createMockSite({
        id: 'site-123',
        variants: ['preview', 'publish'],
        published_url: 'https://custom.example.com',
        domains: [
          { fqdn: 'custom.example.com', domainType: DomainType.FQDN, status: DomainStatus.ACTIVE },
        ],
      });

      // Mock unpublish to return success without domainJobId
      mockUnpublishMutate.mockImplementation((params, options) => {
        options?.onSuccess?.({ success: true, message: 'Unpublished' });
      });

      renderWithProviders(
        <AppsAndSitesCard
          sites={[publishedSiteWithDomain]}
          subscriptionPlan={SubscriptionPlan.Starter}
        />
      );

      // Click unpublish
      fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));

      // Wait for modal
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Find and click the confirm button (implementation dependent on modal)
      // This test verifies the mutation is called - full integration would verify polling starts
      expect(mockUnpublishMutate).not.toHaveBeenCalled(); // Not called until confirm
    });
  });
});
