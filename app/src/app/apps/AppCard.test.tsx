import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useSitesStore } from '@/stores/useSitesStore';
import { createMockSite, mockInstrumentation, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import AppCard, { AppCardEmptyState } from './AppCard';

vi.mock('@/lib/gasket-config');

const mockRouterInstance = mockRouter();
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouterInstance,
}));
vi.mock('@/utils/instrumentation', () => mockInstrumentation());

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

const mockWindowOpen = vi.fn();
Object.defineProperty(window, 'open', {
  writable: true,
  value: mockWindowOpen,
});

describe('AppCard', () => {
  const mockSite = createMockSite();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowOpen.mockClear();
    mockRouterInstance.push.mockClear();
    useSitesStore.setState({
      allSites: [],
      sitesById: {},
      isLoadingAll: false,
      loadingById: {},
      error: null,
      lastFetchedAll: null,
    });
  });

  describe('renders site information correctly', () => {
    it('should display site name', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('Test Application')).toBeInTheDocument();
    });

    it('should display initial prompt', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('Build a todo app')).toBeInTheDocument();
    });

    it('should display created date', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('builder_apps_created')).toBeInTheDocument();
    });

    it('should display default name when name is empty', () => {
      const siteWithoutName = createMockSite({ name: '' });
      renderWithProviders(<AppCard site={siteWithoutName} />);

      expect(screen.getByText('builder_apps_alert_delete_untitled')).toBeInTheDocument();
    });
  });

  describe('renders status correctly', () => {
    it('should display running status', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('builder_status_running')).toBeInTheDocument();
    });

    it('should display creating status', () => {
      const creatingSite = createMockSite({ status: 'creating' });
      renderWithProviders(<AppCard site={creatingSite} />);

      expect(screen.getByText('builder_status_creating')).toBeInTheDocument();
    });

    it('should display created status', () => {
      const createdSite = createMockSite({ status: 'created' });
      renderWithProviders(<AppCard site={createdSite} />);

      expect(screen.getByText('builder_status_creating')).toBeInTheDocument();
    });

    it('should display failed status', () => {
      const failedSite = createMockSite({ status: 'failed' });
      renderWithProviders(<AppCard site={failedSite} />);

      expect(screen.getByText('builder_status_failed')).toBeInTheDocument();
    });

    it('should display error status', () => {
      const errorSite = createMockSite({ status: 'error' });
      renderWithProviders(<AppCard site={errorSite} />);

      expect(screen.getByText('builder_status_failed')).toBeInTheDocument();
    });

    it('should display stopped status', () => {
      const stoppedSite = createMockSite({ status: 'stopped' });
      renderWithProviders(<AppCard site={stoppedSite} />);

      expect(screen.getByText('builder_status_stopped')).toBeInTheDocument();
    });

    it('should display unknown status for unrecognized status', () => {
      const unknownSite = createMockSite({ status: 'unknown-status' as any });
      renderWithProviders(<AppCard site={unknownSite} />);

      expect(screen.getByText('builder_status_unknown')).toBeInTheDocument();
    });
  });

  describe('renders menu correctly', () => {
    it('should show actions menu button', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      expect(actionsMenuButton).toBeInTheDocument();
    });

    it('should open menu when menu button is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_settings')).toBeInTheDocument();
      });
    });

    it('should show preview menu item when site is running', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_preview')).toBeInTheDocument();
      });
    });

    it('should not show preview menu item when site is not running', async () => {
      const stoppedSite = createMockSite({ status: 'stopped' });
      const { user } = renderWithProviders(<AppCard site={stoppedSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_preview')).not.toBeInTheDocument();
      });
    });

    it('should not show preview menu item when preview_url is missing', async () => {
      const siteWithoutPreview = createMockSite({ status: 'running', preview_url: undefined });
      const { user } = renderWithProviders(<AppCard site={siteWithoutPreview} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_preview')).not.toBeInTheDocument();
      });
    });

    it('should show settings menu item', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_settings')).toBeInTheDocument();
      });
    });

    it('should show delete menu item', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });
    });

    it('should show visit site menu item when publishedUrl exists and hasBeenPublished returns true', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockSite,
          published_url: 'https://published.test/app',
          published_at: '2024-01-01T00:00:00.000Z',
          variants: ['publish'],
        }),
      } as Response);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_apps_menu_actions' })).toBeInTheDocument();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_visit')).toBeInTheDocument();
      });
    });

    it('should not show visit site menu item when publishedUrl exists but hasBeenPublished returns false', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockSite,
          published_url: 'https://published.test/app',
          published_at: '2024-01-01T00:00:00.000Z',
          variants: [],
        }),
      } as Response);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_visit')).not.toBeInTheDocument();
      });
    });

    it('should not show visit site menu item when publishedUrl does not exist', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockSite,
          published_url: null,
        }),
      } as Response);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_visit')).not.toBeInTheDocument();
      });
    });
  });

  describe('handles menu item clicks', () => {
    it('should open preview URL in new window when preview is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_preview')).toBeInTheDocument();
      });

      const previewItem = screen.getByText('builder_apps_menu_preview');
      await user.click(previewItem);

      expect(mockWindowOpen).toHaveBeenCalledWith(
        mockSite.preview_url,
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('should open published URL in new window when visit site is clicked', async () => {
      const publishedUrl = 'https://published.test/app';
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockSite,
          published_url: publishedUrl,
          published_at: '2024-01-01T00:00:00.000Z',
          variants: ['publish'],
        }),
      } as Response);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'builder_apps_menu_actions' })).toBeInTheDocument();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_visit')).toBeInTheDocument();
      });

      const visitItem = screen.getByText('builder_apps_menu_visit');
      await user.click(visitItem);

      expect(mockWindowOpen).toHaveBeenCalledWith(
        publishedUrl,
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('should navigate to settings when settings menu item is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_settings')).toBeInTheDocument();
      });

      const expectedHref = `/develop/${mockSite.id}?siteId=${mockSite.id}&settings=domain&tab=settings`;
      
      const settingsText = screen.getByText('builder_apps_menu_settings');
      const settingsItem = settingsText.closest('a') || settingsText.closest('[role="menuitem"]') || settingsText;
      
      await waitFor(() => {
        expect(settingsItem).toHaveAttribute('href', expectedHref);
      });

      await user.click(settingsItem);
    });
  });

  describe('handles card click navigation', () => {
    it('should navigate to edit page when card is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const card = screen.getByLabelText(new RegExp(`builder_common_edit.*${mockSite.name}`, 'i'));
      await user.click(card);

      expect(mockRouterInstance.push).toHaveBeenCalledWith(`/develop/${mockSite.id}?siteId=${mockSite.id}`);
    });

    it('should navigate to edit page when card is clicked for site without name', async () => {
      const siteWithoutName = createMockSite({ name: '' });
      const { user } = renderWithProviders(<AppCard site={siteWithoutName} />);

      const card = screen.getByLabelText(new RegExp('builder_common_edit', 'i'));
      await user.click(card);

      expect(mockRouterInstance.push).toHaveBeenCalledWith(`/develop/${siteWithoutName.id}?siteId=${siteWithoutName.id}`);
    });

    it('should not navigate when menu area is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_settings')).toBeInTheDocument();
      });

      expect(mockRouterInstance.push).not.toHaveBeenCalled();
    });
  });

  describe('handles delete confirmation flow', () => {
    it('should show confirmation alert when delete is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      const deleteItem = screen.getByText('builder_apps_menu_delete');
      await user.click(deleteItem);

      expect(screen.getByText('builder_apps_alert_delete')).toBeInTheDocument();
    });

    it('should hide confirmation alert when cancel is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      const deleteItem = screen.getByText('builder_apps_menu_delete');
      await user.click(deleteItem);

      const cancelButton = screen.getByRole('button', { name: 'builder_common_cancel' });
      await user.click(cancelButton);

      expect(screen.queryByText('builder_apps_alert_delete')).not.toBeInTheDocument();
    });

    it('should call deleteSite when confirm is clicked', async () => {
      const deleteSite = vi.fn().mockResolvedValue(true);
      useSitesStore.setState({ deleteSite });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      const deleteItem = screen.getByText('builder_apps_menu_delete');
      await user.click(deleteItem);

      const confirmButton = screen.getByRole('button', { name: 'builder_common_delete' });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(deleteSite).toHaveBeenCalledWith('test-site-123');
      });
    });

    it('should show deleting state while delete is in progress', async () => {
      const deleteSite = vi.fn((): Promise<boolean> => new Promise(() => {}));
      useSitesStore.setState({ deleteSite });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      const deleteItem = screen.getByText('builder_apps_menu_delete');
      await user.click(deleteItem);

      const confirmButton = screen.getByRole('button', { name: 'builder_common_delete' });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText('builder_common_deleting')).toBeInTheDocument();
      });
    });
  });

  describe('fetches site details on mount', () => {
    it('should fetch site details to check for published URL', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => mockSite,
      } as Response);

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(`/api/sites/${mockSite.id}`);
      });
    });

    it('should handle fetch errors gracefully', async () => {
      vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      expect(screen.getByText('Test Application')).toBeInTheDocument();
    });
  });

  describe('renders thumbnail', () => {
    it('should render AppThumbnail component', async () => {
      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-loading')).toBeInTheDocument();
      });
    });
  });
});

describe('AppCardEmptyState', () => {
  it('should render create new app text', () => {
    renderWithProviders(<AppCardEmptyState />);

    expect(screen.getByText('builder_apps_empty_create')).toBeInTheDocument();
  });
});
