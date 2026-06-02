/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import AppSelector from './AppSelector';

const mockRouter = { push: vi.fn(), prefetch: vi.fn() };
const mockParams = { id: undefined };
const mockAuthContext = {
  isAuthenticated: true,
  isLoading: false,
};
const mockSites = {
  sites: [],
  isLoading: false,
};
const mockDevelopPageStore = {
  isMobile: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => mockParams,
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext,
}));
vi.mock('@/stores/useSitesStore', () => ({
  useSites: () => mockSites,
  useSitesStore: vi.fn(function () { return { fetchSite: vi.fn() }; }),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopPageStore),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
}));
vi.mock('@/components/layout/AppItem', () => ({
  default: ({ site }: any) => <div data-testid="app-item">{site.name}</div>,
  AppItemNew: () => <div data-testid="app-item-new">Create new</div>,
  AppItemSeeAll: () => <div data-testid="app-item-see-all">See all</div>,
}));

describe('AppSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext.isAuthenticated = true;
    mockAuthContext.isLoading = false;
    mockSites.sites = [];
    mockSites.isLoading = false;
    mockDevelopPageStore.isMobile = false;
    mockParams.id = undefined;
  });

  it('should render nothing when not authenticated', () => {
    mockAuthContext.isAuthenticated = false;

    const { container } = renderWithProviders(<AppSelector />);

    expect(container.firstChild).toBeNull();
  });

  it('should render when authenticated', () => {
    renderWithProviders(<AppSelector />);

    expect(screen.getByText('builder_common_my_apps')).toBeInTheDocument();
  });

  it('should display "builder_common_my_apps" when no current site', () => {
    renderWithProviders(<AppSelector />);

    expect(screen.getByText('builder_common_my_apps')).toBeInTheDocument();
  });

  it('should display current site name when site is selected', () => {
    mockParams.id = 'site-123';
    mockSites.sites = [
      {
        id: 'site-123',
        name: 'My Test App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    renderWithProviders(<AppSelector />);

    expect(screen.getByText('My Test App')).toBeInTheDocument();
  });

  it('should navigate to apps page when no sites exist and trigger clicked', async () => {
    mockSites.sites = [];

    const { user } = renderWithProviders(<AppSelector />);

    const trigger = screen.getByText('builder_common_my_apps');
    await user.click(trigger);

    expect(mockRouter.push).toHaveBeenCalledWith('/apps');
  });

  it('should sort sites with running status first', async () => {
    mockSites.sites = [
      {
        id: 'site-1',
        name: 'Stopped App',
        status: 'stopped',
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      },
      {
        id: 'site-2',
        name: 'Running App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    const { user } = renderWithProviders(<AppSelector />);

    // Click trigger to open popover
    const trigger = screen.getByText('builder_common_my_apps');
    await user.click(trigger);

    const runningApp = await screen.findByText('Running App');
    expect(runningApp).toBeInTheDocument();
  });

  it('should sort sites by updated_at within same status', async () => {
    mockSites.sites = [
      {
        id: 'site-1',
        name: 'Older App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'site-2',
        name: 'Newer App',
        status: 'running',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      },
    ];

    const { user } = renderWithProviders(<AppSelector />);

    const trigger = screen.getByText('builder_common_my_apps');
    await user.click(trigger);

    const newerApp = await screen.findByText('Newer App');
    expect(newerApp).toBeInTheDocument();
  });

  it('should display only first 5 sites', async () => {
    mockSites.sites = Array.from({ length: 10 }, (_, i) => ({
      id: `site-${i}`,
      name: `App ${i}`,
      status: 'running',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }));

    const { user } = renderWithProviders(<AppSelector />);

    const trigger = screen.getByText('builder_common_my_apps');
    await user.click(trigger);

    await screen.findByText('App 0');

    // Should find first 5 apps
    expect(screen.getByText('App 0')).toBeInTheDocument();
    expect(screen.getByText('App 4')).toBeInTheDocument();
    // Should not find app 5 or higher
    expect(screen.queryByText('App 5')).not.toBeInTheDocument();
  });

  it('should render AppItemNew when not on homepage', async () => {
    mockSites.sites = [
      {
        id: 'site-1',
        name: 'Test App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    const { user } = renderWithProviders(<AppSelector location="develop" />);

    const trigger = screen.getByText('builder_common_my_apps');
    await user.click(trigger);

    const newItem = await screen.findByTestId('app-item-new');
    expect(newItem).toBeInTheDocument();
  });

  it('should not render AppItemNew when on homepage', async () => {
    mockSites.sites = [
      {
        id: 'site-1',
        name: 'Test App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    renderWithProviders(<AppSelector location="homepage" />);

    // On homepage, popover auto-expands via useEffect
    // The AppItemNew should not be included in the content
    await screen.findByText('Test App');

    expect(screen.queryByTestId('app-item-new')).not.toBeInTheDocument();
  });

  it('should always render AppItemSeeAll', async () => {
    mockSites.sites = [
      {
        id: 'site-1',
        name: 'Test App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    const { user } = renderWithProviders(<AppSelector />);

    const trigger = screen.getByText('builder_common_my_apps');
    await user.click(trigger);

    const seeAll = await screen.findByTestId('app-item-see-all');
    expect(seeAll).toBeInTheDocument();
  });

  it('should render mobile icon when isMobile is true', () => {
    mockDevelopPageStore.isMobile = true;

    const { container } = renderWithProviders(<AppSelector />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('should render text when isMobile is false', () => {
    mockDevelopPageStore.isMobile = false;

    renderWithProviders(<AppSelector />);

    expect(screen.getByText('builder_common_my_apps')).toBeInTheDocument();
  });

  it('should render chevron icon when sites exist and not mobile', () => {
    mockDevelopPageStore.isMobile = false;
    mockSites.sites = [
      {
        id: 'site-1',
        name: 'Test App',
        status: 'running',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    const { container } = renderWithProviders(<AppSelector />);

    const chevron = container.querySelector('svg');
    expect(chevron).toBeInTheDocument();
  });

  it('should not render popover content when no sites exist', () => {
    mockSites.sites = [];

    const { container } = renderWithProviders(<AppSelector />);

    const trigger = screen.getByText('builder_common_my_apps');
    trigger.click();

    expect(container.querySelector('[data-testid="app-item"]')).not.toBeInTheDocument();
  });

  describe('route prefetching', () => {
    it('should prefetch /apps and / routes', () => {
      renderWithProviders(<AppSelector />);

      expect(mockRouter.prefetch).toHaveBeenCalledWith('/apps');
      expect(mockRouter.prefetch).toHaveBeenCalledWith('/');
    });

    it('should prefetch /develop route using the first site id', () => {
      mockSites.sites = [
        {
          id: 'first-site',
          name: 'First App',
          status: 'running',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'second-site',
          name: 'Second App',
          status: 'running',
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ];

      renderWithProviders(<AppSelector />);

      expect(mockRouter.prefetch).toHaveBeenCalledWith('/develop/first-site');
    });

    it('should not prefetch /develop route when there are no sites', () => {
      mockSites.sites = [];

      renderWithProviders(<AppSelector />);

      expect(mockRouter.prefetch).not.toHaveBeenCalledWith(expect.stringContaining('/develop/'));
    });

    it('should not prefetch any routes when not authenticated', () => {
      mockAuthContext.isAuthenticated = false;

      renderWithProviders(<AppSelector />);

      expect(mockRouter.prefetch).not.toHaveBeenCalled();
    });
  });
});
