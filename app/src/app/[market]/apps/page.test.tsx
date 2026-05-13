/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { APPS_GRID_PAGE_SIZE } from '@/app/[market]/apps/constants';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { SiteStatus } from '@/lib/control-plane/types';
import { useSitesStore } from '@/stores/useSitesStore';
import { createMockSite, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import Sites from './page';

const mockPrefetch = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ ...mockRouter(), prefetch: mockPrefetch }),
}));

vi.mock('@/components/auth', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/layout/Header', () => ({
  default: () => <div>Header</div>,
}));

vi.mock('@/components/layout/AppInactivityAlert', () => ({
  default: () => <div>AppInactivityAlert</div>,
}));

vi.mock('@/app/[market]/apps/components/AcceptTransferDialog', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="accept-transfer-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose, actions }: { title: string; children: React.ReactNode; onClose: () => void; actions?: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
      {children}
      {actions && <div data-testid="modal-actions">{actions}</div>}
    </div>
  ),
}));

vi.mock('@ux/pagination', () => ({
  default: function MockPagination({
    limit,
    offset,
    onChange,
    atStart,
    atEnd,
  }: {
    limit: number;
    offset: number;
    total: number;
    onChange: (nextOffset: number) => void;
    atStart?: boolean;
    atEnd?: boolean;
  }) {
    return (
      <div data-testid="apps-pagination">
        <button
          type="button"
          data-testid="apps-pagination-prev"
          disabled={atStart}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Prev
        </button>
        <button
          type="button"
          data-testid="apps-pagination-next"
          disabled={atEnd}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
    );
  },
}));

vi.mock('@ux/menu', () => ({
  Menu: ({ children }: any) => <div>{children}</div>,
  MenuButton: (props: any) => <button {...props} />,
  MenuItem: ({ children, onClick, ...props }: any) => <button onClick={onClick} {...props}>{children}</button>,
  MenuList: ({ children }: any) => <div>{children}</div>,
  MenuSeparator: () => <hr />,
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => (true)),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    authState: { details: { shopperId: '123456789' } },
  })),
}));

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: vi.fn().mockReturnValue(true),
    developmentMode: vi.fn().mockReturnValue(true),
    devSupervisorTcp: vi.fn().mockReturnValue(false),
  },
  MAX_PROMPT_LENGTH: 40000,
  auth: { enabled: false },
  authUtils: {
    getSupportedAuthTypes: vi.fn(() => ['sso']),
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logActionEvent: vi.fn(() => vi.fn()),
  logErrorEvent: vi.fn(() => vi.fn()),
  generateClickEID: vi.fn((eid: string) => eid),
}));

