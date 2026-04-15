/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { SiteStatus } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { useSitesStore } from '@/stores/useSitesStore';
import { createMockSite, mockInstrumentation, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import * as instrumentation from '@/utils/instrumentation';
import AppCard, { AppCardEmptyState } from './AppCard';

vi.mock('@/lib/gasket-config');
vi.mock('@/app/apps/components/TransferInitiateDialog', () => ({ default: () => null }));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false, error: null })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    data: undefined,
    subscriptions: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

const mockRouterInstance = mockRouter();
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouterInstance,
}));
vi.mock('@/utils/instrumentation', () => mockInstrumentation());
vi.mock('@ux/modal', () => ({
  default: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div data-testid="mock-modal" aria-label={title}>{children}</div>
  ),
}));

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
    vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);
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
    it('should display published status when app is published', () => {
      const publishedSite = createMockSite({
        variants: ['publish'],
        published_url: 'https://published.test/app',
      });

      renderWithProviders(<AppCard site={publishedSite} />);

      expect(screen.getByText('builder_status_published')).toBeInTheDocument();
    });

    it('should display error status when there is a failure', () => {
      const failedSite = createMockSite({ status: SiteStatus.Failed });
      renderWithProviders(<AppCard site={failedSite} />);

      expect(screen.getByText('builder_status_error')).toBeInTheDocument();
    });

    it('should display error status when there is an error', () => {
      const errorSite = createMockSite({ status: SiteStatus.Error });
      renderWithProviders(<AppCard site={errorSite} />);

      expect(screen.getByText('builder_status_error')).toBeInTheDocument();
    });

    it('should display published and error status when both are present', () => {
      const publishedAndErrorSite = createMockSite({
        variants: ['publish'],
        status: SiteStatus.Error,
        published_url: 'https://published.test/app',
      });

      renderWithProviders(<AppCard site={publishedAndErrorSite} />);

      expect(screen.getByText('builder_status_published')).toBeInTheDocument();
      expect(screen.getByText('builder_status_error')).toBeInTheDocument();
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

    it('should show edit menu item', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_common_edit')).toBeInTheDocument();
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
      const stoppedSite = createMockSite({ status: SiteStatus.Stopped });
      const { user } = renderWithProviders(<AppCard site={stoppedSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_preview')).not.toBeInTheDocument();
      });
    });

    it('should not show preview menu item when preview_url is missing', async () => {
      const siteWithoutPreview = createMockSite({ status: SiteStatus.Running, preview_url: undefined });
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
      const publishedListSite = createMockSite({
        published_url: 'https://published.test/app',
        variants: ['publish'],
      });

      const { user } = renderWithProviders(<AppCard site={publishedListSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_visit')).toBeInTheDocument();
      });
    });

    it('should not show visit site menu item when publishedUrl exists but hasBeenPublished returns false', async () => {
      const notPublishedListSite = createMockSite({
        published_url: 'https://published.test/app',
        variants: [],
        variantsWithLifecycle: [],
      });

      const { user } = renderWithProviders(<AppCard site={notPublishedListSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_visit')).not.toBeInTheDocument();
      });
    });

    it('should not show visit site menu item when publishedUrl does not exist', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_visit')).not.toBeInTheDocument();
      });
    });

    it('should not show unpublish for inactive publish variant', async () => {
      const inactivePublishSite = createMockSite({
        published_url: 'https://published.test/app',
        variantsWithLifecycle: [
          { variant: 'publish', status: 'inactive' },
        ],
      });

      const { user } = renderWithProviders(<AppCard site={inactivePublishSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByTestId('app-card-unpublish-button')).not.toBeInTheDocument();
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
      const publishedListSite = createMockSite({
        published_url: publishedUrl,
        variants: ['publish'],
      });

      const { user } = renderWithProviders(<AppCard site={publishedListSite} />);

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

    it('should have correct href for edit menu item', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_common_edit')).toBeInTheDocument();
      });

      const expectedHref = `/develop/${mockSite.id}?siteId=${mockSite.id}`;

      const editText = screen.getByText('builder_common_edit');
      const editItem = editText.closest('a') || editText.closest('[role="menuitem"]') || editText;

      await waitFor(() => {
        expect(editItem).toHaveAttribute('href', expectedHref);
      });
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
      renderWithProviders(<AppCard site={mockSite} />);

      // MediaCard's click forwarding uses pointerDown/pointerUp on an inner shell element,
      // which then calls .click() on a hidden input. In jsdom, user.click() on the outer
      // wrapper (where aria-label lives) doesn't reach the inner shell's pointer handlers.
      // Click the hidden interactive element directly to simulate the forwarded click.
      const card = screen.getByLabelText(new RegExp(`builder_common_edit.*${mockSite.name}`, 'i'));
      const hiddenButton = card.querySelector('.ux-card-hidden') as HTMLElement;
      hiddenButton.click();

      expect(mockRouterInstance.push).toHaveBeenCalledWith(`/develop/${mockSite.id}?siteId=${mockSite.id}`);
    });

    it('should navigate to edit page when card is clicked for site without name', async () => {
      const siteWithoutName = createMockSite({ name: '' });
      renderWithProviders(<AppCard site={siteWithoutName} />);

      const card = screen.getByLabelText(new RegExp('builder_common_edit', 'i'));
      const hiddenButton = card.querySelector('.ux-card-hidden') as HTMLElement;
      hiddenButton.click();

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

    async function clickMenuItemAndExpectNoNavigation(
      user: ReturnType<typeof renderWithProviders>['user'],
      itemLocator: () => HTMLElement
    ) {
      await user.click(screen.getByRole('button', { name: 'builder_apps_menu_actions' }));
      await waitFor(() => {
        expect(itemLocator()).toBeInTheDocument();
      });
      mockRouterInstance.push.mockClear();
      await user.click(itemLocator());
      expect(mockRouterInstance.push).not.toHaveBeenCalled();
    }

    it('should not navigate when delete menu item is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await clickMenuItemAndExpectNoNavigation(user, () => screen.getByText('builder_apps_menu_delete'));
    });

    it('should not navigate when preview menu item is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await clickMenuItemAndExpectNoNavigation(user, () => screen.getByText('builder_apps_menu_preview'));
    });

    it('should not navigate when rename menu item is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await clickMenuItemAndExpectNoNavigation(user, () => screen.getByText('builder_common_rename'));
    });

    it('should not navigate when unpublish menu item is clicked', async () => {
      const publishedSite = createMockSite({
        variants: ['preview', 'publish'],
        variantsWithLifecycle: [
          { variant: 'preview', status: 'active' },
          { variant: 'publish', status: 'active' },
        ],
        published_url: 'https://published.test/app',
      });

      const { user } = renderWithProviders(<AppCard site={publishedSite} />);

      await clickMenuItemAndExpectNoNavigation(user, () => screen.getByTestId('app-card-unpublish-button'));
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

    it('should not navigate when delete confirm button is clicked', async () => {
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
      mockRouterInstance.push.mockClear();

      const confirmButton = screen.getByRole('button', { name: 'builder_common_delete' });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(deleteSite).toHaveBeenCalledWith('test-site-123');
      });
      expect(mockRouterInstance.push).not.toHaveBeenCalled();
    });

    it('should not navigate when delete cancel button is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      const deleteItem = screen.getByText('builder_apps_menu_delete');
      await user.click(deleteItem);
      mockRouterInstance.push.mockClear();

      const cancelButton = screen.getByRole('button', { name: 'builder_common_cancel' });
      await user.click(cancelButton);

      expect(mockRouterInstance.push).not.toHaveBeenCalled();
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

  describe('renders thumbnail', () => {
    it('should render AppThumbnail component', async () => {
      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-loading')).toBeInTheDocument();
      });
    });
  });

  describe('hides transfer UI when flag is disabled', () => {
    it('should not show transfer menu item when flag is off', async function hideTransferItem() {
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-transfer-ownership') {
          return { data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_settings')).toBeInTheDocument();
      });

      expect(screen.queryByText('Transfer')).not.toBeInTheDocument();
    });

    it('should not show transfer pending tag when flag is off', async function hidePendingTag() {
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-transfer-ownership') {
          return { data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
      });

      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.queryByText('Transfer Pending')).not.toBeInTheDocument();
      });
    });
  });

  describe('transfer menu states', () => {
    it('should show transfer menu item when no active transfer', async function showTransferItem() {
      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('Transfer')).toBeInTheDocument();
      });

      expect(screen.queryByText('Copy Code')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancel Transfer')).not.toBeInTheDocument();
    });

    it('should show copy code and cancel transfer when active transfer exists', async function showCopyCancel() {
      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      expect(screen.getByText('Copy Code')).toBeInTheDocument();
      expect(screen.getByText('Cancel Transfer')).toBeInTheDocument();
    });

    it('should show transfer pending tag when transfer is active', async function showPendingTag() {
      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      expect(screen.getByText(mockSite.name)).toBeInTheDocument();
      expect(screen.getByText(/Expires/)).toBeInTheDocument();
    });

    it('should show cancel transfer confirmation when cancel is clicked', async function showCancelConfirm() {
      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));

      expect(screen.getByText(/Cancel transfer for/)).toBeInTheDocument();
    });

    it('should fire cancel_success EID when cancel succeeds', async function cancelSuccess() {
      vi.mocked(appFetch).mockImplementation(async (url: string, options?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/transfer/cancel') && options?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({}) } as Response;
        }
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      useSitesStore.setState({ refreshSites: vi.fn() });
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));
      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.cancel_success');
      });
    });

    it('should fire cancel_error EID when cancel API fails', async function cancelError() {
      vi.mocked(appFetch).mockImplementation(async (url: string, options?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/transfer/cancel') && options?.method === 'POST') {
          return { ok: false, status: 500, json: async () => ({ error: 'Server error' }) } as Response;
        }
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));
      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.cancel_error');
      });
    });

    it('should fire cancel_error EID when cancel throws', async function cancelThrows() {
      vi.mocked(appFetch).mockImplementation(async (url: string, options?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/transfer/cancel') && options?.method === 'POST') {
          throw new Error('Network error');
        }
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));
      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.cancel_error');
      });
    });
  });

  describe('transfer validation flow', () => {
    function mockTransferValidation(canTransfer: boolean, gdCommerce: boolean) {
      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer/validate')) {
          return { ok: true, json: async () => ({ canTransfer, gdCommerce }) } as Response;
        }
        if (typeof url === 'string' && url.includes('/transfer')) {
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });
    }

    it('should call validate endpoint when Transfer is clicked', async function callsValidate() {
      mockTransferValidation(true, false);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByTestId('app-card-transfer-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('app-card-transfer-button'));

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(`/api/apps/${mockSite.id}/transfer/validate`);
      });
    });

    it('should show blocked message when canTransfer is false', async function blockedByCommerce() {
      mockTransferValidation(false, true);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByTestId('app-card-transfer-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('app-card-transfer-button'));

      await waitFor(() => {
        expect(screen.getByTestId('transfer-blocked-reason')).toBeInTheDocument();
        expect(screen.getByText(/Transfer is unavailable/)).toBeInTheDocument();
      });
    });

    it('should open transfer dialog when canTransfer is true', async function allowsTransfer() {
      mockTransferValidation(true, false);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByTestId('app-card-transfer-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('app-card-transfer-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('transfer-blocked-reason')).not.toBeInTheDocument();
      });
    });

    it('should show error message when validate endpoint fails', async function validateFails() {
      vi.mocked(appFetch).mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/transfer/validate')) {
          return { ok: false, status: 500, json: async () => ({}) } as Response;
        }
        if (typeof url === 'string' && url.includes('/transfer')) {
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByTestId('app-card-transfer-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('app-card-transfer-button'));

      await waitFor(() => {
        expect(screen.getByTestId('transfer-blocked-reason')).toBeInTheDocument();
        expect(screen.getByText(/Unable to verify transfer eligibility/)).toBeInTheDocument();
      });
    });
  });
});

describe('AppCardEmptyState', () => {
  it('should render create new app text', () => {
    renderWithProviders(<AppCardEmptyState />);

    expect(screen.getByText('builder_apps_empty_create')).toBeInTheDocument();
  });

  it('should render accept transfer menu item with data-eid when transfer is enabled', async function acceptTransferEid() {
    const onAcceptTransfer = vi.fn();
    const { user } = renderWithProviders(
      <AppCardEmptyState isTransferEnabled={true} onAcceptTransfer={onAcceptTransfer} />
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));

    await waitFor(() => {
      const acceptItem = screen.getByTestId('empty-state-accept-transfer');
      expect(acceptItem).toBeInTheDocument();
      expect(acceptItem).toHaveAttribute('data-eid', 'apps.emptystate.accept_transfer.click');
    });
  });
});
