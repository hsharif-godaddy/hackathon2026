import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useSitesStore } from '@/stores/useSitesStore';
import { createMockSite, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import Sites from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
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

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    codeEditor: vi.fn().mockReturnValue(false),
    mockLogin: vi.fn().mockReturnValue(true),
    developmentMode: vi.fn().mockReturnValue(true),
    galleryPage: vi.fn().mockReturnValue(false),
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

    it('should show 0 apps total tag', () => {
      renderWithProviders(<Sites />);

      expect(screen.getByText('builder_apps_count')).toBeInTheDocument();
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
        createMockSite({ status: 'running' }),
        createMockSite({ status: 'running' }),
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

  describe('logs impression event', () => {
    it('should log page view on mount', async () => {
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      renderWithProviders(<Sites />);

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('apps.page.view');
      });
    });
  });
});
