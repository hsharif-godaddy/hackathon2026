import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
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

import { SubscriptionPlan } from '@/types/credits';
import AppsAndSitesCard from './AppsAndSitesCard';

const createMockSite = (overrides: Partial<SiteInfo> = {}): SiteInfo => ({
  id: 'site-123',
  name: 'Test App',
  status: 'running',
  account_id: 'account-123',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
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
    vi.clearAllMocks();
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
      renderWithProviders(<AppsAndSitesCard sites={[unpublishedSite]} />);
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

    it('should open unpublish modal when Unpublish is clicked', function opensModal() {
      const publishedSite = createMockSite({
        name: 'Published App',
        variants: ['preview', 'publish'],
      });
      renderWithProviders(<AppsAndSitesCard sites={[publishedSite]} />);
      // Card starts expanded by default
      fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
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
      expect(screen.queryByText('Test App')).not.toBeInTheDocument();
    });

    it('should expand when header is clicked again after collapsing', function expandsOnClick() {
      const site = createMockSite({ name: 'Test App', variants: ['preview'] });
      renderWithProviders(<AppsAndSitesCard sites={[site]} />);

      // Collapse first
      collapseCard();
      expect(screen.queryByText('Test App')).not.toBeInTheDocument();

      // Expand - after collapsing, the button label is now "Expand"
      const expandButton = screen.getByRole('button', { name: /Expand/i });
      fireEvent.click(expandButton);
      expect(screen.getByText('Test App')).toBeInTheDocument();
    });
  });
});