describe('Sites Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSitesStore.setState({
      allSites: [],
      sitesById: {},
      isLoadingAll: false,
      loadingById: {},
      error: null,
      lastFetchedAll: null,
      refreshSites: vi.fn(),
      stopAllSites: vi.fn(),
      deleteAllSites: vi.fn(),
    });
  });

  describe('renders loading state', () => {
    it('should show spinner when loading', () => {
      useSitesStore.setState({ isLoadingAll: true });

      renderWithProviders(<Sites />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('renders empty state', () => {
    it('should show empty state card when no sites', () => {
      renderWithProviders(<Sites />);

      expect(screen.getByText('builder_apps_empty_create')).toBeInTheDocument();
    });

    it('should hide apps count tag when no sites', () => {
      renderWithProviders(<Sites />);

      expect(screen.queryByText('builder_apps_count')).not.toBeInTheDocument();
    });
  });

  describe('renders sites list', () => {
    it('should display all sites', () => {
      const sites = [
        createMockSite({ id: '1', name: 'App 1' }),
        createMockSite({ id: '2', name: 'App 2' }),
        createMockSite({ id: '3', name: 'App 3' }),
      ];

      useSitesStore.setState({ allSites: sites });

      renderWithProviders(<Sites />);

      expect(screen.getByText('App 1')).toBeInTheDocument();
      expect(screen.getByText('App 2')).toBeInTheDocument();
      expect(screen.getByText('App 3')).toBeInTheDocument();
    });

    it('should show correct total count', () => {
      const sites = [
        createMockSite({ id: '1' }),
        createMockSite({ id: '2' }),
      ];

      useSitesStore.setState({ allSites: sites });

      renderWithProviders(<Sites />);

      expect(screen.getByText('builder_apps_count')).toBeInTheDocument();
    });

    it('should show singular form for 1 app', () => {
      const sites = [createMockSite()];

      useSitesStore.setState({ allSites: sites });

      renderWithProviders(<Sites />);

      expect(screen.getByText('builder_apps_count')).toBeInTheDocument();
    });
  });

  describe('paginates app cards', () => {
    it('should not show pagination when sites fit one page', () => {
      const sites = Array.from({ length: APPS_GRID_PAGE_SIZE }, (_, i) =>
        createMockSite({ id: `site-${i}`, name: `App ${i + 1}` })
      );
      useSitesStore.setState({ allSites: sites });

      renderWithProviders(<Sites />);

      expect(screen.queryByTestId('apps-pagination-next')).not.toBeInTheDocument();
      expect(screen.getByText('App 1')).toBeInTheDocument();
      expect(screen.getByText(`App ${APPS_GRID_PAGE_SIZE}`)).toBeInTheDocument();
    });

    it('should show only the current page of apps and paginate on next', async () => {
      const count = APPS_GRID_PAGE_SIZE + 2;
      const sites = Array.from({ length: count }, (_, i) =>
        createMockSite({ id: `site-${i}`, name: `App ${i + 1}` })
      );
      useSitesStore.setState({ allSites: sites });

      const { user } = renderWithProviders(<Sites />);

      expect(screen.getByTestId('apps-pagination-next')).toBeInTheDocument();
      expect(screen.getByText('App 1')).toBeInTheDocument();
      expect(screen.getByText(`App ${APPS_GRID_PAGE_SIZE}`)).toBeInTheDocument();
      expect(screen.queryByText(`App ${APPS_GRID_PAGE_SIZE + 1}`)).not.toBeInTheDocument();

      await user.click(screen.getByTestId('apps-pagination-next'));

      expect(screen.queryByText('App 1')).not.toBeInTheDocument();
      expect(screen.getByText(`App ${APPS_GRID_PAGE_SIZE + 1}`)).toBeInTheDocument();
      expect(screen.getByText(`App ${count}`)).toBeInTheDocument();

      await user.click(screen.getByTestId('apps-pagination-prev'));

      expect(screen.getByText('App 1')).toBeInTheDocument();
      expect(screen.queryByText(`App ${count}`)).not.toBeInTheDocument();
    });

    it('should clamp to last valid page when sites are deleted while on page 2', async () => {
      const count = APPS_GRID_PAGE_SIZE + 2;
      const sites = Array.from({ length: count }, (_, i) =>
        createMockSite({ id: `site-${i}`, name: `App ${i + 1}` })
      );
      useSitesStore.setState({ allSites: sites });

      const { user } = renderWithProviders(<Sites />);

      await user.click(screen.getByTestId('apps-pagination-next'));
      expect(screen.getByText(`App ${APPS_GRID_PAGE_SIZE + 1}`)).toBeInTheDocument();
      expect(screen.queryByText('App 1')).not.toBeInTheDocument();

      useSitesStore.setState({
        allSites: sites.slice(0, APPS_GRID_PAGE_SIZE),
      });

      await waitFor(() => {
        expect(screen.getByText('App 1')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('apps-pagination-next')).not.toBeInTheDocument();
    });
  });

  describe('renders error state', () => {
    it('should display error message', () => {
      useSitesStore.setState({ error: 'Failed to load sites' });

      renderWithProviders(<Sites />);

      expect(screen.getByText('Failed to load sites')).toBeInTheDocument();
    });

    it('should show try again button', () => {
      useSitesStore.setState({ error: 'Failed to load sites' });

      renderWithProviders(<Sites />);

      expect(screen.getByRole('button', { name: 'builder_common_try_again' })).toBeInTheDocument();
    });
  });

  describe('handles admin actions', () => {
    it('should call stopAllSites when stop all is clicked', async () => {
      const stopAllSites = vi.fn().mockResolvedValue(true);
      const sites = [
        createMockSite({ status: SiteStatus.Running }),
        createMockSite({ status: SiteStatus.Running }),
      ];

      useSitesStore.setState({
        allSites: sites,
        stopAllSites,
      });

      const { user } = renderWithProviders(<Sites />);

      const stopAllButton = screen.getByTestId('admin-stop-all-button');
      await user.click(stopAllButton);

      const confirmButton = await screen.findByTestId('admin-stop-all-confirm-button');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(stopAllSites).toHaveBeenCalled();
      });
    });

    it('should call deleteAllSites when delete all is clicked', async () => {
      const deleteAllSites = vi.fn().mockResolvedValue(true);
      const sites = [createMockSite(), createMockSite()];

      useSitesStore.setState({
        allSites: sites,
        deleteAllSites,
      });

      const { user } = renderWithProviders(<Sites />);

      const deleteAllButton = screen.getByTestId('admin-delete-all-button');
      await user.click(deleteAllButton);

      const confirmButton = await screen.findByTestId('admin-delete-all-confirm-button');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(deleteAllSites).toHaveBeenCalled();
      });
    });
  });

  describe('refreshes sites on mount', () => {
    it('should call refreshSites when page loads', async () => {
      const refreshSites = vi.fn();
      useSitesStore.setState({ refreshSites });

      renderWithProviders(<Sites />);

      await waitFor(() => {
        expect(refreshSites).toHaveBeenCalled();
      });
    });
  });

  describe('renders transfer UI', () => {
    it('should render transfer app card', () => {
      renderWithProviders(<Sites />);

      expect(screen.getByTestId('transfer-app-card')).toBeInTheDocument();
    });

    it('should open accept transfer dialog via transfer card', async function openDialog() {
      const { user } = renderWithProviders(<Sites />);

      await user.click(screen.getByTestId('transfer-app-card'));

      await waitFor(() => {
        expect(screen.getByTestId('accept-transfer-dialog')).toBeInTheDocument();
      });
    });

    it('should close accept transfer dialog when dismissed', async function closeDialog() {
      const { user } = renderWithProviders(<Sites />);

      await user.click(screen.getByTestId('transfer-app-card'));

      await waitFor(() => {
        expect(screen.getByTestId('accept-transfer-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Close'));

      await waitFor(() => {
        expect(screen.queryByTestId('accept-transfer-dialog')).not.toBeInTheDocument();
      });
    });

    it('should keep dialog open when loading starts mid-operation', async function dialogSurvivesLoading() {
      const { user } = renderWithProviders(<Sites />);

      await user.click(screen.getByTestId('transfer-app-card'));

      await waitFor(() => {
        expect(screen.getByTestId('accept-transfer-dialog')).toBeInTheDocument();
      });

      useSitesStore.setState({ isLoadingAll: true });

      expect(screen.getByTestId('accept-transfer-dialog')).toBeInTheDocument();
    });
  });

  describe('hides transfer UI when flag is disabled', () => {
    it('should not show transfer card when flag is off', () => {
      vi.mocked(useSwitchboard).mockReturnValue(false);

      renderWithProviders(<Sites />);

      expect(screen.queryByTestId('transfer-app-card')).not.toBeInTheDocument();
    });
  });

  describe('transfer UI visibility based on flag', () => {
    it('should show transfer card when flag is true (even for TLAs)', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      const { useAuth } = await import('@/hooks/useAuth');
      vi.mocked(useAuth).mockReturnValue({
        authState: { details: { shopperId: 'abc' } },
      } as ReturnType<typeof useAuth>);

      renderWithProviders(<Sites />);

      expect(screen.getByTestId('transfer-app-card')).toBeInTheDocument();
    });

    it('should show transfer card for non-TLAs when flag is true', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      const { useAuth } = await import('@/hooks/useAuth');
      vi.mocked(useAuth).mockReturnValue({
        authState: { details: { shopperId: '123456789' } },
      } as ReturnType<typeof useAuth>);

      renderWithProviders(<Sites />);

      expect(screen.getByTestId('transfer-app-card')).toBeInTheDocument();
    });

    it('should hide transfer card for TLAs when flag is false (no override)', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      const { useAuth } = await import('@/hooks/useAuth');
      vi.mocked(useAuth).mockReturnValue({
        authState: { details: { shopperId: 'abc' } },
      } as ReturnType<typeof useAuth>);

      renderWithProviders(<Sites />);

      expect(screen.queryByTestId('transfer-app-card')).not.toBeInTheDocument();
    });

    it('should hide transfer card for TLAs when flag is loading (undefined)', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(undefined);
      const { useAuth } = await import('@/hooks/useAuth');
      vi.mocked(useAuth).mockReturnValue({
        authState: { details: { shopperId: 'abc' } },
      } as ReturnType<typeof useAuth>);

      renderWithProviders(<Sites />);

      expect(screen.queryByTestId('transfer-app-card')).not.toBeInTheDocument();
    });

    it('should show transfer card for non-TLAs when flag is loading (undefined)', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(undefined);
      const { useAuth } = await import('@/hooks/useAuth');
      vi.mocked(useAuth).mockReturnValue({
        authState: { details: { shopperId: '123456789' } },
      } as ReturnType<typeof useAuth>);

      renderWithProviders(<Sites />);

      expect(screen.getByTestId('transfer-app-card')).toBeInTheDocument();
    });

    it('should show transfer card when authState is null (non-JWT/mock-auth mode)', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      const { useAuth } = await import('@/hooks/useAuth');
      vi.mocked(useAuth).mockReturnValue({
        authState: null,
      } as ReturnType<typeof useAuth>);

      renderWithProviders(<Sites />);

      expect(screen.getByTestId('transfer-app-card')).toBeInTheDocument();
    });
  });

  describe('logs impression event', () => {
    it('should log page view on mount', async () => {
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      renderWithProviders(<Sites />);

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('apps.page.view');
      });
    });
  });

  describe('prefetches develop route', () => {
    it('should prefetch /develop route using the first site id', async () => {
      useSitesStore.setState({
        allSites: [
          createMockSite({ id: 'first-app' }),
          createMockSite({ id: 'second-app' }),
        ],
      });

      renderWithProviders(<Sites />);

      await waitFor(() => {
        expect(mockPrefetch).toHaveBeenCalledWith('/develop/first-app');
      });
      expect(mockPrefetch).toHaveBeenCalledTimes(1);
    });

    it('should not prefetch when there are no sites', () => {
      useSitesStore.setState({ allSites: [] });

      renderWithProviders(<Sites />);

      expect(mockPrefetch).not.toHaveBeenCalled();
    });
  });
});
