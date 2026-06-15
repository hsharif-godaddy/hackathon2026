/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { SWITCHBOARD_APPBUILDER_APP_DELETE_MODAL } from '@/config/switchboard-flags';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { LifecycleState, SiteStatus } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { useSitesStore } from '@/stores/useSitesStore';
import { createMockSite, mockInstrumentation, mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import * as instrumentation from '@/utils/instrumentation';
import AppCard from './AppCard';

vi.mock('@/lib/gasket-config');
vi.mock('@/app/[market]/apps/components/TransferInitiateDialog', () => ({ default: () => null }));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(function () { return {
    data: undefined,
    subscriptions: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }; }),
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

global.ResizeObserver = vi.fn().mockImplementation(function () { return {
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}; });

const mockWindowOpen = vi.fn();
Object.defineProperty(window, 'open', {
  writable: true,
  value: mockWindowOpen,
});

describe('AppCard', () => {
  const mockSite = createMockSite();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSwitchboard).mockReturnValue(true);
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

    it('should not show preview menu item when app is hibernated (paused)', async () => {
      const hibernatedSite = createMockSite({
        status: SiteStatus.Running,
        preview_url: 'https://preview.test',
        variantsWithLifecycle: [
          {
            variant: 'preview',
            status: 'inactive',
            lifecycle: {
              lifecycleState: LifecycleState.PAUSED,
            },
          },
        ],
      });
      const { user } = renderWithProviders(<AppCard site={hibernatedSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.queryByText('builder_apps_menu_preview')).not.toBeInTheDocument();
      });
    });

    it('should not show preview corner button when app is hibernated (paused)', () => {
      const hibernatedSite = createMockSite({
        status: SiteStatus.Running,
        preview_url: 'https://preview.test',
        variantsWithLifecycle: [
          {
            variant: 'preview',
            status: 'inactive',
            lifecycle: {
              lifecycleState: LifecycleState.PAUSED,
            },
          },
        ],
      });
      renderWithProviders(<AppCard site={hibernatedSite} />);

      expect(screen.queryByTestId('app-card-preview-button')).not.toBeInTheDocument();
    });

    it('should not show preview corner button when app is archived (cold hibernation)', () => {
      const archivedSite = createMockSite({
        status: SiteStatus.Running,
        preview_url: 'https://preview.test',
        variantsWithLifecycle: [
          {
            variant: 'preview',
            status: 'inactive',
            lifecycle: {
              lifecycleState: LifecycleState.ARCHIVED,
            },
          },
        ],
      });
      renderWithProviders(<AppCard site={archivedSite} />);

      expect(screen.queryByTestId('app-card-preview-button')).not.toBeInTheDocument();
    });

    it('should show preview corner button when app is running and not hibernated', () => {
      const runningSite = createMockSite({
        status: SiteStatus.Running,
        preview_url: 'https://preview.test',
        variantsWithLifecycle: [
          {
            variant: 'preview',
            status: 'active',
            lifecycle: {
              lifecycleState: LifecycleState.RUNNING,
            },
          },
        ],
      });
      renderWithProviders(<AppCard site={runningSite} />);

      expect(screen.getByTestId('app-card-preview-button')).toBeInTheDocument();
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
    // Preview is opened on-demand now: the /api/sites LIST no longer injects a
    // share token (that made the un-paginated list O(N) agent round-trips and
    // stalled on hibernated/unreachable agents). Clicking preview opens a blank
    // tab synchronously (to keep the user gesture / dodge popup blockers),
    // fetches the token-injected URL for just this app via ?site_id=, then
    // navigates the tab to it.
    function stubPreviewWindow() {
      const fakeWindow = {
        location: { href: '' },
        opener: {} as unknown,
        document: { write: vi.fn(), close: vi.fn() },
      };
      mockWindowOpen.mockReturnValue(fakeWindow as unknown as Window);
      return fakeWindow;
    }

    async function openPreviewFromMenu(user: ReturnType<typeof renderWithProviders>['user']) {
      await user.click(screen.getByRole('button', { name: 'builder_apps_menu_actions' }));
      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_preview')).toBeInTheDocument();
      });
      await user.click(screen.getByText('builder_apps_menu_preview'));
    }

    it('fetches the token-injected preview URL on demand and opens it with airoPreview when the preview header flag is on', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) { return flag === 'appbuilder-preview-header'; });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await openPreviewFromMenu(user);

      // Tab opened synchronously, with opener severed for tab-nabbing safety.
      expect(mockWindowOpen).toHaveBeenCalledWith('about:blank', '_blank');
      expect(fakeWindow.opener).toBeNull();
      // Token fetched on demand for this one app via the single-site path,
      // with an abort timeout so a down agent can't hang the tab.
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          `/api/sites?site_id=${mockSite.id}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
      // Opened tab navigated to the injected URL with airoPreview appended.
      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123&airoPreview=1');
      });
    });

    it('fetches the token-injected preview URL on demand and opens it without airoPreview when the preview header flag is off', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await openPreviewFromMenu(user);

      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123');
      });
    });

    it('falls back to the bare preview URL when the on-demand token fetch fails', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockRejectedValue(new Error('network down'));
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await openPreviewFromMenu(user);

      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app');
      });
    });

    it('falls back to the bare preview URL on a non-OK response (e.g. 401/500)', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await openPreviewFromMenu(user);

      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app');
      });
    });

    it('falls back to the bare preview URL when the response has no string preview_url', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: mockSite.id }), // no preview_url in payload
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await openPreviewFromMenu(user);

      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app');
      });
    });

    it('still opens the resolved URL when the synchronous tab open is blocked (win === null)', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      // Popup blocked: the synchronous window.open returns null.
      mockWindowOpen.mockReturnValue(null);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await openPreviewFromMenu(user);

      // The retry in navigatePreviewWindow opens the resolved URL directly.
      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalledWith(
          'https://preview.test/app?airoShareToken=tok123',
          '_blank',
          'noopener,noreferrer',
        );
      });
    });

    it('does not open a second tab when preview is triggered again while a fetch is in flight', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      // Never resolves → the first invocation stays "in flight" across the
      // second click, keeping the double-open guard active. The guard is the
      // disabled corner button plus the openingPreviewRef re-entry check, so
      // exactly one tab opens regardless of which one fires.
      vi.mocked(appFetch).mockReturnValue(new Promise<Response>(() => {}));
      stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      const cornerButton = screen.getByTestId('app-card-preview-button');
      await user.click(cornerButton);
      await user.click(cornerButton);

      expect(mockWindowOpen).toHaveBeenCalledTimes(1);
      // Both triggers + both clicks deduped onto the single in-flight request.
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('prefetches the token-injected URL on hover and reuses it on click without a second fetch', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      const cornerButton = screen.getByTestId('app-card-preview-button');

      // Hover warms the token cache with a single fetch.
      await user.hover(cornerButton);
      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          `/api/sites?site_id=${mockSite.id}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
      expect(appFetch).toHaveBeenCalledTimes(1);

      // Click reuses the prefetched URL — navigates with no second fetch.
      await user.click(cornerButton);
      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123');
      });
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('reuses the prefetched URL on click with airoPreview appended when the preview header flag is on', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        return flag === 'appbuilder-preview-header';
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      const cornerButton = screen.getByTestId('app-card-preview-button');

      await user.hover(cornerButton);
      await waitFor(() => expect(appFetch).toHaveBeenCalledTimes(1));

      // Reuse path + flag on: withPreviewParam is applied at click time (current
      // render's flag), not baked into the cached token URL.
      await user.click(cornerButton);
      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123&airoPreview=1');
      });
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('reuses a single in-flight prefetch when clicked before the prefetch resolves', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      // Manually-controlled deferred: appFetch stays pending until we resolve it,
      // so the hover-prefetch is still in flight when the click lands.
      let resolveFetch!: (res: Response) => void;
      const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
      // mockReturnValueOnce → a regressed second fetch hits the default
      // (undefined) and fails the count assertion below, surfacing the regression.
      vi.mocked(appFetch).mockReturnValueOnce(pending);

      const fakeWindow = stubPreviewWindow();
      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      const cornerButton = screen.getByTestId('app-card-preview-button');

      // Hover starts the prefetch (one fetch, still pending).
      await user.hover(cornerButton);
      await waitFor(() => expect(appFetch).toHaveBeenCalledTimes(1));

      // Click while the prefetch is in flight — must dedupe onto the same request.
      await user.click(cornerButton);
      expect(appFetch).toHaveBeenCalledTimes(1);

      // Resolve; the click path navigates the tab with the resolved token.
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);

      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123');
      });
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('refetches on click when an earlier prefetch failed (no poisoned cache)', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      // First (prefetch) attempt rejects; second (click) attempt succeeds.
      vi.mocked(appFetch)
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
        } as Response);

      const fakeWindow = stubPreviewWindow();
      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      const cornerButton = screen.getByTestId('app-card-preview-button');

      await user.hover(cornerButton);
      await waitFor(() => expect(appFetch).toHaveBeenCalledTimes(1)); // prefetch failed, ref cleared

      await user.click(cornerButton);
      // Click did not reuse the failed attempt — it fetched fresh and navigated.
      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123');
      });
      expect(appFetch).toHaveBeenCalledTimes(2);
    });

    it('warms the token on pointerdown even without a prior hover (touch path)', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      stubPreviewWindow();

      renderWithProviders(<AppCard site={mockSite} />);
      const cornerButton = screen.getByTestId('app-card-preview-button');

      // No hover → onPointerEnter never fires; onPointerDown is the only signal.
      fireEvent.pointerDown(cornerButton);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          `/api/sites?site_id=${mockSite.id}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('shows a loading spinner in the opened tab instead of a blank page', async () => {
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      const fakeWindow = stubPreviewWindow();

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await user.click(screen.getByTestId('app-card-preview-button'));

      // The synchronously-opened tab is filled with the spinner page before the
      // token resolves, so it never shows blank.
      expect(fakeWindow.document.write).toHaveBeenCalledWith(
        expect.stringContaining('airo-preview-spinner'),
      );

      // …and once the token resolves the tab navigates away from the spinner.
      await waitFor(() => {
        expect(fakeWindow.location.href).toContain('airoShareToken=tok123');
      });
    });

    it('still navigates the opened tab when the loading-page write is blocked', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-preview-header') return false;
        return true;
      });
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...mockSite, preview_url: 'https://preview.test/app?airoShareToken=tok123' }),
      } as Response);
      // Some environments block document.write on about:blank; renderPreviewLoadingTab
      // swallows it and navigation must still proceed (graceful degradation).
      const fakeWindow = {
        location: { href: '' },
        opener: {} as unknown,
        document: { write: vi.fn(() => { throw new Error('write blocked'); }), close: vi.fn() },
      };
      mockWindowOpen.mockReturnValue(fakeWindow as unknown as Window);

      const { user } = renderWithProviders(<AppCard site={mockSite} />);
      await user.click(screen.getByTestId('app-card-preview-button'));

      await waitFor(() => {
        expect(fakeWindow.location.href).toBe('https://preview.test/app?airoShareToken=tok123');
      });
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
    beforeEach(() => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        return flag === SWITCHBOARD_APPBUILDER_APP_DELETE_MODAL;
      });
    });

    it('should show inline confirmation when delete modal flag is disabled', async () => {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === SWITCHBOARD_APPBUILDER_APP_DELETE_MODAL) return false;
        return true;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_apps_menu_delete'));

      await waitFor(() => {
        expect(screen.getByTestId('inline-confirmation')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('delete-project-confirmation-modal')).not.toBeInTheDocument();
    });

    it('should show confirmation modal when delete is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_delete')).toBeInTheDocument();
      });

      const deleteItem = screen.getByText('builder_apps_menu_delete');
      await user.click(deleteItem);

      await waitFor(() => {
        expect(screen.getByTestId('delete-project-confirmation-modal')).toBeInTheDocument();
      });
      expect(screen.getByTestId('mock-modal')).toHaveAttribute(
        'aria-label',
        'Delete “Test Application”'
      );
    });

    it('should hide confirmation modal when cancel is clicked', async () => {
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

      expect(screen.queryByTestId('delete-project-confirmation-modal')).not.toBeInTheDocument();
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
      const deleteSite = vi.fn(function () { return new Promise(() => {}); });
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
    it('should render the code-icon fallback when the site has no screenshots', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });

    it('should render the screenshot image when the site has a preview screenshot', () => {
      const siteWithScreenshot = createMockSite({
        variants: ['preview'],
        screenshots: { preview: { desktop: 'https://shots.card.test/preview.png' } },
      });

      renderWithProviders(<AppCard site={siteWithScreenshot} />);

      const img = screen.getByAltText(`Screenshot of ${siteWithScreenshot.name}`);
      expect(img).toHaveAttribute('src', 'https://shots.card.test/preview.png');
    });
  });

  describe('hides transfer UI when flag is disabled', () => {
    it('should not show transfer menu item when flag is off', async function hideTransferItem() {
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-transfer-ownership') {
          return false;
        }
        return true;
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
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'appbuilder-transfer-ownership') {
          return false;
        }
        return true;
      });

      vi.mocked(appFetch).mockImplementation(async function (url: string) {
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

  describe('hides transfer UI when transferAllowed is false', () => {
    it('should not show transfer menu item when transferAllowed is false', async function hideTransferForTLA() {
      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={false} />);

      const actionsMenuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' });
      await user.click(actionsMenuButton);

      await waitFor(() => {
        expect(screen.getByText('builder_apps_menu_settings')).toBeInTheDocument();
      });

      expect(screen.queryByText('Transfer')).not.toBeInTheDocument();
    });

    it('should skip transfer status fetch when transferAllowed is false', async function skipFetchForTLA() {
      renderWithProviders(<AppCard site={mockSite} transferAllowed={false} />);

      // Wait for component to mount and effects to flush
      await screen.findByRole('button', { name: 'builder_apps_menu_actions' });

      expect(appFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/transfer'),
        expect.anything()
      );
      expect(screen.queryByText('TRANSFER PENDING')).not.toBeInTheDocument();
      expect(screen.queryByText('Copy Code')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancel Transfer')).not.toBeInTheDocument();
    });
  });

  describe('transfer menu states', () => {
    it('should show transfer menu item when no active transfer', async function showTransferItem() {
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      expect(screen.getByText('Copy Code')).toBeInTheDocument();
      expect(screen.getByText('Cancel Transfer')).toBeInTheDocument();
    });

    it('should show transfer pending tag when transfer is active', async function showPendingTag() {
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      expect(screen.getByText(mockSite.name)).toBeInTheDocument();
      expect(screen.getByText(/Expires/)).toBeInTheDocument();
    });

    it('should show cancel transfer confirmation when cancel is clicked', async function showCancelConfirm() {
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (typeof url === 'string' && url.includes('/transfer')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-03-28T12:00:00.000Z' }),
          } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));

      expect(screen.getByText(/Cancel transfer for/)).toBeInTheDocument();
    });

    it('should fire cancel_success EID when cancel succeeds', async function cancelSuccess() {
      vi.mocked(appFetch).mockImplementation(async function (url: string, options?: RequestInit) {
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
      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));
      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.cancel_success', { appId: 'test-site-123' });
      });
    });

    it('should fire cancel_error EID when cancel API fails', async function cancelError() {
      vi.mocked(appFetch).mockImplementation(async function (url: string, options?: RequestInit) {
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

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));
      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.cancel_error', { appId: 'test-site-123' });
      });
    });

    it('should fire cancel_error EID when cancel throws', async function cancelThrows() {
      vi.mocked(appFetch).mockImplementation(async function (url: string, options?: RequestInit) {
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

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

      await waitFor(() => {
        expect(screen.getByText('TRANSFER PENDING')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel Transfer'));
      await user.click(screen.getByTestId('confirm-button'));

      await waitFor(() => {
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.cancel_error', { appId: 'test-site-123' });
      });
    });
  });

  describe('transfer validation flow', () => {
    function mockTransferValidation(canTransfer: boolean, gdCommerce: boolean) {
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
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

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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

    it('should fire apps.app.transfer EID with appId only when dialog opens', async function firesTransferEid() {
      mockTransferValidation(true, false);

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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
        expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.app.transfer', { appId: mockSite.id });
      });
    });

    it('should not fire apps.app.transfer EID when canTransfer is false', async function doesNotFireWhenBlocked() {
      mockTransferValidation(false, true);

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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
      });

      expect(instrumentation.logClickEvent).not.toHaveBeenCalledWith('apps.app.transfer', expect.anything());
    });

    it('should show error message when validate endpoint fails', async function validateFails() {
      vi.mocked(appFetch).mockImplementation(async function (url: string) {
        if (typeof url === 'string' && url.includes('/transfer/validate')) {
          return { ok: false, status: 500, json: async () => ({}) } as Response;
        }
        if (typeof url === 'string' && url.includes('/transfer')) {
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => mockSite } as Response;
      });

      const { user } = renderWithProviders(<AppCard site={mockSite} transferAllowed={true} />);

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

